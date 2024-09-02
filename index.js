const v8 = require("v8");
const vm = require("vm");
const fetchMetrics = require("./fetchMetrics");

function createContext() {
  const context = vm.createContext({
    console: console,
    pfAddVariable: (name, value) => {
      console.log(`Variable added: ${name} = ${value}`);
      // You might want to actually store this somewhere
    },
  });

  return context;
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
  const context = createContext();

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

  const results = [];
  let allTestsPassed = true;

  for (let i = 0; i < testConfigs.length; i++) {
    const testConfig = testConfigs[i];
    const testMetrics = metrics[i];

    console.log(`Running test: ${testConfig.name}`);
    console.log("Test metrics:", JSON.stringify(testMetrics, null, 2));

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
}

main().catch(console.error);
