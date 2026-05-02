import React, { useEffect, useMemo, useRef, useState } from "react";
import "./QueryTable.css";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import LayoutColumnItem from "./queryTable/LayoutColumnItem";
import LayoutDropZone from "./queryTable/LayoutDropZone";
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

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL ?? "";
const AVAILABLE_CONTAINER_ID = "available-columns";
const VISIBLE_CONTAINER_ID = "visible-columns";

function QueryTable({ query, accessToken }) {
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

  const columnMap = useMemo(
    () => new Map(derivedColumns.map((column) => [column.key, column])),
    [derivedColumns]
  );

  const [visibleColumnKeys, setVisibleColumnKeys] = useState(
    DEFAULT_COLUMNS.map((column) => column.key)
  );
  const [filters, setFilters] = useState(() => createDefaultFilterState(DEFAULT_COLUMNS));
  const [sortConfigs, setSortConfigs] = useState([{
    key: DEFAULT_COLUMNS[0]?.key || "_id",
    direction: "asc",
  }]);
  const [activeFilterColumn, setActiveFilterColumn] = useState(null);
  const [activeColumnMenu, setActiveColumnMenu] = useState(null);
  const [groupedColumnKeys, setGroupedColumnKeys] = useState([]);
  const [expandedGroupKeys, setExpandedGroupKeys] = useState(() => new Set());
  const [layoutsOpen, setLayoutsOpen] = useState(false);
  const [activeDraggedColumnKey, setActiveDraggedColumnKey] = useState(null);
  const [savedLayouts, setSavedLayouts] = useState([]);
  const [selectedLayoutId, setSelectedLayoutId] = useState("");
  const [layoutName, setLayoutName] = useState("");
  const [layoutMessage, setLayoutMessage] = useState("");
  const [isSavingLayout, setIsSavingLayout] = useState(false);

  const filterPopupRef = useRef(null);
  const columnMenuRef = useRef(null);
  const layoutsPopupRef = useRef(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    })
  );

  useEffect(() => {
    setVisibleColumnKeys((current) => {
      const existingKeys = new Set(derivedColumns.map((column) => column.key));
      const filteredKeys = current.filter((key) => existingKeys.has(key));

      if (filteredKeys.length > 0) {
        return filteredKeys;
      }

      return DEFAULT_COLUMNS.map((column) => column.key).filter((key) =>
        existingKeys.has(key)
      );
    });
  }, [derivedColumns]);

  useEffect(() => {
    setFilters((current) => {
      const next = { ...current };

      derivedColumns.forEach((column) => {
        if (!next[column.key]) {
          next[column.key] = { operator: "contains", value: "" };
        }
      });

      Object.keys(next).forEach((key) => {
        if (!columnMap.has(key)) {
          delete next[key];
        }
      });

      return next;
    });

    setSortConfigs((current) =>
      current.filter((config) => columnMap.has(config.key))
    );

    setGroupedColumnKeys((current) => current.filter((key) => columnMap.has(key)));

    setActiveFilterColumn((current) => {
      if (!current) return current;
      return columnMap.has(current) ? current : null;
    });
  }, [derivedColumns, columnMap]);

  useEffect(() => {
    setGroupedColumnKeys((current) =>
      current.filter((key) => visibleColumnKeys.includes(key))
    );

    setActiveColumnMenu((current) => {
      if (!current) return current;
      return visibleColumnKeys.includes(current) ? current : null;
    });
  }, [visibleColumnKeys]);

  useEffect(() => {
    if (!accessToken) {
      setSavedLayouts([]);
      setSelectedLayoutId("");
      return;
    }

    let isCancelled = false;

    async function loadLayouts() {
      try {
        const response = await fetch(`${API_BASE_URL}/api/table-layouts`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Failed to load layouts.");
        }

        if (!isCancelled) {
          setSavedLayouts(data.layouts || []);
        }
      } catch (error) {
        if (!isCancelled) {
          setLayoutMessage(error.message || "Failed to load layouts.");
        }
      }
    }

    loadLayouts();

    return () => {
      isCancelled = true;
    };
  }, [accessToken]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (
        filterPopupRef.current &&
        !filterPopupRef.current.contains(event.target)
      ) {
        setActiveFilterColumn(null);
      }

      if (
        columnMenuRef.current &&
        !columnMenuRef.current.contains(event.target)
      ) {
        setActiveColumnMenu(null);
      }

      if (
        layoutsPopupRef.current &&
        !layoutsPopupRef.current.contains(event.target)
      ) {
        setLayoutsOpen(false);
      }
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        setActiveFilterColumn(null);
        setActiveColumnMenu(null);
        setLayoutsOpen(false);
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
    return visibleColumnKeys
      .map((key) => columnMap.get(key))
      .filter(Boolean);
  }, [visibleColumnKeys, columnMap]);

  const hiddenColumns = useMemo(() => {
    const visibleSet = new Set(visibleColumnKeys);
    return derivedColumns
      .filter((column) => !visibleSet.has(column.key))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [derivedColumns, visibleColumnKeys]);

  const hiddenColumnKeys = useMemo(
    () => hiddenColumns.map((column) => column.key),
    [hiddenColumns]
  );

  const activeDraggedColumn = useMemo(() => {
    return columnMap.get(activeDraggedColumnKey) || null;
  }, [columnMap, activeDraggedColumnKey]);

  const filteredRows = useMemo(() => {
    return tableRows.filter((row) =>
      derivedColumns.every((column) =>
        matchesFilter(getValueByPath(row, column.key), filters[column.key], column.type)
      )
    );
  }, [tableRows, filters, derivedColumns]);

  const sortedRows = useMemo(() => {
    const rows = [...filteredRows];

    rows.sort((a, b) => {
      for (const sortConfig of sortConfigs) {
        let valueA = getValueByPath(a, sortConfig.key);
        let valueB = getValueByPath(b, sortConfig.key);

        const columnType = columnMap.get(sortConfig.key)?.type || "text";

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
      }

      return 0;
    });

    return rows;
  }, [filteredRows, sortConfigs, columnMap]);

  const groupedRows = useMemo(() => {
    if (groupedColumnKeys.length === 0) {
      return [];
    }

    const groups = new Map();

    sortedRows.forEach((row) => {
      const values = {};
      const keyParts = groupedColumnKeys.map((columnKey) => {
        const formattedValue = formatCellValue(getValueByPath(row, columnKey));
        const displayValue = String(formattedValue || "").trim() || "Blank";
        values[columnKey] = displayValue;
        return displayValue;
      });
      const groupKey = JSON.stringify(keyParts);

      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          type: "group",
          key: groupKey,
          values,
          rows: [],
        });
      }

      groups.get(groupKey).rows.push(row);
    });

    return Array.from(groups.values());
  }, [sortedRows, groupedColumnKeys]);

  const displayRows = useMemo(() => {
    if (groupedColumnKeys.length === 0) {
      return sortedRows.map((row, index) => ({
        type: "row",
        row,
        key: row?._id ?? `${query.id || "query"}-${index}`,
      }));
    }

    return groupedRows.flatMap((group) => {
      const rows = [group];
      if (expandedGroupKeys.has(group.key)) {
        group.rows.forEach((row, index) => {
          rows.push({
            type: "child",
            row,
            key: `${group.key}-${row?._id ?? index}`,
          });
        });
      }
      return rows;
    });
  }, [expandedGroupKeys, groupedColumnKeys.length, groupedRows, query.id, sortedRows]);

  const displayedResultCount =
    groupedColumnKeys.length > 0 ? groupedRows.length : sortedRows.length;

  const activeFilterCount = derivedColumns.filter((column) =>
    hasActiveFilter(column.key)
  ).length;

  function handleSort(columnKey) {
    setSortConfigs((current) => {
      const existingConfig = current.find((config) => config.key === columnKey);

      if (!existingConfig) {
        return [...current, { key: columnKey, direction: "asc" }];
      }

      if (existingConfig.direction === "asc") {
        return current.map((config) =>
          config.key === columnKey ? { ...config, direction: "desc" } : config
        );
      }

      return current.filter((config) => config.key !== columnKey);
    });
  }

  function getSortIndicator(columnKey) {
    const sortIndex = sortConfigs.findIndex((config) => config.key === columnKey);
    if (sortIndex === -1) return "↕";
    const direction = sortConfigs[sortIndex].direction === "asc" ? "▲" : "▼";
    return `${direction}${sortConfigs.length > 1 ? sortIndex + 1 : ""}`;
  }

  function toggleColumnMenu(columnKey) {
    setActiveColumnMenu((current) => (current === columnKey ? null : columnKey));
    setLayoutsOpen(false);
  }

  function openFilterModal(columnKey) {
    setActiveFilterColumn(columnKey);
    setActiveColumnMenu(null);
    setLayoutsOpen(false);
  }

  function toggleGroupColumn(columnKey) {
    setGroupedColumnKeys((current) => {
      if (current.includes(columnKey)) {
        return current.filter((key) => key !== columnKey);
      }

      return [...current, columnKey];
    });
    setExpandedGroupKeys(new Set());
    setActiveColumnMenu(null);
  }

  function toggleGroupExpanded(groupKey) {
    setExpandedGroupKeys((current) => {
      const next = new Set(current);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  }

  function updateFilter(columnKey, updates) {
    setFilters((current) => ({
      ...current,
      [columnKey]: {
        ...(current[columnKey] || { operator: "contains", value: "" }),
        ...updates,
      },
    }));
  }

  function clearFilter(columnKey) {
    setFilters((current) => ({
      ...current,
      [columnKey]: {
        operator: "contains",
        value: "",
      },
    }));
  }

  function hasActiveFilter(columnKey) {
    const filter = filters[columnKey];
    if (!filter) return false;

    const operatorWithoutValue = ["is_empty", "is_not_empty"];
    if (operatorWithoutValue.includes(filter.operator)) return true;

    return String(filter.value || "").trim() !== "";
  }

  function getContainerId(itemId) {
    if (itemId === AVAILABLE_CONTAINER_ID || itemId === VISIBLE_CONTAINER_ID) {
      return itemId;
    }

    if (visibleColumnKeys.includes(itemId)) {
      return VISIBLE_CONTAINER_ID;
    }

    if (hiddenColumnKeys.includes(itemId)) {
      return AVAILABLE_CONTAINER_ID;
    }

    return null;
  }

  function handleDragStart(event) {
    setActiveDraggedColumnKey(event.active.id);
  }

  function handleDragCancel() {
    setActiveDraggedColumnKey(null);
  }

  function handleDragEnd(event) {
    const { active, over } = event;
    setActiveDraggedColumnKey(null);

    if (!over) {
      return;
    }

    const activeId = active.id;
    const overId = over.id;
    const sourceContainer = getContainerId(activeId);
    const destinationContainer = getContainerId(overId);

    if (!sourceContainer || !destinationContainer) {
      return;
    }

    if (
      sourceContainer === VISIBLE_CONTAINER_ID &&
      destinationContainer === AVAILABLE_CONTAINER_ID
    ) {
      if (visibleColumnKeys.length === 1) {
        setLayoutMessage("At least one column must stay visible.");
        return;
      }

      setVisibleColumnKeys((current) => current.filter((key) => key !== activeId));
      setLayoutMessage("");
      return;
    }

    if (
      sourceContainer === AVAILABLE_CONTAINER_ID &&
      destinationContainer === VISIBLE_CONTAINER_ID
    ) {
      setVisibleColumnKeys((current) => {
        if (current.includes(activeId)) {
          return current;
        }

        const next = [...current];
        const overIndex = current.includes(overId) ? current.indexOf(overId) : current.length;
        next.splice(overIndex, 0, activeId);
        return next;
      });
      setLayoutMessage("");
      return;
    }

    if (
      sourceContainer === VISIBLE_CONTAINER_ID &&
      destinationContainer === VISIBLE_CONTAINER_ID &&
      activeId !== overId
    ) {
      setVisibleColumnKeys((current) => {
        const oldIndex = current.indexOf(activeId);
        const newIndex = current.includes(overId) ? current.indexOf(overId) : current.length - 1;

        if (oldIndex === -1 || newIndex === -1) {
          return current;
        }

        return arrayMove(current, oldIndex, newIndex);
      });
      setLayoutMessage("");
    }
  }

  function applyLayoutColumns(columnKeys) {
    const availableKeys = new Set(derivedColumns.map((column) => column.key));
    const normalizedKeys = [];
    const seen = new Set();

    columnKeys.forEach((key) => {
      if (availableKeys.has(key) && !seen.has(key)) {
        seen.add(key);
        normalizedKeys.push(key);
      }
    });

    if (normalizedKeys.length === 0) {
      setLayoutMessage("That layout does not include any columns available in this query.");
      return;
    }

    setVisibleColumnKeys(normalizedKeys);
    setLayoutMessage(
      `Applied layout with ${normalizedKeys.length} visible column${normalizedKeys.length === 1 ? "" : "s"}.`
    );
  }

  async function handleSaveLayout() {
    const trimmedName = layoutName.trim();
    if (!trimmedName) {
      setLayoutMessage("Enter a name before saving the layout.");
      return;
    }

    if (visibleColumnKeys.length === 0) {
      setLayoutMessage("At least one visible column is required.");
      return;
    }

    setIsSavingLayout(true);
    setLayoutMessage("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/table-layouts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          name: trimmedName,
          columns: visibleColumnKeys,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to save layout.");
      }

      const savedLayout = data.layout;
      setSavedLayouts((current) => [savedLayout, ...current]);
      setSelectedLayoutId(savedLayout.id);
      setLayoutName("");
      setLayoutMessage(data.message || "Layout saved successfully.");
    } catch (error) {
      setLayoutMessage(error.message || "Failed to save layout.");
    } finally {
      setIsSavingLayout(false);
    }
  }

  function handleSelectLayout(layoutId) {
    setSelectedLayoutId(layoutId);

    if (!layoutId) {
      setLayoutMessage("");
      return;
    }

    const layout = savedLayouts.find((item) => item.id === layoutId);
    if (!layout) {
      return;
    }

    applyLayoutColumns(layout.columns || []);
  }

  return (
    <section className="query-table-wrapper">
      <div className="query-table-header">
        <div className="query-table-header-left">
          <h2 className="query-table-title">{query.name}</h2>

          <div className="layouts-wrap" ref={layoutsPopupRef}>
            <button
              type="button"
              className={`layouts-button ${layoutsOpen ? "layouts-button-open" : ""}`}
              onClick={() => {
                setLayoutsOpen((current) => !current);
                setActiveFilterColumn(null);
                setActiveColumnMenu(null);
                setLayoutMessage("");
              }}
            >
              Layouts
            </button>

            {layoutsOpen && (
              <div className="layouts-popup">
                <div className="layouts-popup-header">
                  <div>
                    <div className="layouts-popup-title">Table layouts</div>
                    <div className="layouts-popup-subtitle">
                      Drag columns right to show them and left to hide them.
                    </div>
                  </div>

                  <label className="layout-field layout-select-field">
                    <span>Saved layouts</span>
                    <select
                      value={selectedLayoutId}
                      onChange={(event) => handleSelectLayout(event.target.value)}
                    >
                      <option value="">Current unsaved layout</option>
                      {savedLayouts.map((layout) => (
                        <option key={layout.id} value={layout.id}>
                          {layout.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onDragCancel={handleDragCancel}
                >
                  <div className="layouts-builder">
                    <SortableContext
                      items={hiddenColumnKeys}
                      strategy={verticalListSortingStrategy}
                    >
                      <LayoutDropZone
                        containerId={AVAILABLE_CONTAINER_ID}
                        title="Available columns"
                        subtitle="Alphabetical source list"
                        isEmpty={hiddenColumns.length === 0}
                        emptyMessage="All available columns are currently visible."
                      >
                        {hiddenColumns.map((column) => (
                          <LayoutColumnItem
                            key={column.key}
                            column={column}
                            containerId={AVAILABLE_CONTAINER_ID}
                          />
                        ))}
                      </LayoutDropZone>
                    </SortableContext>

                    <SortableContext
                      items={visibleColumnKeys}
                      strategy={verticalListSortingStrategy}
                    >
                      <LayoutDropZone
                        containerId={VISIBLE_CONTAINER_ID}
                        title="Displayed columns"
                        subtitle="Ordered exactly as the table shows them"
                        isEmpty={visibleColumns.length === 0}
                        emptyMessage="Drag columns here to display them in the table."
                      >
                        {visibleColumns.map((column) => (
                          <LayoutColumnItem
                            key={column.key}
                            column={column}
                            containerId={VISIBLE_CONTAINER_ID}
                          />
                        ))}
                      </LayoutDropZone>
                    </SortableContext>
                  </div>

                  <DragOverlay>
                    {activeDraggedColumn ? (
                      <div className="layout-column-item layout-column-item-overlay">
                        <span className="layout-column-handle layout-column-handle-static">☰</span>
                        <div className="layout-column-content">
                          <span className="layout-column-label">{activeDraggedColumn.label}</span>
                          <span className="layout-column-key">{activeDraggedColumn.key}</span>
                        </div>
                      </div>
                    ) : null}
                  </DragOverlay>
                </DndContext>

                <div className="layouts-save-row">
                  <label className="layout-field layout-name-field">
                    <span>Layout name</span>
                    <input
                      type="text"
                      value={layoutName}
                      onChange={(event) => setLayoutName(event.target.value)}
                      placeholder="Example: Analyst triage"
                    />
                  </label>

                  <button
                    type="button"
                    className="save-layout-button"
                    onClick={handleSaveLayout}
                    disabled={isSavingLayout}
                  >
                    {isSavingLayout ? "Saving..." : "Save"}
                  </button>
                </div>

                <div className="layouts-footnote">
                  Changes apply immediately to this table and stay local until you save a layout.
                </div>

                {layoutMessage && <div className="layout-message">{layoutMessage}</div>}
              </div>
            )}
          </div>

          <span className="query-results">
            {displayedResultCount} of {query.resultCount} results
          </span>
        </div>

        <div className="query-table-summary">
          {activeFilterCount > 0 && (
            <span className="active-filter-count">
              {activeFilterCount} filter{activeFilterCount === 1 ? "" : "s"} active
            </span>
          )}
        </div>
      </div>

      <div className="query-table-scroll">
        <table className="query-results-table">
          <thead>
            <tr>
              {groupedColumnKeys.length > 0 && (
                <th className="group-toggle-header" aria-label="Grouped rows" />
              )}

              {visibleColumns.map((column) => (
                <th
                  key={column.key}
                  className={groupedColumnKeys.includes(column.key) ? "grouped-column-header" : ""}
                >
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
                      ref={activeColumnMenu === column.key ? columnMenuRef : null}
                    >
                      <button
                        type="button"
                        className={`filter-header-button ${
                          hasActiveFilter(column.key) || groupedColumnKeys.includes(column.key)
                            ? "filter-header-button-active"
                            : ""
                        }`}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleColumnMenu(column.key);
                        }}
                        aria-label={`Column options for ${column.label}`}
                      >
                        ⋯
                      </button>

                      {activeColumnMenu === column.key && (
                        <div
                          className="column-menu-popup"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <button
                            type="button"
                            className="column-menu-item"
                            onClick={() => openFilterModal(column.key)}
                          >
                            Filter
                          </button>
                          <button
                            type="button"
                            className={`column-menu-item ${
                              groupedColumnKeys.includes(column.key)
                                ? "column-menu-item-active"
                                : ""
                            }`}
                            onClick={() => toggleGroupColumn(column.key)}
                          >
                            Group
                          </button>
                          <button
                            type="button"
                            className="column-menu-item column-menu-item-disabled"
                            disabled
                          >
                            SARNEG
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {displayRows.map((displayRow) => {
              if (displayRow.type === "group") {
                const isExpanded = expandedGroupKeys.has(displayRow.key);

                return (
                  <tr key={displayRow.key} className="query-group-row">
                    <td className="group-toggle-cell">
                      <button
                        type="button"
                        className="group-toggle-button"
                        onClick={() => toggleGroupExpanded(displayRow.key)}
                        aria-label={isExpanded ? "Collapse group" : "Expand group"}
                      >
                        {isExpanded ? "▾" : "▸"}
                      </button>
                    </td>

                    {visibleColumns.map((column) => {
                      const isGroupedColumn = groupedColumnKeys.includes(column.key);
                      return (
                        <td
                          key={column.key}
                          className={isGroupedColumn ? "grouped-column-cell" : ""}
                        >
                          {isGroupedColumn && (
                            <span className="group-summary-value">
                              {displayRow.values[column.key]}
                              <span className="group-record-count">
                                {displayRow.rows.length} record
                                {displayRow.rows.length === 1 ? "" : "s"}
                              </span>
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              }

              return (
                <tr
                  key={displayRow.key}
                  className={displayRow.type === "child" ? "query-group-child-row" : ""}
                >
                  {groupedColumnKeys.length > 0 && <td className="group-toggle-cell" />}
                  {visibleColumns.map((column) => (
                    <td key={column.key}>
                      {formatCellValue(getValueByPath(displayRow.row, column.key))}
                    </td>
                  ))}
                </tr>
              );
            })}

            {displayRows.length === 0 && (
              <tr>
                <td
                  colSpan={visibleColumns.length + (groupedColumnKeys.length > 0 ? 1 : 0)}
                  className="query-table-empty"
                >
                  No results match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {activeFilterColumn && (
        <div className="filter-modal-backdrop" role="presentation">
          <div
            className="filter-modal"
            ref={filterPopupRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="filter-modal-title"
          >
            <div className="filter-modal-header">
              <h3 id="filter-modal-title">
                Filter {columnMap.get(activeFilterColumn)?.label || "column"}
              </h3>
              <button
                type="button"
                className="filter-modal-close"
                onClick={() => setActiveFilterColumn(null)}
                aria-label="Close filter"
              >
                ×
              </button>
            </div>

            <label className="filter-field">
              <span>Condition</span>
              <select
                value={filters[activeFilterColumn]?.operator || "contains"}
                onChange={(event) =>
                  updateFilter(activeFilterColumn, {
                    operator: event.target.value,
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
              filters[activeFilterColumn]?.operator || "contains"
            ) && (
              <label className="filter-field">
                <span>Value</span>
                <input
                  type={
                    columnMap.get(activeFilterColumn)?.type === "number"
                      ? "number"
                      : "text"
                  }
                  value={filters[activeFilterColumn]?.value || ""}
                  onChange={(event) =>
                    updateFilter(activeFilterColumn, {
                      value: event.target.value,
                    })
                  }
                  placeholder={`Enter ${(
                    columnMap.get(activeFilterColumn)?.label || "value"
                  ).toLowerCase()}...`}
                />
              </label>
            )}

            <div className="filter-popup-actions">
              <button
                type="button"
                className="filter-action-button filter-clear-button"
                onClick={() => clearFilter(activeFilterColumn)}
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
        </div>
      )}
    </section>
  );
}

export default QueryTable;
