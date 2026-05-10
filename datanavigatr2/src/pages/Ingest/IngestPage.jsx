import React, { useEffect, useState } from "react";

const INGEST_BASE_URL =
  process.env.REACT_APP_INGEST_BASE_URL ?? "";
const API_BASE_URL =
  process.env.REACT_APP_API_BASE_URL ?? "";

/*
 * Field definitions for optional default GPS metadata applied during ingest.
 * The frontend collects values for one coordinate system; the ingest service
 * validates and converts that payload into latitude/longitude/ECEF fields.
 */
const DEFAULT_GPS_TYPES = {
  decimal_degrees: {
    label: "Latitude / Longitude",
    fields: [
      { name: "latitude", label: "Latitude", placeholder: "18.50575" },
      { name: "longitude", label: "Longitude", placeholder: "122.1479917" },
      { name: "altitude", label: "Altitude (m)", placeholder: "0", optional: true },
    ],
  },
  dms: {
    label: "Degrees Minutes Seconds",
    fields: [
      { name: "latitude", label: "Latitude", placeholder: "18 30 20.7 N" },
      { name: "longitude", label: "Longitude", placeholder: "122 08 52.77 E" },
      { name: "altitude", label: "Altitude (m)", placeholder: "0", optional: true },
    ],
  },
  utm: {
    label: "UTM",
    fields: [
      { name: "zone", label: "Zone", placeholder: "51" },
      { name: "hemisphere", label: "Hemisphere", placeholder: "N or S" },
      { name: "easting", label: "Easting", placeholder: "407000" },
      { name: "northing", label: "Northing", placeholder: "2046000" },
      { name: "altitude", label: "Altitude (m)", placeholder: "0", optional: true },
    ],
  },
  mgrs: {
    label: "MGRS",
    fields: [
      { name: "mgrs", label: "MGRS", placeholder: "51Q YU 07000 46000" },
      { name: "altitude", label: "Altitude (m)", placeholder: "0", optional: true },
    ],
  },
};

/*
 * Standalone ingest screen for admins.
 * It authenticates against the main API, verifies the user has the admin role,
 * then uploads JSON files plus collector/organization/default GPS metadata to
 * the ingest service.
 */
