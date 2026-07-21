import { useModalA11y } from '../hooks/useModalA11y.js'

// The dialog shell every build hand-rolled one to three times over: backdrop that
// closes on a true outside press (mousedown ON the wrap, not a drag that ends there),
// role=dialog with aria-modal, the a11y hook (escape, focus trap, focus restore), and
// the ✕ button. Content is entirely the caller's; pass className for the per-modal
// sizing class the family's CSS keys on (e.g. "cal-modal", "services-modal").
//
// Styling contract (already in every sibling's index.css): .modal-wrap is the fixed
// backdrop, .modal the sheet, .modal-x the close button.
export default function Modal({ label, className = '', onClose, children }) {
  const ref = useModalA11y(onClose)
  return (
    <div className="modal-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={className ? `modal ${className}` : 'modal'}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        ref={ref}
        tabIndex={-1}
      >
        <button className="modal-x" onClick={onClose} aria-label="Close">
          ✕
        </button>
        {children}
      </div>
    </div>
  )
}
