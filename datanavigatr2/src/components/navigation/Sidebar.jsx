import React, { useState } from "react";
import "./Sidebar.css";

function Sidebar({
  projects,
  selectedItem,
  setSelectedItem,
  isAuthenticated,
  hasUserRole,
  onRequireLogin,
  onCreateProject,
  onAddFolder,
  onDeleteProject,
  onDeleteFolder,
}) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  function toggleSidebar() {
    setIsCollapsed((prev) => !prev);
  }

  function createProject() {
    if (!isAuthenticated) {
      onRequireLogin("You need to log in to use this feature.");
      return;
    }

    if (!hasUserRole) {
      onRequireLogin("You need the user role to create and manage projects.");
      return;
    }

    const projectName = window.prompt("Enter project name:");
    if (!projectName || !projectName.trim()) return;

    onCreateProject(projectName.trim());
  }

  function selectProject(projectId) {
    if (!isAuthenticated || !hasUserRole) {
      onRequireLogin("You need the user role to access project data.");
      return;
    }

    setSelectedItem({
      type: "project",
      projectId,
      folderId: null,
    });
  }

  function selectFolder(projectId, folderId) {
    if (!isAuthenticated || !hasUserRole) {
      onRequireLogin("You need the user role to access folder data.");
      return;
    }

    setSelectedItem({
      type: "folder",
      projectId,
      folderId,
    });
  }

  function toggleProject(projectId) {
    if (!isAuthenticated || !hasUserRole) {
      onRequireLogin("You need the user role to access project data.");
      return;
    }
  }

  function addFolder(projectId) {
    if (!isAuthenticated) {
      onRequireLogin("You need to log in to use this feature.");
      return;
    }

    if (!hasUserRole) {
      onRequireLogin("You need the user role to create folders.");
      return;
    }

    const folderName = window.prompt("Enter sub-folder name:");
    if (!folderName || !folderName.trim()) return;

    onAddFolder(projectId, folderName.trim());
  }

  async function deleteProject(projectId) {
    if (!isAuthenticated) {
      onRequireLogin("You need to log in to use this feature.");
      return;
    }

    if (!hasUserRole) {
      onRequireLogin("You need the user role to manage projects.");
      return;
    }

    await onDeleteProject(projectId);
  }

  async function deleteFolder(projectId, folderId) {
    if (!isAuthenticated) {
      onRequireLogin("You need to log in to use this feature.");
      return;
    }

    if (!hasUserRole) {
      onRequireLogin("You need the user role to manage folders.");
      return;
    }

    await onDeleteFolder(projectId, folderId);
  }

  return (
    <aside className={`sidebar ${isCollapsed ? "collapsed" : ""}`}>
      <button
        className="sidebar-toggle-button"
        onClick={toggleSidebar}
        type="button"
        aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {isCollapsed ? (
          <svg className="expand-chevron-right" xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px">
            <path d="M522-480 333-669l51-51 240 240-240 240-51-51 189-189Z"/>
          </svg>
        ) : (
          <svg className="collapse-chevron-left" xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px">
            <path d="M576-240 336-480l240-240 51 51-189 189 189 189-51 51Z"/>
          </svg>
        )}
      </button>

      {!isCollapsed && (
        <>
          <div className="sidebar-header">
            <h2 className="sidebar-title">Projects</h2>
          </div>

          <div className="sidebar-actions">
            <button
              className="new-project-button"
              onClick={createProject}
              type="button"
            >
              + New Project
            </button>
          </div>

          {!isAuthenticated ? (
            <div className="empty-folder-text">Log in to view projects and folders.</div>
          ) : !hasUserRole ? (
            <div className="empty-folder-text">Your account does not have the user role.</div>
          ) : (
            <div className="sidebar-project-list">
              {projects.map((project) => {
                const isProjectSelected =
                  selectedItem.type === "project" &&
                  selectedItem.projectId === project.id;

                return (
                  <div className="project-item" key={project.id}>
                    <div className="project-row">
                      <div className="project-main-controls">
                        <button
                          className={`project-expand-button ${project.isOpen ? "open" : ""}`}
                          onClick={() => toggleProject(project.id)}
                          type="button"
                          aria-label={project.isOpen ? "Collapse project" : "Expand project"}
                        >
                          ▾
                        </button>

                        <button
                          className={`project-name-button ${isProjectSelected ? "selected" : ""}`}
                          onClick={() => selectProject(project.id)}
                          type="button"
                        >
                          <span className="project-name-text">{project.name}</span>
                        </button>
                      </div>

                      <button
                        className="add-folder-button"
                        onClick={() => addFolder(project.id)}
                        type="button"
                        aria-label={`Add folder to ${project.name}`}
                        title="Add sub-folder"
                      >
                        +
                      </button>

                      <button
                        className="delete-item-button"
                        onClick={() => deleteProject(project.id)}
                        type="button"
                        aria-label={`Delete ${project.name}`}
                        title="Delete project"
                      >
                        ×
                      </button>
                    </div>

                    {project.isOpen && project.folders.length > 0 && (
                      <div className="folder-list">
                        {project.folders.map((folder) => {
                          const isFolderSelected =
                            selectedItem.type === "folder" &&
                            selectedItem.projectId === project.id &&
                            selectedItem.folderId === folder.id;

                          return (
                            <div className="folder-row" key={folder.id}>
                              <button
                                className={`folder-item folder-select-button ${isFolderSelected ? "selected" : ""}`}
                                type="button"
                                onClick={() => selectFolder(project.id, folder.id)}
                              >
                                <span className="folder-icon">📁</span>
                                <span className="folder-name">{folder.name}</span>
                              </button>

                              <button
                                className="delete-item-button folder-delete-button"
                                onClick={() => deleteFolder(project.id, folder.id)}
                                type="button"
                                aria-label={`Delete ${folder.name}`}
                                title="Delete folder"
                              >
                                ×
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {project.isOpen && project.folders.length === 0 && (
                      <div className="empty-folder-text">No sub-folders yet</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </aside>
  );
}

export default Sidebar;
