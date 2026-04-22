import React from "react";

function DragOverlayItem({ column }) {
  if (!column) return null;

  return (
    <div className="column-settings-item column-settings-item-overlay">
      <span className="column-drag-handle-static">☰</span>
      <div className="column-settings-label column-settings-label-overlay">
        <input type="checkbox" checked={column.visible} readOnly />
        <span>{column.label}</span>
      </div>
    </div>
  );
}

export default DragOverlayItem;
