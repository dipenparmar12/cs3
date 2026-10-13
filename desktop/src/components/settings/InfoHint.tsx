import React, { useCallback, useRef, useState } from 'react';
import { Info } from 'lucide-react';
import { useDismissable } from '../../utils/useDismissable';

/**
 * The explanation for one setting, out of the way until asked for.
 *
 * The settings screen used to print a paragraph of prose under every heading —
 * six of them, permanently, whether or not anyone was reading. That is a
 * screenful of text between the user and the two controls they came for, and it
 * makes a simple screen feel like documentation.
 *
 * The text is not deleted, because some of it is genuinely needed: what "secure
 * DNS" does, why a downloader engine has to be installed, what a backup import
 * will overwrite. It moves behind this, which opens on hover and on focus, so
 * it stays reachable by keyboard rather than being mouse-only.
 */
export const InfoHint: React.FC<{ children: React.ReactNode; label?: string }> = ({
  children,
  label = 'More information',
}) => {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLSpanElement | null>(null);

  const close = useCallback(() => setOpen(false), []);
  useDismissable(open, wrapper, close);

  return (
    <span
      className="hint"
      ref={wrapper}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className="hint__button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        <Info size={13} />
      </button>
      {open && (
        <span className="hint__bubble" role="tooltip">
          {children}
        </span>
      )}
    </span>
  );
};
