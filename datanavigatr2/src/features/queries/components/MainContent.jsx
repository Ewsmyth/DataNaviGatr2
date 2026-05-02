import React from "react";
import "./MainContent.css";
import QueryTable from "./QueryTable";

function MainContent({
  selectedItem,
  selectedProject,
  selectedFolder,
  selectedQuery,
  queryLoadingProgress,
  setSelectedItem,
  setSelectedQuery,
  onOpenQuery,
  isAuthenticated,
  hasUserRole,
  isDataLoading,
  accessToken,
}) {
  if (!isAuthenticated) {
    return (
      <main className="app-main query-view-main">
        <div className="main-content-header">
          <h1>DataNaviGatr2</h1>
          <p>Please log in to load projects, saved queries, and results.</p>
        </div>

        <div className="main-content-body">
          <section className="content-section">
            <div className="empty-state-card">
              You are currently viewing the guest mode layout. Use the profile icon in the
              top right to log in.
            </div>
          </section>
        </div>
      </main>
    );
  }

  if (!hasUserRole) {
    return (
      <main className="app-main query-view-main">
        <div className="main-content-header">
          <h1>Restricted</h1>
          <p>Your account is logged in but does not have the user role.</p>
        </div>

        <div className="main-content-body">
          <section className="content-section">
            <div className="empty-state-card">
              This account can access administrative or auditing tools only.
            </div>
          </section>
        </div>
      </main>
    );
  }

  if (isDataLoading) {
    return (
      <main className="app-main query-view-main">
        <div className="main-content-header">
          <h1>Loading...</h1>
          <p>Fetching your projects and saved queries.</p>
        </div>
      </main>
    );
  }

  function getMainContentData() {
    if (!selectedProject) {
      return {
        title: "Nothing selected",
        subtitle: "Select a project or folder from the sidebar.",
        folders: [],
        queries: [],
      };
    }

    if (selectedItem.type === "folder" && selectedFolder) {
      return {
        title: selectedFolder.name,
        subtitle: `Folder inside ${selectedProject.name}`,
        folders: [],
        queries: selectedFolder.queries || [],
      };
    }

    return {
      title: selectedProject.name,
      subtitle: "Project contents",
      folders: selectedProject.folders || [],
      queries: selectedProject.queries || [],
    };
  }

  const mainContent = getMainContentData();

  if (selectedQuery) {
    return (
      <main className="app-main query-view-main">
        <QueryTable
          query={selectedQuery}
          accessToken={accessToken}
          loadingProgress={queryLoadingProgress}
        />
      </main>
    );
  }

  return (
    <main className="app-main query-view-main">
      <div className="main-content-header">
        <h1>{mainContent.title}</h1>
        <p>{mainContent.subtitle}</p>
      </div>

      <div className="main-content-body">
        {selectedItem.type === "project" && mainContent.folders.length > 0 && (
          <section className="content-section">
            <div className="section-heading-row">
              <h2>Folders</h2>
              <span className="section-count">{mainContent.folders.length}</span>
            </div>

            <div className="folder-card-grid">
              {mainContent.folders.map((folder) => (
                <button
                  key={folder.id}
                  className="folder-content-card"
                  type="button"
                  onClick={() => {
                    setSelectedQuery(null);
                    setSelectedItem({
                      type: "folder",
                      projectId: selectedProject.id,
                      folderId: folder.id,
                    });
                  }}
                >
                  <div className="folder-card-icon">📁</div>
                  <div className="folder-card-text">
                    <div className="folder-card-title">{folder.name}</div>
                    <div className="folder-card-meta">
                      {(folder.queries || []).length} saved quer
                      {(folder.queries || []).length === 1 ? "y" : "ies"}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="content-section">
          <div className="section-heading-row">
            <h2>Saved Queries</h2>
            <span className="section-count">{mainContent.queries.length}</span>
          </div>

          {mainContent.queries.length > 0 ? (
            <div className="query-list">
              {mainContent.queries.map((query) => (
                <button
                  className="query-card query-card-button"
                  key={query.id}
                  type="button"
                  onClick={() => onOpenQuery(query.id)}
                >
                  <div className="query-card-top">
                    <h3>{query.name}</h3>
                    <span className="query-results-pill">
                      {query.resultCount} results
                    </span>
                  </div>

                  <div className="query-meta-row">
                    <span>
                      <strong>Creator:</strong> {query.creator}
                    </span>
                    <span>
                      <strong>Created:</strong> {query.createdAt}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="empty-state-card">
              No saved queries in this {selectedItem.type === "folder" ? "folder" : "project"} yet.
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

export default MainContent;
