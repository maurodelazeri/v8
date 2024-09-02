function applyTemplate(data, placeholders) {
  function replacePlaceholders(s, placeholders) {
    return s.replace(/\{\{\s*(.*?)\s*\}\}/g, (match, placeholder) => {
      const ph = placeholders.find((p) => p.Placeholder === placeholder);
      return ph !== undefined ? ph.Value : match;
    });
  }

  function applyTemplateTo(value) {
    if (value === null || value === undefined) {
      return value;
    }

    if (typeof value === "string") {
      return replacePlaceholders(value, placeholders);
    }

    if (typeof value === "number" || typeof value === "boolean") {
      const strValue = String(value);
      const newValue = replacePlaceholders(strValue, placeholders);
      if (typeof value === "number") {
        return isNaN(Number(newValue)) ? value : Number(newValue);
      }
      return newValue === "true" ? true : newValue === "false" ? false : value;
    }

    if (Array.isArray(value)) {
      return value.map((item) => applyTemplateTo(item));
    }

    if (typeof value === "object") {
      const newObj = {};
      for (const [key, val] of Object.entries(value)) {
        newObj[key] = applyTemplateTo(val);
      }
      return newObj;
    }

    return value;
  }

  return applyTemplateTo(data);
}

module.exports = applyTemplate;
