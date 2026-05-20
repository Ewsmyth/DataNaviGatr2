import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL ?? "";

const BALANCEDCAGE_MAP_BOUNDS = {
  north: 18.46,
  south: 18.35,
  west: 122.07,
  east: 122.18,
};

const GCI_FIELDS = [
  { key: "mcc", label: "MCC" },
  { key: "mnc", label: "MNC" },
  { key: "lac", label: "LAC" },
  { key: "cid", label: "CID" },
  { key: "arfcn", label: "ARFCN" },
];

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getPointerPercent(event) {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100),
    y: clamp(((event.clientY - rect.top) / rect.height) * 100, 0, 100),
  };
}

function buildBox(start, end) {
  if (!start || !end) return null;
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  return {
    left,
    top,
    width: Math.abs(start.x - end.x),
    height: Math.abs(start.y - end.y),
  };
}

function boxToGeoBounds(box) {
  if (!box) return null;
  const { north, south, west, east } = BALANCEDCAGE_MAP_BOUNDS;
  const lonSpan = east - west;
  const latSpan = north - south;

  return {
    west: west + (box.left / 100) * lonSpan,
    east: west + ((box.left + box.width) / 100) * lonSpan,
    north: north - (box.top / 100) * latSpan,
    south: north - ((box.top + box.height) / 100) * latSpan,
  };
}

function formatNumber(value, digits = 1) {
  if (value === null || value === undefined || value === "") return "Unknown";
  const numberValue = Number(value);
  if (Number.isNaN(numberValue)) return String(value);
  return numberValue.toFixed(digits);
}

