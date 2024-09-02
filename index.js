const v8 = require("v8");
const vm = require("vm");
const fetchMetrics = require("./fetchMetrics");

function interpolateString(str, variables) {
  return str.replace(/\{\{(.+?)\}\}/g, (match, p1) => {
    const key = p1.trim();
    return variables[key] !== undefined ? variables[key] : match;
  });
}

function interpolateObject(obj, variables) {
  if (typeof obj !== "object" || obj === null) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => interpolateObject(item, variables));
  }

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") {
      result[key] = interpolateString(value, variables);
    } else if (typeof value === "object") {
      result[key] = interpolateObject(value, variables);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function createContext(initialVariables = {}) {
  const context = {
    console: console,
    pfAddVariable: function (name, value) {
      if (typeof name !== "string" || typeof value !== "string") {
        throw new Error("Name and value must be strings");
      }
      if (
        name.includes("{") ||
        name.includes("}") ||
        value.includes("{") ||
        value.includes("}")
      ) {
        throw new Error(
          "Invalid characters: '{' and '}' are not allowed in name or value"
        );
      }
      context[name] = value;
      console.log(`Variable added: ${name} = ${value}`);
      return "OK";
    },
    pfDeleteVariable: function (name) {
      if (typeof name !== "string") {
        throw new Error("Name must be a string");
      }
      if (name in context) {
        delete context[name];
        console.log(`Variable deleted: ${name}`);
        return "OK";
      } else {
        throw new Error(`Variable '${name}' not found`);
      }
    },
    ...initialVariables,
  };

  return vm.createContext(context);
}

function runInContext(context, code) {
  try {
    const script = new vm.Script(code);
    return script.runInContext(context);
  } catch (error) {
    console.error("Error running script:", error);
    return null;
  }
}

function runAssertionFunction(context, metrics, assertion) {
  const wrappedAssertion = `
    (function(metrics) {
      ${atob(assertion)}
      try {
        var result = main({ metrics: metrics });
        return JSON.stringify(result);
      } catch (e) {
        return JSON.stringify({ error: e.message, stack: e.stack });
      }
    })(${JSON.stringify(metrics)})
  `;

  const result = runInContext(context, wrappedAssertion);

  if (result) {
    const parsedResult = JSON.parse(result);
    if (parsedResult.error) {
      console.error("Assertion error:", parsedResult.error);
      console.error("Stack trace:", parsedResult.stack);
      return {
        success: false,
        error: parsedResult.error,
        stack: parsedResult.stack,
      };
    }
    if (typeof parsedResult.success !== "boolean") {
      console.error("Assertion result must contain a 'success' boolean field");
      return { success: false, error: "Invalid assertion result format" };
    }
    return parsedResult;
  }

  return { success: false, error: "Failed to run assertion" };
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

  if (testConfigs.length !== metrics.length) {
    console.error("Mismatch between test configurations and metrics");
    return;
  }

  // Initialize variables from the response
  const initialVariables = {};
  if (response.data.execution_result.pulse.variables) {
    response.data.execution_result.pulse.variables.forEach((variable) => {
      try {
        initialVariables[variable.name] = variable.value;
      } catch (error) {
        console.error(
          `Error initializing variable ${variable.name}:`,
          error.message
        );
      }
    });
  }

  const context = createContext(initialVariables);

  const results = [];
  let allTestsPassed = true;

  for (let i = 0; i < testConfigs.length; i++) {
    const testConfig = testConfigs[i];
    const testMetrics = metrics[i];

    console.log(`Running test: ${testConfig.name}`);

    // Interpolate variables in the testConfig
    const interpolatedTestConfig = interpolateObject(
      testConfig,
      initialVariables
    );

    console.log(
      "Interpolated Test Config:",
      JSON.stringify(interpolatedTestConfig, null, 2)
    );
    console.log("Test metrics:", JSON.stringify(testMetrics, null, 2));

    const assertion = interpolatedTestConfig.evaluation_function;
    const result = runAssertionFunction(context, testMetrics, assertion);

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
  console.log("Final context state:", context);
}

main().catch(console.error);
