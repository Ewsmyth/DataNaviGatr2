import React, { useEffect, useMemo, useState } from "react";
import "../../App.css";

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL ?? "";
const CHART_WIDTH = 760;
const CHART_HEIGHT = 280;
const CHART_PADDING = 36;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const RANGE_OPTIONS = [
  { label: "1 hour", value: "1h", durationMs: HOUR_MS },
  { label: "1 day", value: "1d", durationMs: DAY_MS },
  { label: "2 day", value: "2d", durationMs: 2 * DAY_MS },
  { label: "3 day", value: "3d", durationMs: 3 * DAY_MS },
  { label: "1 week", value: "1w", durationMs: 7 * DAY_MS },
  { label: "1 month", value: "1m", durationMs: 30 * DAY_MS },
  { label: "1 year", value: "1y", durationMs: 365 * DAY_MS },
];

/*
 * Converts the records-over-time metric into SVG coordinates.
 * width, height, and padding describe the chart box; counts are scaled against
 * the largest bucket so the trend line fills the available vertical space.
 */
function buildChartCoordinates(recordsOverTime, width, height, padding) {
  if (!recordsOverTime.length) return [];

  const maxCount = Math.max(...recordsOverTime.map((item) => item.count), 1);
  const stepX =
    recordsOverTime.length === 1
      ? 0
      : (width - padding * 2) / (recordsOverTime.length - 1);

  return recordsOverTime
    .map((item, index) => {
      const x = recordsOverTime.length === 1 ? width / 2 : padding + index * stepX;
      const y = height - padding - (item.count / maxCount) * (height - padding * 2);
      return { ...item, x, y };
    });
}

function toUtcIso(ms) {
  return new Date(ms).toISOString();
}

