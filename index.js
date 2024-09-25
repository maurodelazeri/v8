const v8 = require("v8");
const vm = require("vm");
const acorn = require("acorn");
const walk = require("acorn-walk");
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

function injectVariableTracking(code) {
  // Wrap the code in a function to allow 'return' statements
  const wrappedCode = `function __tempFunction__() {\n${code}\n}`;
  const ast = acorn.parse(wrappedCode, { ecmaVersion: 2020, locations: true });
  const variableNames = new Set();
  const lines = code.split("\n");
  const modifiedLines = [];
  const linesToInject = {};

  // Adjust line numbers because of the wrapping function
  const lineOffset = 1; // Since we added one line at the top

  // Collect variable names and their assignment lines
  walk.simple(ast, {
    VariableDeclarator(node) {
      if (node.id.type === "ObjectPattern") {
        // Handle object destructuring
        node.id.properties.forEach((prop) => {
          const varName = prop.key.name;
          variableNames.add(varName);
          const lineNumber = node.loc.start.line - lineOffset; // Adjust line number
          if (!linesToInject[lineNumber]) linesToInject[lineNumber] = [];
          linesToInject[lineNumber].push(varName);
        });
      } else if (node.id.type === "Identifier") {
        const varName = node.id.name;
        variableNames.add(varName);
        const lineNumber = node.loc.start.line - lineOffset; // Adjust line number
        if (!linesToInject[lineNumber]) linesToInject[lineNumber] = [];
        linesToInject[lineNumber].push(varName);
      }
    },
    AssignmentExpression(node) {
      if (node.left.type === "Identifier") {
        const varName = node.left.name;
        variableNames.add(varName);
        const lineNumber = node.loc.start.line - lineOffset; // Adjust line number
        if (!linesToInject[lineNumber]) linesToInject[lineNumber] = [];
        linesToInject[lineNumber].push(varName);
      }
    },
    CallExpression(node) {
      if (
        node.callee &&
        node.callee.name === "pfAddVariable" &&
        node.arguments.length >= 1 &&
        node.arguments[0].type === "Literal"
      ) {
        const varName = node.arguments[0].value;
        variableNames.add(varName);
        const lineNumber = node.loc.start.line - lineOffset; // Adjust line number
        if (!linesToInject[lineNumber]) linesToInject[lineNumber] = [];
        linesToInject[lineNumber].push(varName);
      }
    },
  });

  // Initialize variableStates and failureReasons
  modifiedLines.push("var __variableStates = {};");
  modifiedLines.push("var __failureReasons = [];");

  // Inject variable tracking code after relevant lines
  for (let i = 0; i < lines.length; i++) {
    modifiedLines.push(lines[i]);

    if (linesToInject[i]) {
      linesToInject[i].forEach((varName) => {
        modifiedLines.push(`__variableStates['${varName}'] = ${varName};`);
      });
    }

    // Special handling for 'const success = ...'
    if (lines[i].trim().startsWith("const success =")) {
      const successAssignment = lines[i].trim();
      const conditionsString = successAssignment
        .substring(successAssignment.indexOf("=") + 1)
        .trim()
        .replace(/;$/, "");

      // Split conditions by '&&' and '||'
      const conditions = conditionsString.split(/&&|\|\|/).map((s) => s.trim());

      conditions.forEach((condition) => {
        modifiedLines.push(`
          try {
            if (!(${condition})) {
              __failureReasons.push('${condition} is false');
            }
          } catch (e) {
            __failureReasons.push('Error evaluating: ${condition}');
          }
        `);
      });
    }
  }

  // Modify the return statement to include variableStates and failureReasons
  let modifiedCode = modifiedLines.join("\n");

  // Replace the original return statement
  modifiedCode = modifiedCode.replace(
    /return\s+({[\s\S]*?});?/,
    "return { variableStates: __variableStates, failureReasons: __failureReasons, ...$1 };"
  );

  return modifiedCode;
}

function runAssertionFunction(context, metrics, assertion) {
  // Ensure metrics are accessible correctly
  context.metrics = metrics;
  context.params = { metrics: metrics };

  var decodedEvaluationCode = Buffer.from(assertion, "base64").toString(
    "utf-8"
  );

  // Extract function body
  var functionBodyStart = decodedEvaluationCode.indexOf("{") + 1;
  var functionBodyEnd = decodedEvaluationCode.lastIndexOf("}");
  var functionBody = decodedEvaluationCode.substring(
    functionBodyStart,
    functionBodyEnd
  );

  // Inject variable tracking code
  var modifiedFunctionBody = injectVariableTracking(functionBody);

  // Wrap the function code
  var wrappedCode = `
    (function() {
      try {
        var result = (function main(params) {
          ${modifiedFunctionBody}
        })(params);

        return JSON.stringify(result);
      } catch (e) {
        return JSON.stringify({ error: e.message, stack: e.stack });
      }
    })()
  `;

  try {
    var resultString = runInContext(context, wrappedCode);
    var result = JSON.parse(resultString);

    if (result.error) {
      console.error("Assertion error:", result.error);
      console.error("Stack trace:", result.stack);
      return { success: false, error: result.error };
    }
    if (typeof result.success !== "boolean") {
      console.error("Assertion result must contain a 'success' boolean field");
      return { success: false, error: "Invalid assertion result format" };
    }

    // Now, result.variableStates contains the variable values
    return result;
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

    console.log(`Test result for ${testConfig.name}:`);
    console.log(`  Success: ${result.success}`);
    if (result.failureReasons && result.failureReasons.length > 0) {
      console.log(`  Failure Reasons:`);
      result.failureReasons.forEach((reason) => {
        console.log(`    - ${reason}`);
      });
    }
    if (result.variableStates) {
      console.log(`  Variable States:`);
      Object.keys(result.variableStates).forEach((varName) => {
        console.log(`    ${varName}:`);
        console.log(
          `      After: ${JSON.stringify(result.variableStates[varName])}`
        );
      });
    }

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
