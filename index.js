const v8 = require("v8");
const vm = require("vm");
const fetchMetrics = require("./fetchMetrics");

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
      global[name] = value; // Add variable to the global context
      console.log(`Variable added: ${name} = ${value}`);
      return "OK";
    },
    pfDeleteVariable: function (name) {
      if (typeof name !== "string") {
        throw new Error("Name must be a string");
      }
      if (name in context) {
        delete context[name];
        delete global[name]; // Remove variable from the global context
        console.log(`Variable deleted: ${name}`);
        return "OK";
      } else {
        throw new Error(`Variable '${name}' not found`);
      }
    },
  };

  // Add initial variables to both the context and global object
  console.log("Initial Variables:", initialVariables);
  Object.keys(initialVariables).forEach((key) => {
    context[key] = initialVariables[key];
    global[key] = initialVariables[key]; // Ensure the variable is globally accessible
    console.log("Setting variable:", key, initialVariables[key]);
  });

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
        return JSON.stringify({ error: e.message });
      }
    })(${JSON.stringify(metrics)})
  `;

  const result = runInContext(context, wrappedAssertion);

  if (result) {
    const parsedResult = JSON.parse(result);
    if (parsedResult.error) {
      console.error("Assertion error:", parsedResult.error);
      return { success: false, error: parsedResult.error };
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
  if (
    response.data.execution_result.pulse &&
    Array.isArray(response.data.execution_result.pulse.variables)
  ) {
    response.data.execution_result.pulse.variables.forEach((variable) => {
      // Check if the variable is an object with name and value properties
      if (
        variable &&
        typeof variable === "object" &&
        "name" in variable &&
        "value" in variable
      ) {
        initialVariables[variable.name] = variable.value;
      } else {
        // If it's not in the expected format, try to parse it as a key-value pair
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

  // Verify the initial variables are correctly populated
  console.log("Final Initial Variables:", initialVariables);

  // Create context and ensure variables are accessible globally
  const context = createContext(initialVariables);

  const results = [];
  let allTestsPassed = true;

  for (let i = 0; i < testConfigs.length; i++) {
    const testConfig = testConfigs[i];
    const testMetrics = metrics[i];

    console.log(`Running test: ${testConfig.name}`);

    const assertion = testConfig.evaluation_function;
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
  console.log("Final variables state:", context);
}

main().catch(console.error);
