import React, { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import IngestPage from "../../pages/Ingest/IngestPage";
import LandingPage from "../../pages/Landing/LandingPage";
import DataViewPage from "../../pages/DataView/DataViewPage";
import GeoNaviGatrPage from "../../pages/GeoNaviGatr/GeoNaviGatrPage";
import QueryWorkspacePage from "../../pages/QueryWorkspace/QueryWorkspacePage";

/*
 * Central route table for the React app.
 * The landing page is the menu, /app is the main query workspace, /app/geo/:id
 * is the map companion view for one query, and the ingest/dataview routes are
 * admin-oriented operational pages.
 */
function AppRouter() {
  const location = useLocation();

  /*
   * Keeps the browser tab title consistent when moving between routes.
   */
  useEffect(() => {
    document.title = "DataNaviGatr2";
  }, [location.pathname]);

  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/app" element={<QueryWorkspacePage />} />
      <Route path="/app/geo/:queryId" element={<GeoNaviGatrPage />} />
      <Route path="/ingest" element={<IngestPage />} />
      <Route path="/dataview" element={<DataViewPage />} />
    </Routes>
  );
}

export default AppRouter;
