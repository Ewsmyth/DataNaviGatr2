/*
 * Shared table helpers for QueryTable and any page that needs to display saved
 * Mongo rows. These functions keep formatting, nested-path lookup, type
 * guessing, and filter matching in one place so the table component can focus
 * on UI state instead of data-shaping details.
 */

/*
 * Builds the initial filter object keyed by column key.
 * Each column starts as a blank "contains" filter because that is the most
 * forgiving default for text, numeric strings, arrays, and object values.
 */
export function createDefaultFilterState(columns) {
  return columns.reduce((acc, column) => {
    acc[column.key] = { operator: "contains", value: "" };
    return acc;
  }, {});
}

/*
 * Reads a value from a row by either an exact key or a dot-separated path.
 * The exact-key check matters because Mongo-flattened rows can legitimately
 * contain field names with dots, while normalized records may also contain
 * deeply nested objects that need path traversal.
 */
export function getValueByPath(row, key) {
  if (!row || !key) return undefined;

  if (Object.prototype.hasOwnProperty.call(row, key)) {
    return row[key];
  }

  return String(key)
    .split(".")
    .reduce((current, segment) => {
      if (current === null || current === undefined) return undefined;

      if (Array.isArray(current) && /^\d+$/.test(segment)) {
        return current[Number(segment)];
      }

      return current[segment];
    }, row);
}

/*
 * Converts arbitrary cell values into user-readable text.
 * Arrays are flattened into comma-separated text, objects are kept as JSON, and
 * empty/null values become an empty string so the table does not render "null".
 */
export function formatCellValue(value) {
  if (value === null || value === undefined) return "";

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (item === null || item === undefined) return "";
        if (typeof item === "object") return JSON.stringify(item);
        return String(item);
      })
      .filter(Boolean)
      .join(", ");
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return value;
}

/*
 * Inspects the first meaningful value for a column and labels it as "number" or
 * "text". QueryTable uses this to decide whether numeric filter operators
 * should compare as numbers or fall back to string matching.
 */
export function inferColumnType(rows, key) {
  for (const row of rows) {
    const value = getValueByPath(row, key);
    if (value === null || value === undefined || value === "") continue;

    if (typeof value === "number") return "number";

    if (Array.isArray(value) || typeof value === "object") {
      return "text";
    }

    const numericValue = Number(value);
    if (!Number.isNaN(numericValue) && String(value).trim() !== "") {
      return "number";
    }

    return "text";
  }

  return "text";
}

/*
 * Turns unexpected Mongo keys into a table-friendly header label.
 * Example: normalized.mobileCountry -> NORMALIZED_MOBILE_COUNTRY.
 */
export function formatDynamicLabel(key) {
  return String(key)
    .replace(/\./g, "_")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toUpperCase();
}

/*
 * Applies one table filter against one cell value.
 * rowValue is the original value from the row, filter carries the operator and
 * typed input from the UI, and columnType tells the function when numeric
 * comparisons are safe to attempt.
 */
export function matchesFilter(rowValue, filter, columnType) {
  const operator = filter?.operator || "contains";
  const rawValue = filter?.value || "";

  const formattedRowValue = formatCellValue(rowValue);
  const stringRowValue =
    formattedRowValue === null || formattedRowValue === undefined
      ? ""
      : String(formattedRowValue);
  const normalizedRowValue = stringRowValue.toLowerCase();
  const normalizedFilterValue = String(rawValue).toLowerCase().trim();

  if (operator === "is_empty") {
    return normalizedRowValue.trim() === "";
  }

  if (operator === "is_not_empty") {
    return normalizedRowValue.trim() !== "";
  }

  if (normalizedFilterValue === "") {
    return true;
  }

  if (operator === "greater_than" || operator === "less_than") {
    const rowNumber = Number(rowValue);
    const filterNumber = Number(rawValue);

    if (Number.isNaN(rowNumber) || Number.isNaN(filterNumber)) {
      return false;
    }

    return operator === "greater_than"
      ? rowNumber > filterNumber
      : rowNumber < filterNumber;
  }

  if (
    columnType === "number" &&
    (operator === "equals" || operator === "not_equals")
  ) {
    const rowNumber = Number(rowValue);
    const filterNumber = Number(rawValue);

    if (!Number.isNaN(rowNumber) && !Number.isNaN(filterNumber)) {
      return operator === "equals"
        ? rowNumber === filterNumber
        : rowNumber !== filterNumber;
    }
  }

  switch (operator) {
    case "contains":
      return normalizedRowValue.includes(normalizedFilterValue);
    case "not_contains":
      return !normalizedRowValue.includes(normalizedFilterValue);
    case "equals":
      return normalizedRowValue === normalizedFilterValue;
    case "not_equals":
      return normalizedRowValue !== normalizedFilterValue;
    case "starts_with":
      return normalizedRowValue.startsWith(normalizedFilterValue);
    case "ends_with":
      return normalizedRowValue.endsWith(normalizedFilterValue);
    default:
      return true;
  }
}
