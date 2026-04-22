import React from "react";
import { Route, Routes } from "react-router-dom";
import IngestPage from "../../pages/Ingest/IngestPage";
import LandingPage from "../../pages/Landing/LandingPage";
import QueryWorkspacePage from "../../pages/QueryWorkspace/QueryWorkspacePage";

function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/app" element={<QueryWorkspacePage />} />
      <Route path="/ingest" element={<IngestPage />} />
    </Routes>
  );
}

export default AppRouter;
