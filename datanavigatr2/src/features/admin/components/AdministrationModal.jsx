import React, { useEffect, useState } from "react";
import "./AdministrationModal.css";

const ROLE_OPTIONS = ["admin", "auditor", "user"];

function AdministrationModal({
  isOpen,
  onClose,
  users,
  onRefreshUsers,
  onCreateUser,
  onToggleActive,
  onDeleteUser,
  onUpdateRoles,
}) {
  const [formData, setFormData] = useState({
    username: "",
    email: "",
    password: "",
    roles: ["user"],
  });

  useEffect(() => {
    function handleEscape(event) {
      if (event.key === "Escape" && isOpen) onClose();
    }

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  function handleRoleToggle(roleName) {
    setFormData((prev) => {
      const alreadySelected = prev.roles.includes(roleName);
      return {
        ...prev,
        roles: alreadySelected
          ? prev.roles.filter((role) => role !== roleName)
          : [...prev.roles, roleName],
      };
    });
  }

  async function handleCreateSubmit(event) {
    event.preventDefault();
    await onCreateUser(formData);
    setFormData({
      username: "",
      email: "",
      password: "",
      roles: ["user"],
    });
  }

  return (
    <div className="admin-modal-overlay" onClick={onClose}>
      <div
        className="admin-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Administration"
      >
        <div className="admin-modal-header">
          <div>
            <h2>Administration</h2>
            <p>Manage users, account status, and assigned roles.</p>
          </div>

          <div className="admin-modal-header-actions">
            <button type="button" className="admin-modal-refresh-button" onClick={onRefreshUsers}>
              Refresh
            </button>
            <button type="button" className="admin-modal-close-button" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>

        <div className="admin-modal-body">
          <section className="admin-modal-panel">
            <h3>Create User</h3>

            <form className="admin-create-user-form" onSubmit={handleCreateSubmit}>
              <label className="admin-field">
                <span>Username</span>
                <input
                  type="text"
                  value={formData.username}
                  onChange={(event) => setFormData((prev) => ({ ...prev, username: event.target.value }))}
                />
              </label>

              <label className="admin-field">
                <span>Email</span>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(event) => setFormData((prev) => ({ ...prev, email: event.target.value }))}
                />
              </label>

              <label className="admin-field">
                <span>Password</span>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(event) => setFormData((prev) => ({ ...prev, password: event.target.value }))}
                />
              </label>

              <div className="admin-role-picker">
                <span>Roles</span>
                <div className="admin-role-options">
                  {ROLE_OPTIONS.map((role) => (
                    <label key={role} className="admin-role-option">
                      <input
                        type="checkbox"
                        checked={formData.roles.includes(role)}
                        onChange={() => handleRoleToggle(role)}
                      />
                      <span>{role}</span>
                    </label>
                  ))}
                </div>
              </div>

              <button type="submit" className="admin-primary-button">
                Create User
              </button>
            </form>
          </section>

          <section className="admin-modal-panel">
            <h3>Users</h3>

            <div className="admin-user-list">
              {users.map((user) => (
                <div className="admin-user-card" key={user.id}>
                  <div className="admin-user-card-top">
                    <div>
                      <div className="admin-user-name">{user.username}</div>
                      <div className="admin-user-email">{user.email}</div>
                    </div>
                    <div className={`admin-user-status ${user.is_active ? "active" : "inactive"}`}>
                      {user.is_active ? "Active" : "Inactive"}
                    </div>
                  </div>

                  <div className="admin-user-roles">
                    {ROLE_OPTIONS.map((role) => (
                      <label key={role} className="admin-role-option">
                        <input
                          type="checkbox"
                          checked={user.roles.includes(role)}
                          onChange={(event) => {
                            const nextRoles = event.target.checked
                              ? [...user.roles, role]
                              : user.roles.filter((item) => item !== role);

                            onUpdateRoles(user.id, Array.from(new Set(nextRoles)));
                          }}
                        />
                        <span>{role}</span>
                      </label>
                    ))}
                  </div>

                  <div className="admin-user-actions">
                    <button
                      type="button"
                      className="admin-secondary-button"
                      onClick={() => onToggleActive(user.id, !user.is_active)}
                    >
                      {user.is_active ? "Deactivate" : "Activate"}
                    </button>

                    <button
                      type="button"
                      className="admin-danger-button"
                      onClick={() => onDeleteUser(user.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default AdministrationModal;