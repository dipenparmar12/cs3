import React, { useCallback, useEffect, useId, useRef, useState } from 'react';

/**
 * A control that opens on hover and commits on a single click.
 *
 * The player previously used native `<select>` elements for quality, speed,
 * subtitles and aspect ratio. Every change cost two clicks — one to open the
 * list, one to choose — which is a lot of friction for settings people adjust
 * mid-scene.
 *
 * Hovering the trigger opens the list, so the click that follows is the only
 * one needed. Two details keep that from becoming annoying:
 *
 * - **A close delay.** Cursors cut corners when travelling from the trigger to
 *   the list. Closing the instant the pointer leaves would make the menu snap
 *   shut mid-approach, so a short grace period covers the gap.
 * - **Keyboard and touch still work.** Hover is an accelerator, not the only
 *   way in: the trigger is a real button that toggles on click and responds to
 *   Enter, Escape and arrow keys, so pointer-less use is unaffected.
 */

export interface HoverMenuOption<T> {
  value: T;
  label: string;
  /** Secondary text, e.g. a bitrate under a resolution. */
  detail?: string;
}

interface HoverMenuProps<T> {
  icon?: React.ReactNode;
  label: string;
  value: T;
  options: Array<HoverMenuOption<T>>;
  onChange: (value: T) => void;
  /** Text on the trigger; falls back to the active option's label. */
  triggerText?: string;
  align?: 'left' | 'right';
}

const CLOSE_DELAY_MS = 220;

export function HoverMenu<T extends string | number>({
  icon,
  label,
  value,
  options,
  onChange,
  triggerText,
  align = 'right',
}: HoverMenuProps<T>) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  }, [cancelClose]);

  useEffect(() => cancelClose, [cancelClose]);

  // A menu left open while the pointer is elsewhere would sit on top of the
  // video; closing on outside interaction keeps it out of the way.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const activeIndex = options.findIndex((o) => o.value === value);
  const activeLabel = triggerText ?? options[activeIndex]?.label ?? label;

  const commit = useCallback(
    (next: T) => {
      onChange(next);
      setOpen(false);
    },
    [onChange]
  );

  const onTriggerKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        // With the menu closed, arrows step through values directly — no need
        // to open a list to nudge speed or quality by one.
        const step = e.key === 'ArrowDown' ? 1 : -1;
        const next = options[Math.min(options.length - 1, Math.max(0, activeIndex + step))];
        if (next) onChange(next.value);
      }
    },
    [activeIndex, options, onChange]
  );

  return (
    <div
      ref={rootRef}
      className="hover-menu"
      onMouseEnter={() => {
        cancelClose();
        setOpen(true);
      }}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        className="hover-menu__trigger icon-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={label}
        title={label}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKey}
      >
        {icon}
        <span className="hover-menu__value">{activeLabel}</span>
      </button>

      {open && (
        <ul
          id={menuId}
          role="listbox"
          aria-label={label}
          className={`hover-menu__list hover-menu__list--${align}`}
        >
          <li className="hover-menu__heading" aria-hidden="true">
            {label}
          </li>
          {options.map((option) => (
            <li key={String(option.value)}>
              <button
                type="button"
                role="option"
                aria-selected={option.value === value}
                className={`hover-menu__option${
                  option.value === value ? ' hover-menu__option--active' : ''
                }`}
                onClick={() => commit(option.value)}
              >
                <span>{option.label}</span>
                {option.detail && <span className="hover-menu__detail">{option.detail}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
