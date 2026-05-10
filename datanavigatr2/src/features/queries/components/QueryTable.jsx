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
  GEO_SELECTION_MESSAGE,
  GEO_STATE_MESSAGE,
  GEO_STATE_REQUEST_MESSAGE,
  GEO_SYNC_CHANNEL,
  getRowIdentity,
  postGeoMessage,
  writeGeoQueryState,
} from "../../geo/utils/geoSync";
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

/*
 * Main saved-query result table.
 * This component owns the analyst-facing table behavior: dynamic columns,
 * filtering, multi-column sorting, grouping, saved layouts, SARNEG export, and
 * synchronization with the separate GeoNaviGatr map window.
 */
function QueryTable({ query, accessToken, loadingProgress }) {
  /*
   * query.tableData is the current batch of saved Mongo result rows. The loading
   * counters come from QueryWorkspacePage while it incrementally fetches result
   * pages from the API.
   */
  const tableRows = query.tableData || [];
  const loadedResultCount = loadingProgress?.loaded ?? tableRows.length;
  const totalResultCount = loadingProgress?.total ?? query.resultCount ?? tableRows.length;
  const isLoadingResults = Boolean(loadingProgress?.isLoading);

  /*
   * Starts with known normalized columns, then scans the actual rows for extra
   * top-level keys so unusual Mongo fields still become available in the layout
   * editor and table without code changes.
   */
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

  /*
   * Table state is deliberately split by concern:
   * visibleColumnKeys controls column order/visibility, filters and sortConfigs
   * control row reduction/order, groupedColumnKeys creates collapsible groups,
   * savedLayouts persists preferred column sets, and selectedGeoRowIds mirrors
   * map selections sent from GeoNaviGatr.
   */
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
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [selectedGeoRowIds, setSelectedGeoRowIds] = useState(() => new Set());
  const [sarnegColumnKey, setSarnegColumnKey] = useState(null);
  const [sarnegKey, setSarnegKey] = useState("");
  const [sarnegMessage, setSarnegMessage] = useState("");

  const filterPopupRef = useRef(null);
  const columnMenuRef = useRef(null);
  const layoutsPopupRef = useRef(null);
  const viewMenuRef = useRef(null);
  const sarnegPopupRef = useRef(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    })
  );

  /*
   * When a new query has different fields, keep any visible columns that still
   * exist and fall back to the default set if nothing survives.
   */
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

  /*
   * Keeps all column-dependent state valid as derived columns change. This
   * prevents old filters, sorts, groups, or open menus from pointing at fields
   * that are not present in the newly opened query.
   */
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

  /*
   * Loads the current user's saved column layouts. Layouts are stored server-side
   * because they should follow the analyst across browser sessions.
   */
  useEffect(() => {
    setGroupedColumnKeys((current) =>
      current.filter((key) => visibleColumnKeys.includes(key))
    );

    setActiveColumnMenu((current) => {
      if (!current) return current;
      return visibleColumnKeys.includes(current) ? current : null;
    });
  }, [visibleColumnKeys]);

  /*
   * Closes popups when the user clicks elsewhere or presses Escape. The refs
   * identify each floating control so unrelated clicks can dismiss it cleanly.
   */
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

      if (
        viewMenuRef.current &&
        !viewMenuRef.current.contains(event.target)
      ) {
        setViewMenuOpen(false);
      }

      if (
        sarnegPopupRef.current &&
        !sarnegPopupRef.current.contains(event.target)
      ) {
        setSarnegColumnKey(null);
      }
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        setActiveFilterColumn(null);
        setActiveColumnMenu(null);
        setLayoutsOpen(false);
        setViewMenuOpen(false);
        setSarnegColumnKey(null);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  /*
   * Derived render collections for the layout builder. visibleColumns preserves
   * user order, while hiddenColumns is alphabetized so the source list is easier
   * to scan.
   */
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

  /*
   * Applies every active column filter to every row. A row stays visible only
   * when all columns match their current filter state.
   */
  const filteredRows = useMemo(() => {
    return tableRows.filter((row) =>
      derivedColumns.every((column) =>
        matchesFilter(getValueByPath(row, column.key), filters[column.key], column.type)
      )
    );
  }, [tableRows, filters, derivedColumns]);

  /*
   * Applies multi-column sorting in the order the user clicked columns. Numeric
   * columns compare as numbers; everything else compares as formatted lowercase
   * text so arrays/objects sort consistently with what the user sees.
   */
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

  /*
   * Builds collapsible group records from the sorted rows. The group key is a
   * JSON array of displayed group values so grouping by multiple columns remains
   * stable even when values contain punctuation.
   */
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

  /*
   * Stable row identities are shared with the map view. Keeping them in a Map
   * avoids recomputing identity paths repeatedly during render.
   */
  const rowIdentityMap = useMemo(() => {
    return new Map(
      sortedRows.map((row, index) => [row, getRowIdentity(row, index)])
    );
  }, [sortedRows]);

  /*
   * The table renders one flattened list whether grouped or ungrouped. Group
   * rows and child rows have different type values so the JSX can render headers
   * and data rows from the same array.
   */
  const displayRows = useMemo(() => {
    if (groupedColumnKeys.length === 0) {
      return sortedRows.map((row, index) => ({
        type: "row",
        row,
        key: row?._id ?? `${query.id || "query"}-${index}`,
        rowId: rowIdentityMap.get(row) || getRowIdentity(row, index),
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
            rowId: rowIdentityMap.get(row) || getRowIdentity(row, index),
          });
        });
      }
      return rows;
    });
  }, [expandedGroupKeys, groupedColumnKeys.length, groupedRows, query.id, rowIdentityMap, sortedRows]);

  const displayedResultCount =
    groupedColumnKeys.length > 0 ? groupedRows.length : sortedRows.length;

  const activeFilterCount = derivedColumns.filter((column) =>
    hasActiveFilter(column.key)
  ).length;

  /*
   * Publishes the latest sorted query rows to GeoNaviGatr and listens for map
   * selections. The map can also request a fresh state if it opens after the
   * table has already written sessionStorage.
   */
  useEffect(() => {
    setSelectedGeoRowIds(new Set());
  }, [query.id]);

  useEffect(() => {
    if (!query?.id) return undefined;

    const payload = writeGeoQueryState(query, sortedRows);
    postGeoMessage({
      type: GEO_STATE_MESSAGE,
      queryId: query.id,
      payload,
    });

    let channel;
    try {
      channel = new BroadcastChannel(GEO_SYNC_CHANNEL);
      channel.onmessage = (event) => {
        const message = event.data || {};
        if (message.queryId !== query.id) return;

        if (message.type === GEO_SELECTION_MESSAGE) {
          setSelectedGeoRowIds(new Set(message.rowIds || []));
        }

        if (message.type === GEO_STATE_REQUEST_MESSAGE) {
          const requestedPayload = writeGeoQueryState(query, sortedRows);
          channel.postMessage({
            type: GEO_STATE_MESSAGE,
            queryId: query.id,
            payload: requestedPayload,
          });
        }
      };
    } catch {}

    return () => {
      channel?.close();
    };
  }, [query, sortedRows]);

  /*
   * Cycles a column through unsorted -> ascending -> descending -> unsorted.
   * Multiple sorted columns are kept, so later clicks become secondary/tertiary
   * sort keys instead of replacing the existing sort.
   */
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

  function openSarnegModal(columnKey) {
    setSarnegColumnKey(columnKey);
    setSarnegKey("");
    setSarnegMessage("");
    setActiveColumnMenu(null);
    setActiveFilterColumn(null);
    setLayoutsOpen(false);
    setViewMenuOpen(false);
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

  /*
   * Merges partial filter edits from dropdowns/inputs into the full filter state
   * for one column.
   */
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

  /*
   * dnd-kit gives ids for dragged items and drop targets. This resolves either
   * kind of id to the logical source/destination bucket in the layout editor.
   */
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

  /*
   * Handles all layout-builder drag outcomes: hide a visible column, show a
   * hidden column, or reorder visible columns. It guards against hiding the last
   * column because the table needs at least one visible field.
   */
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

  /*
   * Applies saved layout columns after removing duplicates and columns that are
   * not available for the currently opened query.
   */
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

  /*
   * Persists the current visible column order for the logged-in user.
   */
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

  /*
   * Opens the map in a new app route after writing the current sorted rows into
   * sessionStorage/BroadcastChannel so the map has data immediately.
   */
  function openGeoNaviGatr() {
    const payload = writeGeoQueryState(query, sortedRows);
    postGeoMessage({
      type: GEO_STATE_MESSAGE,
      queryId: query.id,
      payload,
    });
    setViewMenuOpen(false);
    window.open(`/app/geo/${query.id}`, "_blank");
  }

  /*
   * SARNEG export encodes digits 0-9 using a user-supplied 10-letter alphabet.
   * The key must be exactly ten unique uppercase letters, one per digit.
   */
  function validateSarnegKey(key) {
    const normalizedKey = key.trim().toUpperCase();

    if (normalizedKey.length !== 10) {
      return { error: "Enter exactly 10 SARNEG characters." };
    }

    if (/\s/.test(normalizedKey)) {
      return { error: "SARNEG characters cannot include spaces." };
    }

    if (!/^[A-Z]+$/.test(normalizedKey)) {
      return { error: "Use letters only for the SARNEG characters." };
    }

    if (new Set(normalizedKey).size !== normalizedKey.length) {
      return { error: "Each SARNEG character must be unique." };
    }

    return { normalizedKey };
  }

  function encodeSarnegValue(value, key) {
    return String(value)
      .split("")
      .map((digit) => key[Number(digit)])
      .join("");
  }

  function createSarnegFilename(columnKey) {
    const columnLabel = columnMap.get(columnKey)?.label || "column";
    const safeQueryName = String(query.name || "query")
      .trim()
      .replace(/[^a-z0-9]+/gi, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase();
    const safeColumnName = String(columnLabel)
      .trim()
      .replace(/[^a-z0-9]+/gi, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase();

    return `${safeQueryName || "query"}_${safeColumnName || "column"}_sarneg.txt`;
  }

  /*
   * Exports unique numeric values from one column after SARNEG encoding them.
   * Non-numeric values are rejected because the encoding maps only digits.
   */
  function downloadSarnegColumn() {
    const validation = validateSarnegKey(sarnegKey);
    if (validation.error) {
      setSarnegMessage(validation.error);
      return;
    }

    const encodedValues = [];
    const seenValues = new Set();
    const invalidValues = [];

    sortedRows.forEach((row) => {
      const rawValue = formatCellValue(getValueByPath(row, sarnegColumnKey));
      const numberText = String(rawValue ?? "").trim();

      if (!numberText) {
        return;
      }

      if (!/^\d+$/.test(numberText)) {
        invalidValues.push(numberText);
        return;
      }

      const encodedValue = encodeSarnegValue(numberText, validation.normalizedKey);
      if (!seenValues.has(encodedValue)) {
        seenValues.add(encodedValue);
        encodedValues.push(encodedValue);
      }
    });

    if (invalidValues.length > 0) {
      setSarnegMessage(
        `SARNEG needs numbers only. ${invalidValues.length} value${invalidValues.length === 1 ? "" : "s"} in this column could not be encoded.`
      );
      return;
    }

    if (encodedValues.length === 0) {
      setSarnegMessage("This column does not have any numeric values to SARNEG.");
      return;
    }

    const blob = new Blob([encodedValues.join("\n")], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = createSarnegFilename(sarnegColumnKey);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setSarnegColumnKey(null);
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

          <div className="query-view-wrap" ref={viewMenuRef}>
            <button
              type="button"
              className={`query-view-button ${viewMenuOpen ? "query-view-button-open" : ""}`}
              onClick={() => {
                setViewMenuOpen((current) => !current);
                setLayoutsOpen(false);
                setActiveFilterColumn(null);
                setActiveColumnMenu(null);
              }}
            >
              View
            </button>

            {viewMenuOpen && (
              <div className="query-view-menu">
                <button
                  type="button"
                  className="query-view-menu-item"
                  onClick={openGeoNaviGatr}
                >
                  GeoNaviGatr2
                </button>
              </div>
            )}
          </div>

          <span className="query-results">
            {displayedResultCount} of {query.resultCount} results
          </span>
        </div>

        <div className="query-table-summary">
          <span className="query-load-progress">
            {isLoadingResults && <span className="query-load-spinner" aria-hidden="true" />}
            {loadedResultCount} of {totalResultCount} loaded
          </span>

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
                            className="column-menu-item"
                            onClick={() => openSarnegModal(column.key)}
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
                  className={[
                    displayRow.type === "child" ? "query-group-child-row" : "",
                    selectedGeoRowIds.has(displayRow.rowId) ? "query-row-geo-selected" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
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

      {sarnegColumnKey && (
        <div className="filter-modal-backdrop" role="presentation">
          <div
            className="filter-modal"
            ref={sarnegPopupRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="sarneg-modal-title"
          >
            <div className="filter-modal-header">
              <h3 id="sarneg-modal-title">
                SARNEG {columnMap.get(sarnegColumnKey)?.label || "column"}
              </h3>
              <button
                type="button"
                className="filter-modal-close"
                onClick={() => setSarnegColumnKey(null)}
                aria-label="Close SARNEG"
              >
                ×
              </button>
            </div>

            <label className="filter-field">
              <span>SARNEG characters</span>
              <input
                type="text"
                value={sarnegKey}
                onChange={(event) => {
                  setSarnegKey(event.target.value.toUpperCase());
                  setSarnegMessage("");
                }}
                placeholder="10 unique letters"
                maxLength={10}
                autoFocus
              />
            </label>

            {sarnegMessage && <div className="sarneg-message">{sarnegMessage}</div>}

            <div className="filter-popup-actions">
              <button
                type="button"
                className="filter-action-button"
                onClick={() => setSarnegColumnKey(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="filter-action-button filter-close-button"
                onClick={downloadSarnegColumn}
              >
                Download TXT
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default QueryTable;
