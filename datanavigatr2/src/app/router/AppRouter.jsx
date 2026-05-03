import React, { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import IngestPage from "../../pages/Ingest/IngestPage";
import LandingPage from "../../pages/Landing/LandingPage";
import GeoNaviGatrPage from "../../pages/GeoNaviGatr/GeoNaviGatrPage";
import QueryWorkspacePage from "../../pages/QueryWorkspace/QueryWorkspacePage";

function AppRouter() {
  const location = useLocation();

  useEffect(() => {
    document.title = "DataNaviGatr2";
  }, [location.pathname]);

  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/app" element={<QueryWorkspacePage />} />
      <Route path="/app/geo/:queryId" element={<GeoNaviGatrPage />} />
      <Route path="/ingest" element={<IngestPage />} />
    </Routes>
  );
}

export default AppRouter;
