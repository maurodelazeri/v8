const v8 = require("v8");
const vm = require("vm");
const acorn = require("acorn");
const walk = require("acorn-walk");
const escodegen = require("escodegen");
const { Buffer } = require("buffer");
const { metrics, testConfigs, requestVariables } = require("./fetchMetrics");

function createContext(initialVariables = {}) {
  const sharedContext = {
    console: console,
    pfAddVariable: function (name, value) {
      if (typeof name !== "string") {
        throw new Error("Name must be a string");
      }
      this[name] = value;
      return "OK";
    },
    pfDeleteVariable: function (name) {
      if (typeof name !== "string") {
        throw new Error("Name must be a string");
      }
      if (name in this) {
        delete this[name];
        return "OK";
      } else {
        throw new Error(`Variable '${name}' not found`);
      }
    },
    ...initialVariables,
    __variableStates: {},
    __failureReasons: [],
    Buffer: Buffer,
  };

  const context = vm.createContext(sharedContext);
  return context;
}

function runInContext(context, code) {
  try {
    const script = new vm.Script(code);
    return script.runInContext(context);
  } catch (error) {
    throw error;
  }
}

function injectVariableTracking(code) {
  const wrappedCode = `function __tempFunction__() {\n${code}\n}`;
  const ast = acorn.parse(wrappedCode, { ecmaVersion: 2020, locations: true });
  const variableNames = new Set();
  const lines = code.split("\n");
  const modifiedLines = [];
  const linesToInject = {};
  const ifStatements = [];

  const lineOffset = 1;

  walk.simple(ast, {
    VariableDeclarator(node) {
      if (node.id.type === "Identifier") {
        const varName = node.id.name;
        variableNames.add(varName);
        const lineNumber = node.loc.start.line - lineOffset;

        // Check if the variable declared is 'success'
        if (varName === "success") {
          // Handle the conditions in the initializer of 'success'
          const conditions = [];
          function extractConditions(expr) {
            if (expr.type === "LogicalExpression") {
              extractConditions(expr.left);
              extractConditions(expr.right);
            } else {
              conditions.push(expr);
            }
          }
          if (node.init) {
            extractConditions(node.init);

            // Inject code to evaluate each condition
            conditions.forEach((conditionNode) => {
              const conditionCode = escodegen.generate(conditionNode);
              if (!linesToInject[lineNumber]) linesToInject[lineNumber] = [];
              linesToInject[lineNumber].push(`
                try {
                  if (!(${conditionCode})) {
                    __failureReasons.push('${conditionCode} is false');
                  }
                } catch (e) {
                  __failureReasons.push('Error evaluating: ${conditionCode}');
                }
              `);
            });
          }
        }

        if (!linesToInject[lineNumber]) linesToInject[lineNumber] = [];
        linesToInject[lineNumber].push(
          `__variableStates['${varName}'] = ${varName};`
        );
      }
    },
    AssignmentExpression(node) {
      if (node.left.type === "Identifier") {
        const varName = node.left.name;
        variableNames.add(varName);
        const lineNumber = node.loc.start.line - lineOffset;

        // Check if the assignment is to 'success'
        if (varName === "success") {
          // Handle the conditions in the assignment to 'success'
          // Recursively extract conditions
          const conditions = [];
          function extractConditions(expr) {
            if (expr.type === "LogicalExpression") {
              extractConditions(expr.left);
              extractConditions(expr.right);
            } else {
              conditions.push(expr);
            }
          }
          extractConditions(node.right);

          // Inject code to evaluate each condition
          conditions.forEach((conditionNode) => {
            const conditionCode = escodegen.generate(conditionNode);
            if (!linesToInject[lineNumber]) linesToInject[lineNumber] = [];
            linesToInject[lineNumber].push(`
              try {
                if (!(${conditionCode})) {
                  __failureReasons.push('${conditionCode} is false');
                }
              } catch (e) {
                __failureReasons.push('Error evaluating: ${conditionCode}');
              }
            `);
          });
        }

        if (!linesToInject[lineNumber]) linesToInject[lineNumber] = [];
        linesToInject[lineNumber].push(
          `__variableStates['${varName}'] = ${varName};`
        );
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
        const lineNumber = node.loc.start.line - lineOffset;
        if (!linesToInject[lineNumber]) linesToInject[lineNumber] = [];
        linesToInject[lineNumber].push(
          `__variableStates['${varName}'] = ${varName};`
        );
      }
    },
    IfStatement(node) {
      const conditionCode = escodegen.generate(node.test);
      const lineNumber = node.loc.start.line - lineOffset;
      ifStatements.push({ condition: conditionCode, line: lineNumber });
      if (!linesToInject[lineNumber]) linesToInject[lineNumber] = [];
      linesToInject[lineNumber].push(
        `__evaluateCondition(${JSON.stringify(conditionCode)}, ${lineNumber});`
      );
    },
  });

  for (let i = 0; i < lines.length; i++) {
    modifiedLines.push(lines[i]);

    if (linesToInject[i]) {
      linesToInject[i].forEach((item) => {
        if (
          item.startsWith("__evaluateCondition") ||
          item.includes("try") ||
          item.includes("__failureReasons.push")
        ) {
          modifiedLines.push(item);
        } else {
          modifiedLines.push(item);
        }
      });
    }
  }

  let modifiedCode = modifiedLines.join("\n");

  modifiedCode = `
    __variableStates['__ifStatements'] = ${JSON.stringify(ifStatements)};
    function __evaluateCondition(condition, line) {
      try {
        const result = eval(condition);
        __variableStates['__ifStatements'][line] = { condition, result };
        if (!result) {
          __failureReasons.push(\`Condition at line \${line}: "\${condition}" is false\`);
        }
      } catch (e) {
        __failureReasons.push(\`Error evaluating condition at line \${line}: "\${condition}"\`);
      }
    }
    ${modifiedCode}
  `;

  modifiedCode = modifiedCode.replace(
    /return\s+({[\s\S]*?});?/,
    "return { variableStates: __variableStates, failureReasons: __failureReasons, ...$1 };"
  );

  return modifiedCode;
}

