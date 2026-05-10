import React, { useEffect, useMemo, useState } from "react";
import "../../App.css";

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL ?? "";

function buildChartPoints(recordsOverTime, width, height, padding) {
  if (!recordsOverTime.length) return "";

  const maxCount = Math.max(...recordsOverTime.map((item) => item.count), 1);
  const stepX =
    recordsOverTime.length === 1
      ? 0
      : (width - padding * 2) / (recordsOverTime.length - 1);

  return recordsOverTime
    .map((item, index) => {
      const x = recordsOverTime.length === 1 ? width / 2 : padding + index * stepX;
      const y = height - padding - (item.count / maxCount) * (height - padding * 2);
      return `${x},${y}`;
    })
    .join(" ");
}

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

function DataViewPage() {
  const [accessToken, setAccessToken] = useState(() => sessionStorage.getItem("accessToken") || "");
  const [currentUser, setCurrentUser] = useState(null);
  const [loginForm, setLoginForm] = useState({ identifier: "", password: "" });
  const [authMessage, setAuthMessage] = useState("");
  const [metrics, setMetrics] = useState(null);
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [isMetricsLoading, setIsMetricsLoading] = useState(false);
  const [metricsMessage, setMetricsMessage] = useState("");
  const isAdmin = currentUser?.roles?.includes("admin");

  useEffect(() => {
    if (accessToken) {
      sessionStorage.setItem("accessToken", accessToken);
    } else {
      sessionStorage.removeItem("accessToken");
    }
  }, [accessToken]);

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
      } catch (error) {
        setMetrics(null);
        setMetricsMessage(error.message || "Failed to load DataView metrics.");
      } finally {
        setIsMetricsLoading(false);
      }
    }

    loadMetrics();
  }, [accessToken, isAdmin]);

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
    setAuthMessage("");
  }

  const chartPoints = useMemo(
    () => buildChartPoints(metrics?.recordsOverTime || [], 760, 280, 36),
    [metrics]
  );
  const recordsOverTime = metrics?.recordsOverTime || [];
  const totalRecords = metrics?.totalRecords || 0;

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
                <h2>Records Over Time</h2>
                {isMetricsLoading && <span>Loading...</span>}
              </div>

              {recordsOverTime.length > 0 ? (
                <div className="dataview-chart-wrap">
                  <svg viewBox="0 0 760 320" className="dataview-chart" role="img" aria-label="Records over time line chart">
                    <line x1="36" y1="280" x2="724" y2="280" className="dataview-axis" />
                    <line x1="36" y1="36" x2="36" y2="280" className="dataview-axis" />
                    <polyline points={chartPoints} className="dataview-line" />
                    {recordsOverTime.map((item, index) => {
                      const [x, y] = chartPoints.split(" ")[index].split(",");
                      return (
                        <g key={`${item.date}-${index}`}>
                          <circle cx={x} cy={y} r="4" className="dataview-point" />
                          <title>{`${item.date}: ${item.count} records`}</title>
                        </g>
                      );
                    })}
                  </svg>
                  <div className="dataview-chart-labels">
                    <span>{recordsOverTime[0]?.date}</span>
                    <span>{recordsOverTime[recordsOverTime.length - 1]?.date}</span>
                  </div>
                </div>
              ) : (
                <div className="dataview-empty">No records are available to chart.</div>
              )}

              {metricsMessage && <div className="ingest-message">{metricsMessage}</div>}
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
