const variablesLayer = {
  variables: [],
  pulse: { Variables: [] },

  addVariable: function (key, value) {
    // Check if key and value are defined and are strings
    if (typeof key !== "string" || typeof value !== "string") {
      throw new Error("Key and value must be strings");
    }

    // Check for invalid characters in key and value
    if (
      key.includes("{") ||
      key.includes("}") ||
      value.includes("{") ||
      value.includes("}")
    ) {
      throw new Error(
        "Invalid characters: '{' and '}' are not allowed in key or value"
      );
    }

    // Update the variables array
    let found = false;
    for (let i = 0; i < this.variables.length; i++) {
      if (this.variables[i].Placeholder === key) {
        this.variables[i].Value = value;
        this.pulse.Variables[i].Value = value;
        found = true;
        break;
      }
    }

    // If the variable doesn't exist, append it
    if (!found) {
      this.variables.push({ Placeholder: key, Value: value });
      this.pulse.Variables.push({ Name: key, Value: value });
    }

    // Set the variable in the global context
    global[key] = value;

    return "OK";
  },

  deleteVariable: function (key) {
    // Check if key is defined and is a string
    if (typeof key !== "string") {
      throw new Error("Key must be a string");
    }

    // Remove the variable from the variables array
    let found = false;
    for (let i = 0; i < this.variables.length; i++) {
      if (this.variables[i].Placeholder === key) {
        // Remove the element at index i
        this.variables.splice(i, 1);
        this.pulse.Variables.splice(i, 1);
        found = true;
        break;
      }
    }

    if (!found) {
      throw new Error(`Variable '${key}' not found`);
    }

    // Delete the variable from the global context
    delete global[key];

    return "OK";
  },
};

module.exports = variablesLayer;
