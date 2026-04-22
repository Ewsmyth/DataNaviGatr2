import React, { useEffect, useMemo, useRef, useState } from "react";
import "./QueryTable.css";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove
} from "@dnd-kit/sortable";
import SortableColumnItem from "./queryTable/SortableColumnItem";
import DragOverlayItem from "./queryTable/DragOverlayItem";
import { DEFAULT_COLUMNS } from "../data/queryTableColumns";
import { FILTER_OPERATORS } from "../data/queryFilterOperators";
import {
  createDefaultFilterState,
  formatCellValue,
  formatDynamicLabel,
  getValueByPath,
  inferColumnType,
  matchesFilter,
} from "../utils/queryTableUtils";

function QueryTable({ query }) {
  const tableRows = query.tableData || [];

  const derivedColumns = useMemo(() => {
    const knownKeys = new Set(DEFAULT_COLUMNS.map((column) => column.key));
    const extraKeys = new Set();

    tableRows.forEach((row) => {
      Object.keys(row || {}).forEach((key) => {
        if (!knownKeys.has(key)) {
          extraKeys.add(key);
        }
      });
    });

    const extras = Array.from(extraKeys)
      .sort((a, b) => a.localeCompare(b))
      .map((key) => ({
        key,
        label: formatDynamicLabel(key),
        type: inferColumnType(tableRows, key),
      }));

    return [...DEFAULT_COLUMNS, ...extras];
  }, [tableRows]);

  const [columnConfig, setColumnConfig] = useState(
    DEFAULT_COLUMNS.map((column) => ({
      ...column,
      visible: true
    }))
  );

  const [filters, setFilters] = useState(() => createDefaultFilterState(DEFAULT_COLUMNS));

  const [sortConfig, setSortConfig] = useState({
    key: DEFAULT_COLUMNS[0]?.key || "_id",
    direction: "asc"
  });

  const [activeFilterColumn, setActiveFilterColumn] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeDraggedColumnKey, setActiveDraggedColumnKey] = useState(null);

  const filterPopupRef = useRef(null);
  const settingsPopupRef = useRef(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6
      }
    })
  );

  useEffect(() => {
    setColumnConfig((current) => {
      const currentByKey = new Map(current.map((column) => [column.key, column]));
      return derivedColumns.map((column, index) => {
        const existing = currentByKey.get(column.key);
        return {
          ...column,
          visible: existing ? existing.visible : index < DEFAULT_COLUMNS.length,
        };
      });
    });
  }, [derivedColumns]);

  useEffect(() => {
    setFilters((current) => {
      const next = { ...current };

      columnConfig.forEach((column) => {
        if (!next[column.key]) {
          next[column.key] = { operator: "contains", value: "" };
        }
      });

      Object.keys(next).forEach((key) => {
        const exists = columnConfig.some((column) => column.key === key);
        if (!exists) {
          delete next[key];
        }
      });

      return next;
    });

    setSortConfig((current) => {
      const sortColumnExists = columnConfig.some((column) => column.key === current.key);

      if (sortColumnExists) {
        return current;
      }

      return {
        key: columnConfig[0]?.key || "_id",
        direction: "asc"
      };
    });

    setActiveFilterColumn((current) => {
      if (!current) return current;
      return columnConfig.some((column) => column.key === current) ? current : null;
    });
  }, [columnConfig]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (
        filterPopupRef.current &&
        !filterPopupRef.current.contains(event.target)
      ) {
        setActiveFilterColumn(null);
      }

      if (
        settingsPopupRef.current &&
        !settingsPopupRef.current.contains(event.target)
      ) {
        setSettingsOpen(false);
      }
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        setActiveFilterColumn(null);
        setSettingsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  const visibleColumns = useMemo(() => {
    return columnConfig.filter((column) => column.visible);
  }, [columnConfig]);

  const activeDraggedColumn = useMemo(() => {
    return columnConfig.find((column) => column.key === activeDraggedColumnKey) || null;
  }, [columnConfig, activeDraggedColumnKey]);

  function handleSort(columnKey) {
    setSortConfig((current) => {
      if (current.key === columnKey) {
        return {
          key: columnKey,
          direction: current.direction === "asc" ? "desc" : "asc"
        };
      }

      return {
        key: columnKey,
        direction: "asc"
      };
    });
  }

  function getSortIndicator(columnKey) {
    if (sortConfig.key !== columnKey) return "↕";
    return sortConfig.direction === "asc" ? "▲" : "▼";
  }

  function toggleFilterMenu(columnKey) {
    setActiveFilterColumn((current) => (current === columnKey ? null : columnKey));
    setSettingsOpen(false);
  }

  function updateFilter(columnKey, updates) {
    setFilters((current) => ({
      ...current,
      [columnKey]: {
        ...(current[columnKey] || { operator: "contains", value: "" }),
        ...updates
      }
    }));
  }

  function clearFilter(columnKey) {
    setFilters((current) => ({
      ...current,
      [columnKey]: {
        operator: "contains",
        value: ""
      }
    }));
  }

  function hasActiveFilter(columnKey) {
    const filter = filters[columnKey];
    if (!filter) return false;

    const operatorWithoutValue = ["is_empty", "is_not_empty"];
    if (operatorWithoutValue.includes(filter.operator)) return true;

    return String(filter.value || "").trim() !== "";
  }

  function toggleColumnVisibility(columnKey) {
    setColumnConfig((current) => {
      const visibleCount = current.filter((column) => column.visible).length;

      return current.map((column) => {
        if (column.key !== columnKey) return column;

        if (column.visible && visibleCount === 1) {
          return column;
        }

        return {
          ...column,
          visible: !column.visible
        };
      });
    });
  }

  function handleDragStart(event) {
    setActiveDraggedColumnKey(event.active.id);
  }

  function handleDragEnd(event) {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      setActiveDraggedColumnKey(null);
      return;
    }

    setColumnConfig((current) => {
      const oldIndex = current.findIndex((column) => column.key === active.id);
      const newIndex = current.findIndex((column) => column.key === over.id);

      if (oldIndex === -1 || newIndex === -1) {
        return current;
      }

      return arrayMove(current, oldIndex, newIndex);
    });

    setActiveDraggedColumnKey(null);
  }

  function handleDragCancel() {
    setActiveDraggedColumnKey(null);
  }

  const filteredRows = useMemo(() => {
    return tableRows.filter((row) =>
      columnConfig.every((column) =>
        matchesFilter(getValueByPath(row, column.key), filters[column.key], column.type)
      )
    );
  }, [tableRows, filters, columnConfig]);

  const sortedRows = useMemo(() => {
    const rows = [...filteredRows];

    rows.sort((a, b) => {
      let valueA = getValueByPath(a, sortConfig.key);
      let valueB = getValueByPath(b, sortConfig.key);

      const columnType =
        columnConfig.find((column) => column.key === sortConfig.key)?.type || "text";

      if (valueA === null || valueA === undefined) valueA = "";
      if (valueB === null || valueB === undefined) valueB = "";

      if (columnType === "number") {
        const numA = Number(valueA);
        const numB = Number(valueB);

        valueA = Number.isNaN(numA) ? Number.NEGATIVE_INFINITY : numA;
        valueB = Number.isNaN(numB) ? Number.NEGATIVE_INFINITY : numB;
      } else {
        valueA = String(formatCellValue(valueA)).toLowerCase();
        valueB = String(formatCellValue(valueB)).toLowerCase();
      }

      if (valueA < valueB) return sortConfig.direction === "asc" ? -1 : 1;
      if (valueA > valueB) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });

    return rows;
  }, [filteredRows, sortConfig, columnConfig]);

  const activeFilterCount = columnConfig.filter((column) =>
    hasActiveFilter(column.key)
  ).length;

  return (
    <section className="query-table-wrapper">
      <div className="query-table-header">
        <div className="query-table-header-left">
          <h2 className="query-table-title">{query.name}</h2>
          <span className="query-results">
            {sortedRows.length} of {query.resultCount} results
          </span>
        </div>

        <div className="query-table-summary">
          {activeFilterCount > 0 && (
            <span className="active-filter-count">
              {activeFilterCount} filter{activeFilterCount === 1 ? "" : "s"} active
            </span>
          )}

          <div className="table-settings-wrap" ref={settingsPopupRef}>
            <button
              type="button"
              className="table-settings-button"
              onClick={() => {
                setSettingsOpen((current) => !current);
                setActiveFilterColumn(null);
              }}
              aria-label="Column settings"
              title="Column settings"
            >
              ⚙
            </button>

            {settingsOpen && (
              <div className="table-settings-popup">
                <div className="table-settings-title">Column settings</div>
                <div className="table-settings-subtitle">
                  Check to show columns. Drag to reorder.
                </div>

                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onDragCancel={handleDragCancel}
                >
                  <SortableContext
                    items={columnConfig.map((column) => column.key)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="column-settings-list">
                      {columnConfig.map((column) => (
                        <SortableColumnItem
                          key={column.key}
                          column={column}
                          onToggleVisibility={toggleColumnVisibility}
                        />
                      ))}
                    </div>
                  </SortableContext>

                  <DragOverlay>
                    <DragOverlayItem column={activeDraggedColumn} />
                  </DragOverlay>
                </DndContext>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="query-table-scroll">
        <table className="query-results-table">
          <thead>
            <tr>
              {visibleColumns.map((column) => (
                <th key={column.key}>
                  <div className="header-cell">
                    <button
                      type="button"
                      className="sortable-header-button"
                      onClick={() => handleSort(column.key)}
                    >
                      <span>{column.label}</span>
                      <span className="sort-indicator">
                        {getSortIndicator(column.key)}
                      </span>
                    </button>

                    <div
                      className="header-filter-wrap"
                      ref={activeFilterColumn === column.key ? filterPopupRef : null}
                    >
                      <button
                        type="button"
                        className={`filter-header-button ${
                          hasActiveFilter(column.key)
                            ? "filter-header-button-active"
                            : ""
                        }`}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleFilterMenu(column.key);
                        }}
                        aria-label={`Filter ${column.label}`}
                      >
                        ⛃
                      </button>

                      {activeFilterColumn === column.key && (
                        <div
                          className="filter-popup"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <div className="filter-popup-title">
                            Filter {column.label}
                          </div>

                          <label className="filter-field">
                            <span>Condition</span>
                            <select
                              value={filters[column.key]?.operator || "contains"}
                              onChange={(event) =>
                                updateFilter(column.key, {
                                  operator: event.target.value
                                })
                              }
                            >
                              {FILTER_OPERATORS.map((operator) => (
                                <option key={operator.value} value={operator.value}>
                                  {operator.label}
                                </option>
                              ))}
                            </select>
                          </label>

                          {!["is_empty", "is_not_empty"].includes(
                            filters[column.key]?.operator || "contains"
                          ) && (
                            <label className="filter-field">
                              <span>Value</span>
                              <input
                                type={column.type === "number" ? "number" : "text"}
                                value={filters[column.key]?.value || ""}
                                onChange={(event) =>
                                  updateFilter(column.key, {
                                    value: event.target.value
                                  })
                                }
                                placeholder={`Enter ${column.label.toLowerCase()}...`}
                              />
                            </label>
                          )}

                          <div className="filter-popup-actions">
                            <button
                              type="button"
                              className="filter-action-button filter-clear-button"
                              onClick={() => clearFilter(column.key)}
                            >
                              Clear
                            </button>
                            <button
                              type="button"
                              className="filter-action-button filter-close-button"
                              onClick={() => setActiveFilterColumn(null)}
                            >
                              Done
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {sortedRows.map((row, index) => (
              <tr key={row?._id ?? `${query.id || "query"}-${index}`}>
                {visibleColumns.map((column) => (
                  <td key={column.key}>
                    {formatCellValue(getValueByPath(row, column.key))}
                  </td>
                ))}
              </tr>
            ))}

            {sortedRows.length === 0 && (
              <tr>
                <td colSpan={visibleColumns.length} className="query-table-empty">
                  No results match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default QueryTable;
