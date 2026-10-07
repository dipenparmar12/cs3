/**
 * The one dialog shell: backdrop, heading, body, actions.
 *
 * Every dialog in the app used to draw its own — its own close button, its own
 * Escape listener (some on bubble, which let the player see the key too), its
 * own idea of where Cancel goes. This is the shape they share:
 *
 * - `role="dialog"`, `aria-modal`, labelled by its heading and described by
 *   its description, so a screen reader announces what is being asked.
 * - Escape cancels, consumed in the capture phase so nothing behind the
 *   dialog (the player, a menu) also acts on it.
 * - Focus moves into the dialog on open — to the safe action for a
 *   destructive one — and back to where it was on close; Tab stays inside.
 * - Actions sit at the bottom right, Cancel before the main action, via
 *   {@link DialogActions}.
 */
import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

interface DialogProps {
  title: React.ReactNode;
  /** One sentence under the title saying what happens. */
  description?: React.ReactNode;
  icon?: React.ReactNode;
  /** `danger` tints the heading icon; the actions carry their own variants. */
  tone?: 'default' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  onClose: () => void;
  children?: React.ReactNode;
  /** Usually a {@link DialogActions}. */
  footer?: React.ReactNode;
  /** Selector inside the dialog to focus on open; defaults to the first control. */
  initialFocus?: string;
  className?: string;
  /**
   * False while work the dialog started is running (an install, a batch
   * download): Escape, the backdrop and the close button then do nothing,
   * because a stray keypress must not abandon it half-way.
   */
  dismissable?: boolean;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export const Dialog: React.FC<DialogProps> = ({
  title,
  description,
  icon,
  tone = 'default',
  size = 'md',
  onClose,
  children,
  footer,
  initialFocus,
  className,
  dismissable = true,
}) => {
  const panel = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const close = useRef(onClose);
  close.current = onClose;
  const canDismiss = useRef(dismissable);
  canDismiss.current = dismissable;

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const root = panel.current;
    const target =
      (initialFocus ? root?.querySelector<HTMLElement>(initialFocus) : null) ??
      root?.querySelector<HTMLElement>(FOCUSABLE);
    target?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        event.preventDefault();
        if (canDismiss.current) close.current();
        return;
      }
      if (event.key !== 'Tab' || !root) return;
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      before?.focus?.();
    };
  }, [initialFocus]);

  return (
    <div className="modal-backdrop" onClick={() => dismissable && onClose()} role="presentation">
      <div
        ref={panel}
        className={`ui-dialog ui-dialog--${size}${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="ui-dialog__head">
          {icon ? <span className={`ui-dialog__icon ui-dialog__icon--${tone}`}>{icon}</span> : null}
          <div className="ui-dialog__titles">
            <h3 id={titleId}>{title}</h3>
            {description ? (
              <p id={descriptionId} className="ui-dialog__description">
                {description}
              </p>
            ) : null}
          </div>
          <button type="button" className="ui-dialog__close" onClick={onClose} aria-label="Close" disabled={!dismissable}>
            <X size={16} />
          </button>
        </header>
        {children ? <div className="ui-dialog__body">{children}</div> : null}
        {footer ? <footer className="ui-dialog__foot">{footer}</footer> : null}
      </div>
    </div>
  );
};

/**
 * A dialog's buttons, always in the same order: anything secondary on the
 * left, then Cancel, then the main action on the right.
 */
export const DialogActions: React.FC<{
  /** Optional extra content at the start of the row (a checkbox, a note). */
  start?: React.ReactNode;
  children: React.ReactNode;
}> = ({ start, children }) => (
  <div className="ui-dialog__actions">
    {start ? <div className="ui-dialog__actions-start">{start}</div> : null}
    <div className="ui-dialog__actions-end">{children}</div>
  </div>
);
