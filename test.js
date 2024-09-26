const vm = require("vm");

async function main() {
  // Create a new context
  const context = vm.createContext({
    console: console,
    initialValue: 5,
    Math: Math,
    Date: Date,
  });

  // A more complex function to execute
  const functionToExecute = `
    function complexTest(input) {
      var x = 10;
      let y = 20;
      const z = 30;
      globalVar = 40;

      try {
        if (input > 50) {
          for (let i = 0; i < 3; i++) {
            x += i;
            y *= 2;
          }
          throw new Error("Input too high!");
        } else if (input < 0) {
          let negativeSum = 0;
          for (let i = input; i < 0; i++) {
            negativeSum += i;
          }
          return negativeSum;
        } else {
          let result = 0;
          for (let i = 0; i < input; i++) {
            if (i % 2 === 0) {
              result += i;
            } else {
              result -= i;
            }
          }
          x = Math.max(x, result);
          y = Math.min(y, result);
        }

        let dateCheck = new Date().getFullYear() > 2020 ? "Future" : "Past";

        globalObj = {
          sum: x + y + z,
          product: x * y * z,
          dateStatus: dateCheck
        };

        return {
          x: x,
          y: y,
          z: z,
          globalVarCheck: globalVar === 40,
          initialValueCheck: initialValue === 5,
          complexCalc: (x * y) / (z + initialValue),
          globalObj: globalObj
        };
      } catch (error) {
        errorMessage = error.message;
        return { error: error.message, x: x, y: y };
      }
    }

    // Test the function with different inputs
    let result1 = complexTest(25);
    let result2 = complexTest(-5);
    let result3 = complexTest(60);

    // Return all results
    [result1, result2, result3];
  `;

  try {
    // Execute the function in the context
    const results = vm.runInContext(functionToExecute, context);
    // console.log("Function results:", JSON.stringify(results, null, 2));

    // Capture and print the context
    console.log("\nContext after execution:");
    for (let key in context) {
      if (context.hasOwnProperty(key) && typeof context[key] !== "function") {
        console.log(`${key}:`, JSON.stringify(context[key], null, 2));
      }
    }

    // Access specific variables from the context
    console.log("\nAccessing specific variables:");
    console.log("globalVar:", vm.runInContext("globalVar", context));
    console.log(
      "globalObj:",
      JSON.stringify(vm.runInContext("globalObj", context), null, 2)
    );
    console.log("errorMessage:", vm.runInContext("errorMessage", context));
  } catch (error) {
    console.error("Error during execution:", error);
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        error: error.message,
        stack: error.stack,
      },
      null,
      2
    )
  );
});
