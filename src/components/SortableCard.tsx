import type { ReactNode } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';

export function SortableCard({
  id,
  dragLabel,
  disabled = false,
  children,
}: {
  id: string;
  dragLabel: string;
  disabled?: boolean;
  children: (handle: ReactNode) => ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });
  return (
    <div
      ref={setNodeRef}
      data-sortable-card={id}
      className={isDragging ? 'relative opacity-0' : 'relative'}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      {children(
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          disabled={disabled}
          aria-label={dragLabel}
          className="flex-shrink-0 p-0.5 text-cyber-text-muted/60 hover:text-cyber-text transition-colors outline-none"
        >
          <GripVertical size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
