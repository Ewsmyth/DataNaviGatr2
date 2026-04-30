export function buildInitialValues(template) {
  const values = template.fields.reduce((acc, field) => {
    acc[field.key] = field.key === "result_limit" ? "1000" : "";
    return acc;
  }, {});

  if (template.builder === "custom") {
    values.custom_filter = {
      type: "group",
      operator: "and",
      rules: [],
    };
  }

  return values;
}
