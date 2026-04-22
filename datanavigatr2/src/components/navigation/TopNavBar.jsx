import React, { useEffect, useRef, useState } from "react";
import "./TopNavBar.css";

function TopNavbar({
  theme,
  toggleTheme,
  onOpenNewQuery,
  isAuthenticated,
  currentUser,
  onLoginClick,
  onLogoutClick,
  onAdministrationClick,
  onAuditingClick,
  onGoToMenu,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const profileMenuRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    }

    function handleEscape(event) {
      if (event.key === "Escape") setMenuOpen(false);
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  const roles = currentUser?.roles || [];
  const hasAdminRole = roles.includes("admin");
  const hasAuditorRole = roles.includes("auditor");

  return (
    <header className="top-navbar">
      <div className="top-left-navbar-div">
        <div className="return-wrapper">
          <button
            type="button"
            className="return-link return-link-button"
            onClick={onGoToMenu}
          >
            DataNaviGatr2
          </button>
        </div>

        <div className="create-query-wrapper">
          <button
            type="button"
            className="create-query-link create-query-button"
            onClick={onOpenNewQuery}
          >
            New Query
          </button>
        </div>
      </div>

      <div className="top-right-navbar-div">
        <div className="theme-wrapper">
          <button
            className="theme-button"
            onClick={toggleTheme}
            aria-label="Toggle theme"
            type="button"
          >
            {theme === "dark" ? (
              <svg className="theme-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960">
                <path d="M480-120q-150 0-255-105T120-480q0-150 105-255t255-105q14 0 27.5 1t26.5 3q-41 29-65.5 75.5T444-660q0 90 63 153t153 63q55 0 101-24.5t75-65.5q2 13 3 26.5t1 27.5q0 150-105 255T480-120Zm0-80q88 0 158-48.5T740-375q-20 5-40 8t-40 3q-123 0-209.5-86.5T364-660q0-20 3-40t8-40q-78 32-126.5 102T200-480q0 116 82 198t198 82Zm-10-270Z"/>
              </svg>
            ) : (
              <svg className="theme-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960">
                <path d="M565-395q35-35 35-85t-35-85q-35-35-85-35t-85 35q-35 35-35 85t35 85q35 35 85 35t85-35Zm-226.5 56.5Q280-397 280-480t58.5-141.5Q397-680 480-680t141.5 58.5Q680-563 680-480t-58.5 141.5Q563-280 480-280t-141.5-58.5ZM200-440H40v-80h160v80Zm720 0H760v-80h160v80ZM440-760v-160h80v160h-80Zm0 720v-160h80v160h-80ZM256-650l-101-97 57-59 96 100-52 56Zm492 496-97-101 53-55 101 97-57 59Zm-98-550 97-101 59 57-100 96-56-52ZM154-212l101-97 55 53-97 101-59-57Zm326-268Z"/>
              </svg>
            )}
          </button>
        </div>

        <div className="profile-wrapper profile-menu-wrapper" ref={profileMenuRef}>
          <button
            type="button"
            className="profile-link profile-menu-button"
            aria-label="Profile"
            onClick={() => setMenuOpen((current) => !current)}
          >
            <svg className="profile-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960">
              <path d="M234-276q51-39 114-61.5T480-360q69 0 132 22.5T726-276q35-41 54.5-93T800-480q0-133-93.5-226.5T480-800q-133 0-226.5 93.5T160-480q0 59 19.5 111t54.5 93Zm146.5-204.5Q340-521 340-580t40.5-99.5Q421-720 480-720t99.5 40.5Q620-639 620-580t-40.5 99.5Q539-440 480-440t-99.5-40.5ZM480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Z"/>
            </svg>
          </button>

          {menuOpen && (
            <div className="profile-dropdown-menu">
              <div className="profile-dropdown-header">
                {isAuthenticated ? (
                  <>
                    <div className="profile-dropdown-title">{currentUser?.username || "Logged in"}</div>
                    <div className="profile-dropdown-subtitle">{currentUser?.email || ""}</div>
                  </>
                ) : (
                  <>
                    <div className="profile-dropdown-title">Guest</div>
                    <div className="profile-dropdown-subtitle">Please log in</div>
                  </>
                )}
              </div>

              {isAuthenticated && hasAdminRole && (
                <button
                  type="button"
                  className="profile-dropdown-item"
                  onClick={() => {
                    setMenuOpen(false);
                    onAdministrationClick();
                  }}
                >
                  Administration
                </button>
              )}

              {isAuthenticated && hasAuditorRole && (
                <button
                  type="button"
                  className="profile-dropdown-item"
                  onClick={() => {
                    setMenuOpen(false);
                    onAuditingClick();
                  }}
                >
                  Auditing
                </button>
              )}

              <button
                type="button"
                className="profile-dropdown-item"
                onClick={() => {
                  setMenuOpen(false);
                  onLoginClick();
                }}
              >
                Login
              </button>

              <button
                type="button"
                className="profile-dropdown-item"
                onClick={() => {
                  setMenuOpen(false);
                  onLogoutClick();
                }}
              >
                Log Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

export default TopNavbar;