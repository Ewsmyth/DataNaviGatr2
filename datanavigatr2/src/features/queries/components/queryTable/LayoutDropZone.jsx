import React from "react";
import { useDroppable } from "@dnd-kit/core";

function LayoutDropZone({ containerId, title, subtitle, children, isEmpty, emptyMessage }) {
  const { isOver, setNodeRef } = useDroppable({
    id: containerId,
    data: {
      containerId,
      type: "container",
    },
  });

  return (
    <section className="layout-column-panel">
      <div className="layout-column-panel-header">
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>

      <div
        ref={setNodeRef}
        className={`layout-column-list ${isOver ? "layout-column-list-over" : ""} ${
          isEmpty ? "layout-column-list-empty" : ""
        }`}
      >
        {isEmpty ? <div className="layout-column-empty">{emptyMessage}</div> : children}
      </div>
    </section>
  );
}

export default LayoutDropZone;
