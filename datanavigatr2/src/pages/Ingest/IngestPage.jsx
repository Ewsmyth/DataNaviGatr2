import React, { useState } from "react";

const INGEST_BASE_URL =
  process.env.REACT_APP_INGEST_BASE_URL ?? "";

function IngestPage() {
  const [isIngestUploading, setIsIngestUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [collectorCode, setCollectorCode] = useState("");
  const [organizationCode, setOrganizationCode] = useState("");

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

    setIsIngestUploading(true);

    try {
      const response = await fetch(`${INGEST_BASE_URL}/api/ingest/upload`, {
        method: "POST",
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

            <div className="ingest-page-actions">
              <a href="/" className="ingest-secondary-button">
                Open Menu
              </a>

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
        </div>
      </main>
    </div>
  );
}

export default IngestPage;
