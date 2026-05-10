import React from "react";
import { Link } from "react-router-dom";

/*
 * First screen/menu for the local deployment.
 * Internal app destinations use React Router links, while Portainer is an
 * external service URL derived from the current host unless explicitly set.
 */
function LandingPage() {
  const currentHostname = window.location.hostname || "localhost";
  /*
   * Defaults Portainer to the same host as the app on its standard HTTPS port.
   */
  const portainerUrl =
    process.env.REACT_APP_PORTAINER_URL || `https://${currentHostname}:9443`;

  return (
    <main className="landing-page">
      <div className="landing-content">
        <h1 className="landing-title">DataNaviGatr2</h1>
        <p className="landing-subtitle">Select a destination to continue.</p>

        <div className="landing-button-grid">
          <Link
            to="/app"
            target="_blank"
            rel="noreferrer"
            className="landing-button landing-button-primary"
          >
            DataNaviGatr2
          </Link>

          <Link
            to="/ingest"
            target="_blank"
            rel="noreferrer"
            className="landing-button"
          >
            Ingest
          </Link>

          <Link
            to="/dataview"
            target="_blank"
            rel="noreferrer"
            className="landing-button"
          >
            DataView
          </Link>

          <a
            className="landing-button landing-button-link"
            href={portainerUrl}
            target="_blank"
            rel="noreferrer"
          >
            Portainer
          </a>

        </div>
      </div>
    </main>
  );
}

export default LandingPage;
