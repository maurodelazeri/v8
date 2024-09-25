const v8 = require("v8");
const vm = require("vm");
const fetchMetrics = require("./fetchMetrics");
const { Buffer } = require("buffer");

function createContext(initialVariables = {}) {
  const sharedContext = {
    console: console,
    pfAddVariable: function (name, value) {
      if (typeof name !== "string") {
        throw new Error("Name must be a string");
      }
      this[name] = value;
      console.log(`Variable added: ${name} = ${value}`);
      return "OK";
    },
    pfDeleteVariable: function (name) {
      if (typeof name !== "string") {
        throw new Error("Name must be a string");
      }
      if (name in this) {
        delete this[name];
        console.log(`Variable deleted: ${name}`);
        return "OK";
      } else {
        throw new Error(`Variable '${name}' not found`);
      }
    },
    ...initialVariables,
  };

  return sharedContext;
}

function runInContext(sharedContext, code) {
  const sandbox = { ...sharedContext, Buffer: Buffer };
  const context = vm.createContext(sandbox);
  try {
    const script = new vm.Script(code);
    return script.runInContext(context);
  } catch (error) {
    console.error("Error running script:", error);
    throw error;
  }
}

function runAssertionFunction(context, metrics, assertion) {
  context.metrics = metrics;

  const wrappedAssertion = `
    (function() {
      ${Buffer.from(assertion, "base64").toString("utf-8")}
      try {
        var originalConsoleLog = console.log;
        var logMessages = [];
        console.log = function() {
          logMessages.push(Array.from(arguments).join(' '));
          originalConsoleLog.apply(console, arguments);
        };

        var result = main({ metrics: metrics });

        // Add tracking logic here
        result.failureReasons = [];
        result.variableStates = {};
        var decodedEvaluationCode = Buffer.from('${assertion}', 'base64').toString('utf-8');
        var functionBody = decodedEvaluationCode.substring(decodedEvaluationCode.indexOf("{") + 1, decodedEvaluationCode.lastIndexOf("}"));
        var lines = functionBody.split("\\n");

        lines.forEach(line => {
          line = line.trim();
          if (line.startsWith('const') || line.startsWith('let') || line.startsWith('var')) {
            var parts = line.split('=');
            var variableName = parts[0].split(' ')[1].trim();
            try {
              result.variableStates[variableName] = eval(variableName);
            } catch (e) {
              result.variableStates[variableName] = "Unable to evaluate";
            }
          }
        });

        if (!result.success) {
          var successLine = lines.find(line => line.includes('const success ='));
          if (successLine) {
            var conditions = successLine.split('=')[1].split('&&');
            conditions.forEach(condition => {
              condition = condition.trim();
              try {
                if (!eval(condition)) {
                  result.failureReasons.push(condition + " is false");
                }
              } catch (e) {
                result.failureReasons.push("Error evaluating: " + condition);
              }
            });
          }
        }

        result.logMessages = logMessages;
        console.log = originalConsoleLog;

        return JSON.stringify(result);
      } catch (e) {
        return JSON.stringify({ error: e.message, stack: e.stack });
      }
    })()
  `;

  try {
    const result = runInContext(context, wrappedAssertion);
    const parsedResult = JSON.parse(result);

    if (parsedResult.error) {
      console.error("Assertion error:", parsedResult.error);
      console.error("Stack trace:", parsedResult.stack);
      return { success: false, error: parsedResult.error };
    }
    if (typeof parsedResult.success !== "boolean") {
      console.error("Assertion result must contain a 'success' boolean field");
      return { success: false, error: "Invalid assertion result format" };
    }
    return parsedResult;
  } catch (error) {
    console.error("Error running assertion:", error);
    return { success: false, error: error.message };
  }
}

async function main() {
  const response = await fetchMetrics();

  if (!response || response.code !== 200) {
    console.error("Failed to fetch metrics or received non-200 response");
    return;
  }

  const testConfigs = response.data.execution_result.pulse.test_config;
  const metrics = response.data.test_metrics;

  const initialVariables = {};
  if (
    response.data.execution_result.pulse &&
    Array.isArray(response.data.execution_result.pulse.variables)
  ) {
    response.data.execution_result.pulse.variables.forEach((variable) => {
      if (
        variable &&
        typeof variable === "object" &&
        "name" in variable &&
        "value" in variable
      ) {
        initialVariables[variable.name] = variable.value;
      } else {
        const key = Object.keys(variable)[0];
        const value = variable[key];
        if (key && value !== undefined) {
          initialVariables[key] = value;
        } else {
          console.error(`Invalid variable format: ${JSON.stringify(variable)}`);
        }
      }
    });
  } else {
    console.error(
      "No variables found or variables format is incorrect in the response payload."
    );
  }

  console.log("Final Initial Variables:", initialVariables);

  const sharedContext = createContext(initialVariables);

  const results = [];
  let allTestsPassed = true;

  for (let i = 0; i < testConfigs.length; i++) {
    const testConfig = testConfigs[i];

    console.log(`Running test: ${testConfig.name}`);

    const assertion = testConfig.evaluation_function;
    const result = runAssertionFunction(sharedContext, metrics, assertion);

    results.push({
      testName: testConfig.name,
      result: result,
    });

    console.log(`Test result for ${testConfig.name}:`, result);

    if (!result.success) {
      allTestsPassed = false;
      if (!testConfig.continue_on_step_failure) {
        console.log(
          "Test failed and continue_on_step_failure is false. Stopping execution."
        );
        break;
      } else {
        console.log(
          "Test failed but continue_on_step_failure is true. Continuing to next test."
        );
      }
    }
  }

  console.log("All test results:", JSON.stringify(results, null, 2));
  console.log("All tests passed:", allTestsPassed);
}

main().catch(console.error);
