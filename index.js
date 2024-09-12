const v8 = require("v8");
const vm = require("vm");
const fetchMetrics = require("./fetchMetrics");

function createContext(initialVariables = {}) {
  const sharedContext = {
    console: console,
    pfAddVariable: function (name, value) {
      if (typeof name !== "string") {
        throw new Error("Name must be a string");
      }
      this[name] = value; // Attach variables directly to sharedContext
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
    // Add any other initial variables
    ...initialVariables,
  };

  return sharedContext;
}

function runInContext(sharedContext, code) {
  const sandbox = { ...sharedContext }; // Create a sandbox with sharedContext
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
  // Add metrics to the context
  context.metrics = metrics;

  const wrappedAssertion = `
    (function() {
      ${atob(assertion)}
      try {
        var result = main({ metrics: metrics });
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
  // Fetch metrics
  const response = await fetchMetrics();

  if (!response || response.code !== 200) {
    console.error("Failed to fetch metrics or received non-200 response");
    return;
  }

  const testConfigs = response.data.execution_result.pulse.test_config;
  const metrics = response.data.test_metrics;

  // Initialize variables from the response
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

  // Create a single context to be used across all test evaluations
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

  console.log("All test results:", results);
  console.log("All tests passed:", allTestsPassed);
  // console.log("Final variables state:", sharedContext);
}

main().catch(console.error);