function IngestPage() {
  /*
   * Authentication state is intentionally duplicated here instead of reusing the
   * workspace page because this route can be opened directly for operational
   * ingest work.
   */
  const [accessToken, setAccessToken] = useState(() => sessionStorage.getItem("accessToken") || "");
  const [currentUser, setCurrentUser] = useState(null);
  const [loginForm, setLoginForm] = useState({ identifier: "", password: "" });
  const [authMessage, setAuthMessage] = useState("");
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [isIngestUploading, setIsIngestUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [collectorCode, setCollectorCode] = useState("");
  const [organizationCode, setOrganizationCode] = useState("");
  const [useDefaultGps, setUseDefaultGps] = useState(false);
  const [defaultGpsType, setDefaultGpsType] = useState("decimal_degrees");
  const [defaultGpsValues, setDefaultGpsValues] = useState({});
  const isAdmin = currentUser?.roles?.includes("admin");

  /*
   * Confirms the stored token still maps to a valid user before allowing upload.
   */
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

  /*
   * Logs in through the main API and refuses non-admin users before showing the
   * upload form. The ingest service itself also checks the token server-side.
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
        throw new Error("Admin role required for ingest.");
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
    setAuthMessage("");
  }

  /*
   * Maintains the dynamic default GPS form object. Field names come from
   * DEFAULT_GPS_TYPES, so this works for decimal degrees, DMS, UTM, and MGRS.
   */
  function updateDefaultGpsValue(name, value) {
    setDefaultGpsValues((currentValues) => ({
      ...currentValues,
      [name]: value,
    }));
  }

  /*
   * Builds the multipart upload sent to the ingest service.
   * Client-side validation catches the common file/code mistakes early; the
   * backend repeats validation and performs the actual normalization/insertion.
   */
  async function handleIngestUpload(files) {
    if (!files || files.length === 0) {
      setMessage("Please choose at least one JSON file.");
      return;
    }

    if (collectorCode.trim().length !== 2) {
      setMessage("Collector Code must be exactly 2 characters.");
      return;
    }

    if (organizationCode.trim().length !== 5) {
      setMessage("Organization Code must be exactly 5 characters.");
      return;
    }

    const formData = new FormData();

    Array.from(files).forEach((file) => {
      formData.append("files", file);
    });

    formData.append("collector_code", collectorCode.trim());
    formData.append("organization_code", organizationCode.trim());

    if (useDefaultGps) {
      formData.append(
        "default_location",
        JSON.stringify({
          type: defaultGpsType,
          values: defaultGpsValues,
        })
      );
    }

    setIsIngestUploading(true);

    try {
      const response = await fetch(`${INGEST_BASE_URL}/api/ingest/upload`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Upload failed.");
      }

      setMessage(data.message || "Upload successful.");
    } catch (error) {
      setMessage(error.message || "Upload failed.");
    } finally {
      setIsIngestUploading(false);
    }
  }

  return (
    <div className="app-shell dark">
      <main className="ingest-page">
        <div className="ingest-page-card">
          <div className="ingest-page-header">
            <h1>Ingest</h1>
            <p>Upload one or more JSON files to the standalone ingest service.</p>
          </div>

          {!isAdmin ? (
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

              <div className="ingest-page-actions">
                <a href="/" className="ingest-secondary-button">
                  Open Menu
                </a>
                <button
                  type="submit"
                  className="ingest-primary-button"
                  disabled={isAuthLoading}
                >
                  {isAuthLoading ? "Logging in..." : "Admin Login"}
                </button>
              </div>

              {authMessage && <div className="ingest-message">{authMessage}</div>}
            </form>
          ) : (
          <>
          <form
            className="ingest-upload-form"
            onSubmit={(event) => {
              event.preventDefault();
              const files = event.target.elements.json_files?.files;
              handleIngestUpload(files);
            }}
          >
            <label className="ingest-file-field">
              <span>JSON File(s)</span>
              <input
                type="file"
                name="json_files"
                accept=".json,application/json"
                multiple
              />
            </label>

            <label className="ingest-file-field">
              <span>Collector Code</span>
              <input
                type="text"
                name="collector_code"
                value={collectorCode}
                maxLength={2}
                placeholder="2 characters"
                onChange={(event) =>
                  setCollectorCode(event.target.value.toUpperCase().slice(0, 2))
                }
              />
            </label>

            <label className="ingest-file-field">
              <span>Organization Code</span>
              <input
                type="text"
                name="organization_code"
                value={organizationCode}
                maxLength={5}
                placeholder="5 characters"
                onChange={(event) =>
                  setOrganizationCode(event.target.value.toUpperCase().slice(0, 5))
                }
              />
            </label>

            <div className="ingest-default-gps">
              <label className="ingest-checkbox-field">
                <input
                  type="checkbox"
                  checked={useDefaultGps}
                  onChange={(event) => setUseDefaultGps(event.target.checked)}
                />
                <span>Default GPS?</span>
              </label>

              <span
                className="ingest-info-tooltip"
                tabIndex={0}
                aria-label="By enabling this any records without GPS will be assigned the default GPS value."
              >
                <svg
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  aria-hidden="true"
                >
                  <path d="M10 7.5A.75.75 0 1 0 10 6a.75.75 0 0 0 0 1.5Zm0 .9a.5.5 0 0 0-.5.5v4.6a.5.5 0 0 0 1 0V8.9a.5.5 0 0 0-.5-.5Z" />
                  <path
                    fillRule="evenodd"
                    clipRule="evenodd"
                    d="M2 10a8 8 0 1 1 16 0 8 8 0 0 1-16 0Zm1 0c0 3.86 3.14 7 7 7s7-3.14 7-7-3.14-7-7-7-7 3.14-7 7Z"
                  />
                </svg>
                <span className="ingest-tooltip-text">
                  By enabling this any records without GPS will be assigned the default GPS value.
                </span>
              </span>
            </div>

            {useDefaultGps && (
              <div className="ingest-default-gps-panel">
                <label className="ingest-file-field">
                  <span>Grid Type</span>
                  <select
                    value={defaultGpsType}
                    onChange={(event) => setDefaultGpsType(event.target.value)}
                  >
                    {Object.entries(DEFAULT_GPS_TYPES).map(([value, config]) => (
                      <option key={value} value={value}>
                        {config.label}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="ingest-gps-grid">
                  {DEFAULT_GPS_TYPES[defaultGpsType].fields.map((field) => (
                    <label className="ingest-file-field" key={field.name}>
                      <span>
                        {field.label}
                        {field.optional ? " (optional)" : ""}
                      </span>
                      <input
                        type="text"
                        value={defaultGpsValues[field.name] ?? ""}
                        placeholder={field.placeholder}
                        onChange={(event) =>
                          updateDefaultGpsValue(field.name, event.target.value)
                        }
                      />
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="ingest-page-actions">
              <a href="/" className="ingest-secondary-button">
                Open Menu
              </a>
              <button
                type="button"
                className="ingest-secondary-button"
                onClick={handleLogout}
              >
                Logout
              </button>

              <button
                type="submit"
                className="ingest-primary-button"
                disabled={isIngestUploading}
              >
                {isIngestUploading ? "Uploading..." : "Upload"}
              </button>
            </div>
          </form>

          {message && <div className="ingest-message">{message}</div>}
          </>
          )}
        </div>
      </main>
    </div>
  );
}

export default IngestPage;
