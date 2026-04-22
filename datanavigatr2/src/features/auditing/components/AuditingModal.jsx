import React, { useEffect } from "react";
import "./AuditingModal.css";

function AuditingModal({ isOpen, onClose, queryRuns, onRefresh, onReview }) {
  useEffect(() => {
    function handleEscape(event) {
      if (event.key === "Escape" && isOpen) onClose();
    }

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="auditing-modal-overlay" onClick={onClose}>
      <div
        className="auditing-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Auditing"
      >
        <div className="auditing-modal-header">
          <div>
            <h2>Auditing</h2>
            <p>Review query activity, parameters, and audit status.</p>
          </div>

          <div className="auditing-modal-header-actions">
            <button type="button" className="auditing-modal-refresh-button" onClick={onRefresh}>
              Refresh
            </button>
            <button type="button" className="auditing-modal-close-button" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>

        <div className="auditing-modal-body">
          {queryRuns.length === 0 ? (
            <div className="auditing-empty-state">No query runs available yet.</div>
          ) : (
            <div className="auditing-run-list">
              {queryRuns.map((run) => (
                <div className="auditing-run-card" key={run.id}>
                  <div className="auditing-run-top">
                    <div>
                      <div className="auditing-run-title">{run.query_name}</div>
                      <div className="auditing-run-meta">
                        Ran by <strong>{run.user?.username || "unknown"}</strong> on{" "}
                        {run.created_at}
                      </div>
                    </div>

                    <div className={`auditing-run-state state-${run.auditor_state}`}>
                      {run.auditor_state}
                    </div>
                  </div>

                  <div className="auditing-run-parameters">
                    <div className="auditing-run-section-title">Parameters</div>
                    <pre>{JSON.stringify(run.parameters || {}, null, 2)}</pre>
                  </div>

                  {run.auditor_notes && (
                    <div className="auditing-run-notes">
                      <div className="auditing-run-section-title">Auditor Notes</div>
                      <div>{run.auditor_notes}</div>
                    </div>
                  )}

                  <div className="auditing-run-actions">
                    <button
                      type="button"
                      className="auditing-approve-button"
                      onClick={() => onReview(run.id, "approved")}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="auditing-flag-button"
                      onClick={() => onReview(run.id, "flagged")}
                    >
                      Flag
                    </button>
                    <button
                      type="button"
                      className="auditing-reset-button"
                      onClick={() => onReview(run.id, "unreviewed")}
                    >
                      Reset
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default AuditingModal;