export function buildInitialValues(template) {
  return template.fields.reduce((acc, field) => {
    acc[field.key] = field.key === "result_limit" ? "1000" : "";
    return acc;
  }, {});
}
