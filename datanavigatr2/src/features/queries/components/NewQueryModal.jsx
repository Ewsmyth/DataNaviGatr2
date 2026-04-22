import React, { useEffect, useMemo, useState } from "react";
import "./NewQueryModal.css";
import { DEFAULT_TEMPLATES } from "../data/queryTemplates";
import { buildInitialValues } from "../utils/queryForm";

function NewQueryModal({ isOpen, onClose, onSubmit, templates = DEFAULT_TEMPLATES, projects = [], selectedItem, }) {
  const [selectedTemplateId, setSelectedTemplateId] = useState(templates[0]?.id || "");
  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) || templates[0],
    [selectedTemplateId, templates]
  );
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedFolderId, setSelectedFolderId] = useState("");
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) || null,
    [projects, selectedProjectId]
  );

  const [formValues, setFormValues] = useState(
    selectedTemplate ? buildInitialValues(selectedTemplate) : {}
  );

  useEffect(() => {
    if (selectedTemplate) {
      setFormValues(buildInitialValues(selectedTemplate));
    }
  }, [selectedTemplate]);

  useEffect(() => {
    function handleEscape(event) {
      if (event.key === "Escape" && isOpen) {
        onClose();
      }
    }

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;

    const fallbackProjectId = projects[0]?.id || "";
    const initialProjectId = selectedItem?.projectId || fallbackProjectId;
    const initialFolderId =
      selectedItem?.type === "folder" ? selectedItem.folderId || "" : "";

    setSelectedProjectId(initialProjectId);
    setSelectedFolderId(initialFolderId);
  }, [isOpen, projects, selectedItem]);

  useEffect(() => {
    if (!selectedProject) {
      setSelectedFolderId("");
      return;
    }

    const folderStillExists = selectedProject.folders?.some(
      (folder) => folder.id === selectedFolderId
    );

    if (!folderStillExists) {
      setSelectedFolderId("");
    }
  }, [selectedProject, selectedFolderId]);

  if (!isOpen || !selectedTemplate) return null;

  function handleFieldChange(fieldKey, value) {
    setFormValues((prev) => ({
      ...prev,
      [fieldKey]: value
    }));
  }

  function handleSubmit(event) {
    event.preventDefault();

    if (!selectedProjectId) {
      return;
    }

    const payload = {
      templateId: selectedTemplate.id,
      templateName: selectedTemplate.name,
      queryName: formValues.queryName?.trim() || selectedTemplate.name,
      projectId: selectedProjectId,
      folderId: selectedFolderId || null,
      parameters: formValues
    };

    onSubmit(payload);
  }

  return (
    <div className="new-query-modal-overlay" onClick={onClose}>
      <div
        className="new-query-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Create new query"
      >
        <div className="new-query-modal-header">
          <div>
            <h2>Create New Query</h2>
            <p>Select a template and fill in the parameters to send to the API server.</p>
          </div>

          <button
            type="button"
            className="new-query-close-button"
            onClick={onClose}
            aria-label="Close new query modal"
          >
            ✕
          </button>
        </div>

        <div className="new-query-modal-body">
          <aside className="new-query-template-list">
            <div className="new-query-template-list-title">Templates</div>

            {templates.map((template) => {
              const isSelected = template.id === selectedTemplateId;

              return (
                <button
                  key={template.id}
                  type="button"
                  className={`new-query-template-item ${isSelected ? "selected" : ""}`}
                  onClick={() => setSelectedTemplateId(template.id)}
                >
                  <div className="new-query-template-name">{template.name}</div>
                  <div className="new-query-template-description">{template.description}</div>
                </button>
              );
            })}
          </aside>

          <section className="new-query-template-preview">
            <div className="new-query-preview-header">
              <h3>{selectedTemplate.name}</h3>
              <p>{selectedTemplate.description}</p>
            </div>

            <form className="new-query-form" onSubmit={handleSubmit}>
              <div className="new-query-form-grid">
                <label className="new-query-form-field">
                  <span>Project</span>
                  <select
                    value={selectedProjectId}
                    onChange={(event) => {
                      setSelectedProjectId(event.target.value);
                      setSelectedFolderId("");
                    }}
                  >
                    <option value="">Select project...</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="new-query-form-field">
                  <span>Save To</span>
                  <select
                    value={selectedFolderId}
                    onChange={(event) => setSelectedFolderId(event.target.value)}
                    disabled={!selectedProjectId}
                  >
                    <option value="">Project root</option>
                    {(selectedProject?.folders || []).map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.name}
                      </option>
                    ))}
                  </select>
                </label>

                {selectedTemplate.fields.map((field) => (
                  <label
                    key={field.key}
                    className={`new-query-form-field ${
                      field.type === "textarea" ? "full-width" : ""
                    }`}
                  >
                    <span>{field.label}</span>

                    {field.type === "select" ? (
                      <select
                        value={formValues[field.key] || ""}
                        onChange={(event) => handleFieldChange(field.key, event.target.value)}
                      >
                        {field.options.map((option) => (
                          <option key={option || "empty-option"} value={option}>
                            {option || "Select..."}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={field.type}
                        value={formValues[field.key] || ""}
                        placeholder={field.placeholder || ""}
                        onChange={(event) => handleFieldChange(field.key, event.target.value)}
                      />
                    )}
                  </label>
                ))}
              </div>

              <div className="new-query-preview-payload">
                <div className="new-query-preview-payload-title">Payload Preview</div>
                <pre>
{JSON.stringify(
  {
    templateId: selectedTemplate.id,
    templateName: selectedTemplate.name,
    queryName: formValues.queryName?.trim() || selectedTemplate.name,
    projectId: selectedProjectId || null,
    folderId: selectedFolderId || null,
    parameters: formValues
  },
  null,
  2
)}
                </pre>
              </div>

              <div className="new-query-modal-actions">
                <button
                  type="button"
                  className="new-query-secondary-button"
                  onClick={onClose}
                >
                  Cancel
                </button>

                <button type="submit" className="new-query-primary-button" disabled={!selectedProjectId}>
                  Submit Query
                </button>
              </div>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}

export default NewQueryModal;
