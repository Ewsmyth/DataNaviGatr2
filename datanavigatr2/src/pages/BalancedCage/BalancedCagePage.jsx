import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";

const SAMPLE_RESULTS = [
  {
    id: "bc-001",
    mcc: "515",
    mnc: "03",
    lac: "21241",
    cid: "20454",
    arfcn: "695",
    band: "GSM 1800 DCS",
    rssi: "-83.5",
    latitude: 18.403898,
    longitude: 122.126087,
    lastSeen: "2026-05-09T02:38:42",
  },
  {
    id: "bc-002",
    mcc: "515",
    mnc: "02",
    lac: "27810",
    cid: "47819",
    arfcn: "673",
    band: "GSM 1800 DCS",
    rssi: "-62.2",
    latitude: 18.403899,
    longitude: 122.126088,
    lastSeen: "2026-05-09T02:38:43",
  },
  {
    id: "bc-003",
    mcc: "310",
    mnc: "260",
    lac: "44012",
    cid: "77820",
    arfcn: "512",
    band: "LTE",
    rssi: "-71.4",
    latitude: 18.40712,
    longitude: 122.13241,
    lastSeen: "2026-05-09T03:12:09",
  },
  {
    id: "bc-004",
    mcc: "515",
    mnc: "02",
    lac: "27810",
    cid: "17819",
    arfcn: "21",
    band: "GSM 900 RGSM",
    rssi: "-60.2",
    latitude: 18.399412,
    longitude: 122.118233,
    lastSeen: "2026-05-09T02:38:42",
  },
  {
    id: "bc-005",
    mcc: "440",
    mnc: "10",
    lac: "18201",
    cid: "99204",
    arfcn: "1300",
    band: "LTE",
    rssi: "-92.0",
    latitude: 18.414232,
    longitude: 122.14291,
    lastSeen: "2026-05-09T04:05:31",
  },
];

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

function matchesPartial(value, query) {
  const cleanQuery = query.trim().toLowerCase();
  if (!cleanQuery) return true;
  return String(value || "").toLowerCase().includes(cleanQuery);
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

  const activeBox = dragStart ? buildBox(dragStart, dragEnd || dragStart) : geoBox;
  const hasGciQuery = Object.values(gciValues).some((value) => value.trim());
  const hasGeoQuery = Boolean(geoBox);

  const filteredResults = useMemo(() => {
    if (queryMode === "gci" && hasGciQuery) {
      return SAMPLE_RESULTS.filter((result) =>
        GCI_FIELDS.every(({ key }) => matchesPartial(result[key], gciValues[key]))
      );
    }

    if (queryMode === "geo" && hasGeoQuery) {
      return SAMPLE_RESULTS.slice(0, 3);
    }

    return SAMPLE_RESULTS;
  }, [gciValues, hasGciQuery, hasGeoQuery, queryMode]);

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
              {geoBox
                ? `Box ${geoBox.width.toFixed(1)} x ${geoBox.height.toFixed(1)}`
                : "Draw a box to stage a geo query."}
            </div>
          </section>
        )}
      </aside>

      <section className="balancedcage-results">
        <header className="balancedcage-results-header">
          <div>
            <span>Frontend prototype</span>
            <h2>Query Results</h2>
          </div>
          <strong>{filteredResults.length.toLocaleString()} records</strong>
        </header>

        <div className="balancedcage-table-wrap">
          <table className="balancedcage-table">
            <thead>
              <tr>
                <th>GCI</th>
                <th>ARFCN</th>
                <th>Band</th>
                <th>RSSI</th>
                <th>Collection Location</th>
                <th>Last Seen</th>
              </tr>
            </thead>
            <tbody>
              {filteredResults.map((result) => (
                <tr key={result.id}>
                  <td>
                    <strong>
                      {result.mcc}-{result.mnc}-{result.lac}-{result.cid}
                    </strong>
                  </td>
                  <td>{result.arfcn}</td>
                  <td>{result.band}</td>
                  <td>{result.rssi}</td>
                  <td>
                    {result.latitude.toFixed(6)}, {result.longitude.toFixed(6)}
                  </td>
                  <td>{result.lastSeen}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filteredResults.length === 0 && (
          <div className="balancedcage-empty">No local sample records match this query.</div>
        )}
      </section>
    </main>
  );
}

export default BalancedCagePage;