function parseDateMs(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDateTime(value) {
  if (!value) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function clampWindowStart(startMs, durationMs, earliestMs, latestMs) {
  const maxStart = Math.max(earliestMs, latestMs - durationMs);
  return Math.min(Math.max(startMs, earliestMs), maxStart);
}

/*
 * Reusable metric panel for breakdown lists such as records by source format or
 * records by collector. items is an array of { label, count } objects from the
 * API.
 */
function MetricList({ title, items }) {
  return (
    <section className="dataview-panel">
      <h2>{title}</h2>
      <div className="dataview-list">
        {(items || []).map((item) => (
          <div className="dataview-list-row" key={item.label}>
            <span>{item.label}</span>
            <strong>{item.count.toLocaleString()}</strong>
          </div>
        ))}
        {(!items || items.length === 0) && (
          <div className="dataview-empty">No data available.</div>
        )}
      </div>
    </section>
  );
}

/*
 * Admin-only operational dashboard for database volume and ingest breakdowns.
 * It performs its own auth check so the route can be opened directly without
 * going through the main query workspace first.
 */
function DataViewPage() {
  const [accessToken, setAccessToken] = useState(() => sessionStorage.getItem("accessToken") || "");
  const [currentUser, setCurrentUser] = useState(null);
  const [loginForm, setLoginForm] = useState({ identifier: "", password: "" });
  const [authMessage, setAuthMessage] = useState("");
  const [metrics, setMetrics] = useState(null);
  const [recordsOverTime, setRecordsOverTime] = useState([]);
  const [chartRange, setChartRange] = useState("1h");
  const [chartStartMs, setChartStartMs] = useState(null);
  const [hoveredPoint, setHoveredPoint] = useState(null);
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [isMetricsLoading, setIsMetricsLoading] = useState(false);
  const [isChartLoading, setIsChartLoading] = useState(false);
  const [metricsMessage, setMetricsMessage] = useState("");
  const [chartMessage, setChartMessage] = useState("");
  const isAdmin = currentUser?.roles?.includes("admin");
  const selectedRange = RANGE_OPTIONS.find((option) => option.value === chartRange) || RANGE_OPTIONS[0];

  /*
   * Confirms the session token and loads the user so the page can enforce admin
   * access before requesting metrics.
   */
  useEffect(() => {
    if (accessToken) {
      sessionStorage.setItem("accessToken", accessToken);
    } else {
      sessionStorage.removeItem("accessToken");
    }
  }, [accessToken]);

  /*
   * Loads aggregate metrics from the API after admin authentication succeeds.
   */
  useEffect(() => {
    async function loadCurrentUser() {
      if (!accessToken) {
        setCurrentUser(null);
        return;
      }

      try {
        const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "Failed to load current user.");
        }
        setCurrentUser(data.user || null);
      } catch {
        setAccessToken("");
        setCurrentUser(null);
      }
    }

    loadCurrentUser();
  }, [accessToken]);

  useEffect(() => {
    async function loadMetrics() {
      if (!accessToken || !isAdmin) {
        setMetrics(null);
        return;
      }

      setIsMetricsLoading(true);
      setMetricsMessage("");

      try {
        const response = await fetch(`${API_BASE_URL}/api/dataview/metrics`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "Failed to load DataView metrics.");
        }
        setMetrics(data);
        const latestMs = parseDateMs(data.timelineBounds?.latestIngestedAt) || Date.now();
        const earliestMs = parseDateMs(data.timelineBounds?.earliestIngestedAt) || latestMs;
        setChartStartMs(clampWindowStart(latestMs - HOUR_MS, HOUR_MS, earliestMs, latestMs));
      } catch (error) {
        setMetrics(null);
        setRecordsOverTime([]);
        setMetricsMessage(error.message || "Failed to load DataView metrics.");
      } finally {
        setIsMetricsLoading(false);
      }
    }

    loadMetrics();
  }, [accessToken, isAdmin]);

  useEffect(() => {
    const earliestMs = parseDateMs(metrics?.timelineBounds?.earliestIngestedAt);
    const latestMs = parseDateMs(metrics?.timelineBounds?.latestIngestedAt);
    if (!earliestMs || !latestMs) return;

    setChartStartMs((current) => {
      const desiredStart = current ?? latestMs - selectedRange.durationMs;
      return clampWindowStart(desiredStart, selectedRange.durationMs, earliestMs, latestMs);
    });
    setHoveredPoint(null);
  }, [chartRange, metrics, selectedRange.durationMs]);

  useEffect(() => {
    async function loadChartData() {
      if (!accessToken || !isAdmin || chartStartMs === null) {
        setRecordsOverTime([]);
        return;
      }

      setIsChartLoading(true);
      setChartMessage("");

      try {
        const params = new URLSearchParams({
          start: toUtcIso(chartStartMs),
          end: toUtcIso(chartStartMs + selectedRange.durationMs),
        });
        const response = await fetch(`${API_BASE_URL}/api/dataview/records-over-time?${params}`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "Failed to load chart data.");
        }
        setRecordsOverTime(data.recordsOverTime || []);
      } catch (error) {
        setRecordsOverTime([]);
        setChartMessage(error.message || "Failed to load chart data.");
      } finally {
        setIsChartLoading(false);
      }
    }

    const timeoutId = window.setTimeout(loadChartData, 250);
    return () => window.clearTimeout(timeoutId);
  }, [accessToken, chartStartMs, isAdmin, selectedRange.durationMs]);

  /*
   * Logs in with the main API and rejects accounts without the admin role.
   */
  async function handleAdminLogin(event) {
    event.preventDefault();
    setIsAuthLoading(true);
    setAuthMessage("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(loginForm),
        credentials: "include",
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Login failed.");
      }
      if (!data.user?.roles?.includes("admin")) {
        throw new Error("Admin role required for DataView.");
      }
      setAccessToken(data.access_token || "");
      setCurrentUser(data.user || null);
      setLoginForm({ identifier: "", password: "" });
    } catch (error) {
      setAuthMessage(error.message || "Login failed.");
    } finally {
      setIsAuthLoading(false);
    }
  }

  function handleLogout() {
    setAccessToken("");
    setCurrentUser(null);
    setMetrics(null);
    setRecordsOverTime([]);
    setAuthMessage("");
  }

  const chartCoordinates = useMemo(
    () => buildChartCoordinates(recordsOverTime, CHART_WIDTH, CHART_HEIGHT, CHART_PADDING),
    [recordsOverTime]
  );
  const chartPoints = chartCoordinates.map((point) => `${point.x},${point.y}`).join(" ");
  const totalRecords = metrics?.totalRecords || 0;
  const earliestMs = parseDateMs(metrics?.timelineBounds?.earliestIngestedAt);
  const latestMs = parseDateMs(metrics?.timelineBounds?.latestIngestedAt);
  const maxChartStartMs =
    earliestMs && latestMs ? Math.max(earliestMs, latestMs - selectedRange.durationMs) : chartStartMs || 0;
  const canScrollChart = earliestMs && latestMs && earliestMs < maxChartStartMs;

  function handleChartPointerMove(event) {
    if (!chartCoordinates.length) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const pointerX = ((event.clientX - rect.left) / rect.width) * CHART_WIDTH;
    const nearestPoint = chartCoordinates.reduce((nearest, point) =>
      Math.abs(point.x - pointerX) < Math.abs(nearest.x - pointerX) ? point : nearest
    );
    setHoveredPoint(nearestPoint);
  }

  return (
    <div className="app-shell dark">
      <main className="dataview-page">
        <div className="dataview-header">
          <div>
            <h1>DataView</h1>
            <p>Database record volume and ingest breakdowns.</p>
          </div>
          <div className="dataview-actions">
            <a href="/" className="ingest-secondary-button">
              Open Menu
            </a>
            {isAdmin && (
              <button type="button" className="ingest-secondary-button" onClick={handleLogout}>
                Logout
              </button>
            )}
          </div>
        </div>

        {!isAdmin ? (
          <section className="dataview-login-panel">
            <form className="ingest-upload-form" onSubmit={handleAdminLogin}>
              <label className="ingest-file-field">
                <span>Admin Username or Email</span>
                <input
                  type="text"
                  value={loginForm.identifier}
                  autoComplete="username"
                  onChange={(event) =>
                    setLoginForm((current) => ({
                      ...current,
                      identifier: event.target.value,
                    }))
                  }
                />
              </label>

              <label className="ingest-file-field">
                <span>Admin Password</span>
                <input
                  type="password"
                  value={loginForm.password}
                  autoComplete="current-password"
                  onChange={(event) =>
                    setLoginForm((current) => ({
                      ...current,
                      password: event.target.value,
                    }))
                  }
                />
              </label>

              <button type="submit" className="ingest-primary-button" disabled={isAuthLoading}>
                {isAuthLoading ? "Logging in..." : "Admin Login"}
              </button>

              {authMessage && <div className="ingest-message">{authMessage}</div>}
            </form>
          </section>
        ) : (
          <>
            <section className="dataview-summary-grid">
              <div className="dataview-stat">
                <span>Total Records</span>
                <strong>{totalRecords.toLocaleString()}</strong>
              </div>
              <div className="dataview-stat">
                <span>Org Codes</span>
                <strong>{(metrics?.recordsByOrgCode || []).length.toLocaleString()}</strong>
              </div>
              <div className="dataview-stat">
                <span>Collector Codes</span>
                <strong>{(metrics?.recordsByCollectorCode || []).length.toLocaleString()}</strong>
              </div>
            </section>

            <section className="dataview-panel dataview-chart-panel">
              <div className="dataview-panel-heading">
                <div>
                  <h2>Records Over Time</h2>
                  <span>Displayed by ingest time</span>
                </div>
                <div className="dataview-chart-controls">
                  <label>
                    <span>Window</span>
                    <select
                      value={chartRange}
                      onChange={(event) => setChartRange(event.target.value)}
                    >
                      {RANGE_OPTIONS.map((option) => (
                        <option value={option.value} key={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {(isMetricsLoading || isChartLoading) && <span>Loading...</span>}
                </div>
              </div>

              {recordsOverTime.length > 0 ? (
                <div className="dataview-chart-wrap">
                  <div className="dataview-chart-stage">
                    <svg
                      viewBox="0 0 760 320"
                      className="dataview-chart"
                      role="img"
                      aria-label="Records over time line chart"
                      onPointerMove={handleChartPointerMove}
                      onPointerLeave={() => setHoveredPoint(null)}
                    >
                    <line x1="36" y1="280" x2="724" y2="280" className="dataview-axis" />
                    <line x1="36" y1="36" x2="36" y2="280" className="dataview-axis" />
                    <polyline points={chartPoints} className="dataview-line" />
                    {hoveredPoint && (
                      <line
                        x1={hoveredPoint.x}
                        y1="36"
                        x2={hoveredPoint.x}
                        y2="280"
                        className="dataview-hover-line"
                      />
                    )}
                    {chartCoordinates.map((item, index) => (
                      <g key={`${item.bucketStart || item.date}-${index}`}>
                        <circle cx={item.x} cy={item.y} r="4" className="dataview-point" />
                        <title>{`${formatDateTime(item.bucketStart || item.date)}: ${item.count} records`}</title>
                      </g>
                    ))}
                    </svg>
                    {hoveredPoint && (
                      <div
                        className="dataview-tooltip"
                        style={{
                          left: `${Math.min(Math.max((hoveredPoint.x / CHART_WIDTH) * 100, 12), 88)}%`,
                          top: `${Math.max((hoveredPoint.y / 320) * 100 - 6, 6)}%`,
                        }}
                      >
                        <strong>{hoveredPoint.count.toLocaleString()} records</strong>
                        <span>{formatDateTime(hoveredPoint.bucketStart || hoveredPoint.date)}</span>
                      </div>
                    )}
                  </div>
                  <div className="dataview-chart-labels">
                    <span>{formatDateTime(recordsOverTime[0]?.bucketStart || recordsOverTime[0]?.date)}</span>
                    <span>
                      {formatDateTime(
                        recordsOverTime[recordsOverTime.length - 1]?.bucketStart ||
                          recordsOverTime[recordsOverTime.length - 1]?.date
                      )}
                    </span>
                  </div>
                  <label className="dataview-scroll-control">
                    <span>Scroll visible window</span>
                    <input
                      type="range"
                      min={earliestMs || 0}
                      max={maxChartStartMs}
                      step={selectedRange.durationMs}
                      value={chartStartMs || maxChartStartMs}
                      disabled={!canScrollChart}
                      onChange={(event) => {
                        setHoveredPoint(null);
                        setChartStartMs(Number(event.target.value));
                      }}
                    />
                  </label>
                </div>
              ) : (
                <div className="dataview-empty">
                  {isChartLoading ? "Loading chart data..." : "No records are available for this ingest-time window."}
                </div>
              )}

              {metricsMessage && <div className="ingest-message">{metricsMessage}</div>}
              {chartMessage && <div className="ingest-message">{chartMessage}</div>}
            </section>

            <div className="dataview-breakdown-grid">
              <MetricList title="Records Per Org Code" items={metrics?.recordsByOrgCode} />
              <MetricList title="Records Per Collector Code" items={metrics?.recordsByCollectorCode} />
              <MetricList title="Records Per Signal Type" items={metrics?.recordsBySignalType} />
            </div>
          </>
        )}
      </main>
    </div>
  );
}

export default DataViewPage;