function BalancedCagePage() {
  const [queryMode, setQueryMode] = useState("gci");
  const [gciValues, setGciValues] = useState({
    mcc: "",
    mnc: "",
    lac: "",
    cid: "",
    arfcn: "",
  });
  const [geoBox, setGeoBox] = useState(null);
  const [dragStart, setDragStart] = useState(null);
  const [dragEnd, setDragEnd] = useState(null);
  const [towers, setTowers] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("");

  const activeBox = dragStart ? buildBox(dragStart, dragEnd || dragStart) : geoBox;
  const geoBounds = useMemo(() => boxToGeoBounds(geoBox), [geoBox]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ limit: "200" });

    if (queryMode === "gci") {
      GCI_FIELDS.forEach(({ key }) => {
        const value = gciValues[key].trim();
        if (value) params.set(key, value);
      });
    }

    if (queryMode === "geo" && geoBounds) {
      params.set("west", String(geoBounds.west));
      params.set("south", String(geoBounds.south));
      params.set("east", String(geoBounds.east));
      params.set("north", String(geoBounds.north));
    }

    async function loadTowers() {
      setIsLoading(true);
      setMessage("");

      try {
        const response = await fetch(
          `${API_BASE_URL}/api/balancedcage/towers?${params.toString()}`,
          { signal: controller.signal }
        );
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "Failed to load towers.");
        }
        setTowers(data.towers || []);
      } catch (error) {
        if (error.name !== "AbortError") {
          setTowers([]);
          setMessage(error.message || "Failed to load towers.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    loadTowers();
    return () => controller.abort();
  }, [gciValues, geoBounds, queryMode]);

  function updateGciValue(key, value) {
    setGciValues((currentValues) => ({
      ...currentValues,
      [key]: value,
    }));
  }

  function clearGciValues() {
    setGciValues({
      mcc: "",
      mnc: "",
      lac: "",
      cid: "",
      arfcn: "",
    });
  }

  function startGeoDrag(event) {
    const point = getPointerPercent(event);
    setDragStart(point);
    setDragEnd(point);
  }

  function updateGeoDrag(event) {
    if (!dragStart) return;
    setDragEnd(getPointerPercent(event));
  }

  function finishGeoDrag(event) {
    if (!dragStart) return;
    const box = buildBox(dragStart, getPointerPercent(event));
    setGeoBox(box && box.width >= 2 && box.height >= 2 ? box : null);
    setDragStart(null);
    setDragEnd(null);
  }

  return (
    <main className="balancedcage-page">
      <aside className="balancedcage-sidebar">
        <div className="balancedcage-brand">
          <Link to="/" className="balancedcage-return">
            Menu
          </Link>
          <div>
            <h1>BalancedCage</h1>
            <p>Cellular survey query tool</p>
          </div>
        </div>

        <div className="balancedcage-mode-toggle" aria-label="Query mode">
          <button
            type="button"
            className={queryMode === "gci" ? "active" : ""}
            onClick={() => setQueryMode("gci")}
          >
            GCI
          </button>
          <button
            type="button"
            className={queryMode === "geo" ? "active" : ""}
            onClick={() => setQueryMode("geo")}
          >
            Geo
          </button>
        </div>

        {queryMode === "gci" ? (
          <section className="balancedcage-control-panel">
            <div className="balancedcage-panel-heading">
              <h2>GCI Search</h2>
              <button type="button" onClick={clearGciValues}>
                Clear
              </button>
            </div>

            <div className="balancedcage-field-stack">
              {GCI_FIELDS.map((field) => (
                <label key={field.key} className="balancedcage-field">
                  <span>{field.label}</span>
                  <input
                    type="text"
                    value={gciValues[field.key]}
                    placeholder={`Partial ${field.label}`}
                    onChange={(event) => updateGciValue(field.key, event.target.value)}
                  />
                </label>
              ))}
            </div>
          </section>
        ) : (
          <section className="balancedcage-control-panel">
            <div className="balancedcage-panel-heading">
              <h2>Geo Search</h2>
              <button type="button" onClick={() => setGeoBox(null)}>
                Clear
              </button>
            </div>

            <div
              className="balancedcage-draw-map"
              role="presentation"
              onMouseDown={startGeoDrag}
              onMouseMove={updateGeoDrag}
              onMouseUp={finishGeoDrag}
              onMouseLeave={finishGeoDrag}
            >
              <div className="balancedcage-map-grid" />
              {activeBox && (
                <div
                  className="balancedcage-selection-box"
                  style={{
                    left: `${activeBox.left}%`,
                    top: `${activeBox.top}%`,
                    width: `${activeBox.width}%`,
                    height: `${activeBox.height}%`,
                  }}
                />
              )}
            </div>

            <div className="balancedcage-geo-readout">
              {geoBounds
                ? `${geoBounds.south.toFixed(5)}, ${geoBounds.west.toFixed(5)} to ${geoBounds.north.toFixed(5)}, ${geoBounds.east.toFixed(5)}`
                : "Draw a box to query calculated tower locations."}
            </div>
          </section>
        )}
      </aside>

      <section className="balancedcage-results">
        <header className="balancedcage-results-header">
          <div>
            <span>cell_survey.towers</span>
            <h2>Calculated Towers</h2>
          </div>
          <strong>{isLoading ? "Loading" : `${towers.length.toLocaleString()} towers`}</strong>
        </header>

        {message && <div className="balancedcage-message">{message}</div>}

        <div className="balancedcage-table-wrap">
          <table className="balancedcage-table">
            <thead>
              <tr>
                <th>GCI</th>
                <th>Channel</th>
                <th>Protocol</th>
                <th>Observations</th>
                <th>Confidence</th>
                <th>Tower Location</th>
                <th>Last Seen</th>
              </tr>
            </thead>
            <tbody>
              {towers.map((tower) => (
                <tr key={tower.id || tower.towerId}>
                  <td>
                    <strong>
                      {tower.mcc}-{tower.mnc}-{tower.lac}-{tower.cid}
                    </strong>
                  </td>
                  <td>{tower.arfcn || "Unknown"}</td>
                  <td>{tower.protocol || "Unknown"}</td>
                  <td>{tower.observationCount ?? 0}</td>
                  <td>{formatNumber(tower.confidenceRadiusM, 1)} m</td>
                  <td>
                    {formatNumber(tower.latitude, 6)}, {formatNumber(tower.longitude, 6)}
                  </td>
                  <td>{tower.lastSeen || tower.updatedAt || "Unknown"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!isLoading && towers.length === 0 && (
          <div className="balancedcage-empty">No calculated towers match this query.</div>
        )}
      </section>
    </main>
  );
}

export default BalancedCagePage;