function runAssertionFunction(context, metrics, assertion) {
  // Reset __variableStates and __failureReasons before each test
  context.__variableStates = {};
  context.__failureReasons = [];

  context.metrics = metrics;
  context.params = { metrics: metrics };

  var decodedEvaluationCode = Buffer.from(assertion, "base64").toString(
    "utf-8"
  );

  var functionBodyStart = decodedEvaluationCode.indexOf("{") + 1;
  var functionBodyEnd = decodedEvaluationCode.lastIndexOf("}");
  var functionBody = decodedEvaluationCode.substring(
    functionBodyStart,
    functionBodyEnd
  );

  var modifiedFunctionBody = injectVariableTracking(functionBody);

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
      return { success: false, error: result.error, stack: result.stack };
    }
    if (typeof result.success !== "boolean") {
      return { success: false, error: "Invalid assertion result format" };
    }

    return result;
  } catch (error) {
    return { success: false, error: error.message, stack: error.stack };
  }
}

async function main() {
  const output = {
    initialVariables: {},
    testResults: [],
    allTestsPassed: true,
    accumulatedFailureReasons: [],
    error: null,
  };

  try {
    if (Array.isArray(requestVariables)) {
      requestVariables.forEach((variable) => {
        if (
          variable &&
          typeof variable === "object" &&
          "name" in variable &&
          "value" in variable
        ) {
          output.initialVariables[variable.name] = variable.value;
        } else {
          const key = Object.keys(variable)[0];
          const value = variable[key];
          if (key && value !== undefined) {
            output.initialVariables[key] = value;
          } else {
            throw new Error(
              `Invalid variable format: ${JSON.stringify(variable)}`
            );
          }
        }
      });
    } else {
      throw new Error(
        "No variables found or variables format is incorrect in the response payload."
      );
    }

    const sharedContext = createContext(output.initialVariables);

    for (let i = 0; i < testConfigs.length; i++) {
      const testConfig = testConfigs[i];
      const assertion = testConfig.evaluation_function;
      const result = runAssertionFunction(sharedContext, metrics, assertion);

      const testResult = {
        testName: testConfig.name,
        success: result.success,
        failureReasons: result.failureReasons || [],
        variableStates: result.variableStates || {},
        error: result.error,
        stack: result.stack,
      };

      output.testResults.push(testResult);

      if (!result.success) {
        output.allTestsPassed = false;
        output.accumulatedFailureReasons.push(...(result.failureReasons || []));
        if (!testConfig.continue_on_step_failure) {
          break;
        }
      }
    }

    output.accumulatedFailureReasons = [
      ...new Set(output.accumulatedFailureReasons),
    ];
  } catch (error) {
    output.error = error.message;
    output.stack = error.stack;
    output.allTestsPassed = false;
  }

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        error: error.message,
        stack: error.stack,
        allTestsPassed: false,
      },
      null,
      2
    )
  );
});
