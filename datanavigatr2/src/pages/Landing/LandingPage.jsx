import React from "react";
import { Link } from "react-router-dom";

function LandingPage() {
  const currentHostname = window.location.hostname || "localhost";
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

          <a
            className="landing-button landing-button-link"
            href={portainerUrl}
            target="_blank"
            rel="noreferrer"
          >
            Portainer
          </a>

          <a
            className="landing-button landing-button-link"
            href={process.env.REACT_APP_MONGO_EXPRESS_URL || "http://localhost:8081"}
            target="_blank"
            rel="noreferrer"
          >
            Mongo Express
          </a>
        </div>
      </div>
    </main>
  );
}

export default LandingPage;
