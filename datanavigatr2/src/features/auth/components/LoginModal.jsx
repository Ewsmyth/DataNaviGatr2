import React, { useEffect, useState } from "react";
import "./LoginModal.css";

/*
 * Reusable username/email + password modal.
 * The modal owns only local input fields; QueryWorkspacePage performs the actual
 * login request and passes errors/loading state back in through props.
 */
function LoginModal({ isOpen, onClose, onLogin, errorMessage, isLoading }) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");

  /*
   * Clear credentials whenever the modal closes so passwords are not retained in
   * hidden component state.
   */
  useEffect(() => {
    if (!isOpen) {
      setIdentifier("");
      setPassword("");
    }
  }, [isOpen]);

  useEffect(() => {
    function handleEscape(event) {
      if (event.key === "Escape" && isOpen) onClose();
    }

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  /*
   * Sends trimmed identifier and raw password to the parent login handler.
   */
  function handleSubmit(event) {
    event.preventDefault();
    onLogin({
      identifier: identifier.trim(),
      password,
    });
  }

  return (
    <div className="login-modal-overlay" onClick={onClose}>
      <div
        className="login-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Login"
      >
        <div className="login-modal-header">
          <div>
            <h2>Login</h2>
            <p>Sign in to access the site.</p>
          </div>

          <button
            type="button"
            className="login-modal-close-button"
            onClick={onClose}
            aria-label="Close login modal"
          >
            ✕
          </button>
        </div>

        <form className="login-modal-form" onSubmit={handleSubmit}>
          <label className="login-modal-field">
            <span>Username or Email</span>
            <input
              type="text"
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              placeholder="Enter username or email"
              autoComplete="username"
            />
          </label>

          <label className="login-modal-field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter password"
              autoComplete="current-password"
            />
          </label>

          {errorMessage && <div className="login-modal-error">{errorMessage}</div>}

          <div className="login-modal-actions">
            <button
              type="button"
              className="login-modal-secondary-button"
              onClick={onClose}
            >
              Cancel
            </button>

            <button
              type="submit"
              className="login-modal-primary-button"
              disabled={isLoading}
            >
              {isLoading ? "Logging in..." : "Login"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default LoginModal;
