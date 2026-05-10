/*
 * Creates the controlled-form value object for a query template.
 * Most fields begin blank, result_limit defaults to 1000 so queries cannot
 * accidentally request an enormous result set, and the custom query builder gets
 * an empty AND group because its UI edits a nested rule tree.
 */
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
