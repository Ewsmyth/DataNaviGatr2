import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

function SortableColumnItem({ column, onToggleVisibility }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: column.key });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`column-settings-item ${isDragging ? "column-settings-item-dragging" : ""}`}
    >
      <button
        type="button"
        className="column-drag-handle-button"
        aria-label={`Drag ${column.label}`}
        {...attributes}
        {...listeners}
      >
        ☰
      </button>

      <label className="column-settings-label">
        <input
          type="checkbox"
          checked={column.visible}
          onChange={() => onToggleVisibility(column.key)}
        />
        <span>{column.label}</span>
      </label>
    </div>
  );
}

export default SortableColumnItem;
