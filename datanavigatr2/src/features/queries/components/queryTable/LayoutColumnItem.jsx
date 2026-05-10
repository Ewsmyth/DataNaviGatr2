import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/*
 * Draggable column item used inside the table layout editor.
 * column supplies the display label/key; containerId tells dnd-kit whether the
 * item currently lives in the available or visible column list.
 */
function LayoutColumnItem({ column, containerId }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: column.key,
    data: {
      containerId,
      type: "column",
    },
  });

  /*
   * dnd-kit gives transforms as structured values. CSS.Transform serializes them
   * into the inline style React can apply while dragging.
   */
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`layout-column-item ${isDragging ? "layout-column-item-dragging" : ""}`}
    >
      <button
        type="button"
        className="layout-column-handle"
        aria-label={`Drag ${column.label}`}
        {...attributes}
        {...listeners}
      >
        ☰
      </button>

      <div className="layout-column-content">
        <span className="layout-column-label">{column.label}</span>
        <span className="layout-column-key">{column.key}</span>
      </div>
    </div>
  );
}

export default LayoutColumnItem;
