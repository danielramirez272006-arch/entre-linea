import { useId } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap.js';

export function Dialog({ open, title, onClose, children }) {
  const titleId = useId();
  const panelRef = useFocusTrap(open, onClose);

  if (!open) return null;

  return (
    <div
      className="dialog-backdrop anim-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose?.();
        }
      }}
    >
      <div
        ref={panelRef}
        className="dialog-panel anim-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </div>
  );
}
