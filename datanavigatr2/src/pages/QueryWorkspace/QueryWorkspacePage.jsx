import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import TopNavbar from "../../components/navigation/TopNavBar";
import Sidebar from "../../components/navigation/Sidebar";
import LoginModal from "../../features/auth/components/LoginModal";
import AdministrationModal from "../../features/admin/components/AdministrationModal";
import AuditingModal from "../../features/auditing/components/AuditingModal";
import MainContent from "../../features/queries/components/MainContent";
import NewQueryModal from "../../features/queries/components/NewQueryModal";
import "../../App.css";

const API_BASE_URL =
  process.env.REACT_APP_API_BASE_URL ?? "";

function QueryWorkspacePage() {
  const navigate = useNavigate();
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "dark");

  const [accessToken, setAccessToken] = useState(() => sessionStorage.getItem("accessToken") || "");
  const [currentUser, setCurrentUser] = useState(null);

  const [projects, setProjects] = useState([]);
  const [users, setUsers] = useState([]);
  const [queryRuns, setQueryRuns] = useState([]);

  const [isDataLoading, setIsDataLoading] = useState(false);
  const [isAuthLoading, setIsAuthLoading] = useState(false);

  const [authError, setAuthError] = useState("");
  const [globalMessage, setGlobalMessage] = useState("");

  const [isNewQueryModalOpen, setIsNewQueryModalOpen] = useState(false);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [isAdministrationModalOpen, setIsAdministrationModalOpen] = useState(false);
  const [isAuditingModalOpen, setIsAuditingModalOpen] = useState(false);

  const [selectedItem, setSelectedItem] = useState({
    type: "project",
    projectId: null,
    folderId: null,
  });

  const [selectedQuery, setSelectedQuery] = useState(null);

  const isAuthenticated = Boolean(accessToken && currentUser);
  const roles = currentUser?.roles || [];
  const hasAdminRole = roles.includes("admin");
  const hasAuditorRole = roles.includes("auditor");
  const hasUserRole = roles.includes("user");

  useEffect(() => {
    localStorage.setItem("theme", theme);
  }, [theme]);

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
    async function loadProjects() {
      if (!accessToken || !hasUserRole) {
        setProjects([]);
        return;
      }

      setIsDataLoading(true);

      try {
        const response = await fetch(`${API_BASE_URL}/api/projects`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Failed to load projects.");
        }

        const loadedProjects = data.projects || [];
        setProjects(loadedProjects);

        if (loadedProjects.length > 0) {
          setSelectedItem((current) => ({
            ...current,
            type: "project",
            projectId: loadedProjects[0].id,
            folderId: null,
          }));
        }
      } catch (error) {
        setProjects([]);
        setGlobalMessage(error.message || "Failed to load projects.");
      } finally {
        setIsDataLoading(false);
      }
    }

    loadProjects();
  }, [accessToken, hasUserRole]);

  function toggleTheme() {
    setTheme((prevTheme) => (prevTheme === "dark" ? "light" : "dark"));
  }

  function requireLogin(message = "You need to log in to use this feature.") {
    setAuthError(message);
    setIsLoginModalOpen(true);
  }

  async function handleLogin(credentials) {
    setIsAuthLoading(true);
    setAuthError("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(credentials),
        credentials: "include",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Login failed.");
      }

      setAccessToken(data.access_token || "");
      setCurrentUser(data.user || null);
      setIsLoginModalOpen(false);
      setGlobalMessage("");
    } catch (error) {
      setAuthError(error.message || "Login failed.");
    } finally {
      setIsAuthLoading(false);
    }
  }

  async function handleLogout() {
    try {
      await fetch(`${API_BASE_URL}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch {}

    setAccessToken("");
    setCurrentUser(null);
    setProjects([]);
    setUsers([]);
    setQueryRuns([]);
    setSelectedQuery(null);
    setSelectedItem({
      type: "project",
      projectId: null,
      folderId: null,
    });
    setIsAdministrationModalOpen(false);
    setIsAuditingModalOpen(false);
  }

  async function handleOpenQuery(queryId) {
    try {
      const response = await fetch(`${API_BASE_URL}/api/queries/${queryId}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to load query.");
      }

      setSelectedQuery(data.query);
    } catch (error) {
      setGlobalMessage(error.message || "Failed to load query.");
    }
  }

  async function loadUsers() {
    if (!accessToken || !hasAdminRole) return;

    const response = await fetch(`${API_BASE_URL}/api/admin/users`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Failed to load users.");
    }

    setUsers(data.users || []);
  }

  async function loadQueryRuns() {
    if (!accessToken || !hasAuditorRole) return;

    const response = await fetch(`${API_BASE_URL}/api/auditing/query-runs`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Failed to load query runs.");
    }

    setQueryRuns(data.query_runs || []);
  }

  async function handleOpenAdministration() {
    try {
      await loadUsers();
      setIsAdministrationModalOpen(true);
    } catch (error) {
      setGlobalMessage(error.message || "Failed to load administration data.");
    }
  }

  async function handleOpenAuditing() {
    try {
      await loadQueryRuns();
      setIsAuditingModalOpen(true);
    } catch (error) {
      setGlobalMessage(error.message || "Failed to load auditing data.");
    }
  }

  async function handleCreateUser(formData) {
    const response = await fetch(`${API_BASE_URL}/api/admin/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(formData),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Failed to create user.");
    }

    await loadUsers();
  }

  async function handleToggleUserActive(userId, isActive) {
    const response = await fetch(`${API_BASE_URL}/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ is_active: isActive }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Failed to update user.");
    }

    await loadUsers();
  }

  async function handleDeleteUser(userId) {
    const confirmed = window.confirm("Delete this user?");
    if (!confirmed) return;

    const response = await fetch(`${API_BASE_URL}/api/admin/users/${userId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Failed to delete user.");
    }

    await loadUsers();
  }

  async function handleUpdateUserRoles(userId, rolesToAssign) {
    const response = await fetch(`${API_BASE_URL}/api/admin/users/${userId}/roles`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ roles: rolesToAssign }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Failed to update roles.");
    }

    await loadUsers();
  }

  async function handleReviewQueryRun(runId, auditorState) {
    const response = await fetch(`${API_BASE_URL}/api/auditing/query-runs/${runId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        auditor_state: auditorState,
        auditor_notes: "",
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Failed to update query run.");
    }

    await loadQueryRuns();
  }

  async function handleCreateProject(projectName) {
    const response = await fetch(`${API_BASE_URL}/api/projects`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ name: projectName }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Failed to create project.");
    }

    const newProject = data.project;
    setProjects((prev) => [...prev, newProject]);
    setSelectedItem({
      type: "project",
      projectId: newProject.id,
      folderId: null,
    });
  }

  async function handleAddFolder(projectId, folderName) {
    const response = await fetch(`${API_BASE_URL}/api/projects/${projectId}/folders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ name: folderName }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Failed to create folder.");
    }

    setProjects((prevProjects) =>
      prevProjects.map((project) =>
        project.id === projectId
          ? {
              ...project,
              folders: [...project.folders, data.folder],
            }
          : project
      )
    );
  }

  async function handleDeleteProject(projectId) {
    try {
      const projectToDelete = projects.find((project) => project.id === projectId);
      if (!projectToDelete) return;

      const confirmed = window.confirm(
        `Delete project "${projectToDelete.name}" and all folders and saved queries inside it?`
      );
      if (!confirmed) return;

      const response = await fetch(`${API_BASE_URL}/api/projects/${projectId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to delete project.");
      }

      const remainingProjects = projects.filter((project) => project.id !== projectId);
      setProjects(remainingProjects);
      setSelectedQuery(null);

      if (selectedItem.projectId === projectId) {
        setSelectedItem(
          remainingProjects.length > 0
            ? {
                type: "project",
                projectId: remainingProjects[0].id,
                folderId: null,
              }
            : {
                type: "project",
                projectId: null,
                folderId: null,
              }
        );
      }

      setGlobalMessage(data.message || "Project deleted successfully.");
    } catch (error) {
      setGlobalMessage(error.message || "Failed to delete project.");
    }
  }

  async function handleDeleteFolder(projectId, folderId) {
    try {
      const project = projects.find((item) => item.id === projectId);
      const folderToDelete = project?.folders.find((folder) => folder.id === folderId);
      if (!folderToDelete) return;

      const confirmed = window.confirm(
        `Delete folder "${folderToDelete.name}" and all saved queries inside it?`
      );
      if (!confirmed) return;

      const response = await fetch(`${API_BASE_URL}/api/folders/${folderId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to delete folder.");
      }

      setProjects((prevProjects) =>
        prevProjects.map((item) =>
          item.id === projectId
            ? {
                ...item,
                folders: item.folders.filter((folder) => folder.id !== folderId),
              }
            : item
        )
      );
      setSelectedQuery(null);

      if (selectedItem.type === "folder" && selectedItem.folderId === folderId) {
        setSelectedItem({
          type: "project",
          projectId,
          folderId: null,
        });
      }

      setGlobalMessage(data.message || "Folder deleted successfully.");
    } catch (error) {
      setGlobalMessage(error.message || "Failed to delete folder.");
    }
  }

  function handleOpenNewQuery() {
    if (!isAuthenticated) {
      requireLogin("You need to log in to use this feature.");
      return;
    }

    if (!hasUserRole) {
      requireLogin("You need the user role to submit or analyze queries.");
      return;
    }

    setIsNewQueryModalOpen(true);
  }

  async function handleCreateQuery(payload) {
    if (!isAuthenticated || !hasUserRole) {
      requireLogin("You need the user role to submit or analyze queries.");
      return;
    }

    const response = await fetch(`${API_BASE_URL}/api/queries`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      setGlobalMessage(data.error || "Failed to save query.");
      return;
    }

    const newQuery = data.query;
    const targetProjectId = payload.projectId;
    const targetFolderId = payload.folderId;

    setProjects((prevProjects) =>
      prevProjects.map((project) => {
        if (project.id !== targetProjectId) return project;

        if (targetFolderId) {
          return {
            ...project,
            folders: project.folders.map((folder) =>
              folder.id === targetFolderId
                ? { ...folder, queries: [newQuery, ...folder.queries] }
                : folder
            ),
          };
        }

        return {
          ...project,
          queries: [newQuery, ...project.queries],
        };
      })
    );

    setSelectedItem({
      type: targetFolderId ? "folder" : "project",
      projectId: targetProjectId,
      folderId: targetFolderId || null,
    });

    setSelectedQuery(null);
    setIsNewQueryModalOpen(false);
    setGlobalMessage("Query saved successfully.");
  }

  const selectedProject = useMemo(() => {
    return projects.find((project) => project.id === selectedItem.projectId) || null;
  }, [projects, selectedItem]);

  const selectedFolder = useMemo(() => {
    if (!selectedProject || selectedItem.type !== "folder") return null;
    return selectedProject.folders.find((folder) => folder.id === selectedItem.folderId) || null;
  }, [selectedProject, selectedItem]);

  useEffect(() => {
    setSelectedQuery(null);
  }, [selectedItem]);

  return (
    <div className={`app-shell ${theme}`}>
      <TopNavbar
        theme={theme}
        toggleTheme={toggleTheme}
        onOpenNewQuery={handleOpenNewQuery}
        isAuthenticated={isAuthenticated}
        currentUser={currentUser}
        onLoginClick={() => {
          setAuthError("");
          setIsLoginModalOpen(true);
        }}
        onLogoutClick={handleLogout}
        onAdministrationClick={handleOpenAdministration}
        onAuditingClick={handleOpenAuditing}
        onGoToMenu={() => navigate("/")}
      />

      <div className="app-layout">
        <Sidebar
          projects={projects}
          selectedItem={selectedItem}
          setSelectedItem={setSelectedItem}
          isAuthenticated={isAuthenticated}
          hasUserRole={hasUserRole}
          onRequireLogin={requireLogin}
          onCreateProject={handleCreateProject}
          onAddFolder={handleAddFolder}
          onDeleteProject={handleDeleteProject}
          onDeleteFolder={handleDeleteFolder}
        />

        <MainContent
          selectedItem={selectedItem}
          selectedProject={selectedProject}
          selectedFolder={selectedFolder}
          selectedQuery={selectedQuery}
          setSelectedItem={setSelectedItem}
          setSelectedQuery={setSelectedQuery}
          onOpenQuery={handleOpenQuery}
          isAuthenticated={isAuthenticated}
          hasUserRole={hasUserRole}
          isDataLoading={isDataLoading}
          accessToken={accessToken}
        />
      </div>

      <NewQueryModal
        isOpen={isNewQueryModalOpen}
        onClose={() => setIsNewQueryModalOpen(false)}
        onSubmit={handleCreateQuery}
        projects={projects}
        selectedItem={selectedItem}
      />

      <LoginModal
        isOpen={isLoginModalOpen}
        onClose={() => setIsLoginModalOpen(false)}
        onLogin={handleLogin}
        errorMessage={authError}
        isLoading={isAuthLoading}
      />

      <AdministrationModal
        isOpen={isAdministrationModalOpen}
        onClose={() => setIsAdministrationModalOpen(false)}
        users={users}
        onRefreshUsers={loadUsers}
        onCreateUser={handleCreateUser}
        onToggleActive={handleToggleUserActive}
        onDeleteUser={handleDeleteUser}
        onUpdateRoles={handleUpdateUserRoles}
      />

      <AuditingModal
        isOpen={isAuditingModalOpen}
        onClose={() => setIsAuditingModalOpen(false)}
        queryRuns={queryRuns}
        onRefresh={loadQueryRuns}
        onReview={handleReviewQueryRun}
      />

      {globalMessage && (
        <div
          style={{
            position: "fixed",
            bottom: 20,
            right: 20,
            padding: "12px 16px",
            borderRadius: 12,
            border: "1px solid var(--border)",
            background: "var(--panel)",
            color: "var(--text)",
            boxShadow: "var(--shadow)",
            zIndex: 2000,
          }}
        >
          {globalMessage}
        </div>
      )}
    </div>
  );
}

export default QueryWorkspacePage;
