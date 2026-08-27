import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useFlash } from '../utils/useFlash';
import { Check, ChevronDown, ClipboardCopy, FileText } from 'lucide-react';

/**
 * Copies a failure in a form someone else can act on — at one of two sizes.
 *
 * The message alone is never enough. "Expected URL scheme 'http' or 'https'"
 * is a fact about a string, not about anything anyone can fix; what makes it
 * reproducible is which provider produced it, on which query, for which item,
 * at which address — plus the app and runtime versions, which the person
 * reporting is least likely to know and the person receiving asks for first.
 *
 * ## Why two buttons and not one
 *
 * There was one, and it always copied the whole session — up to three hundred
 * entries. That is the wrong default in both directions. Whoever receives it
 * has to find the failure being described somewhere inside it, and whoever
 * sends it has pasted an evening's viewing history into a chat window without
 * intending to. Most of the time the useful report is the failure on screen and
 * the handful of entries around it.
 *
 * So: the primary action copies **this failure**, and the full session moves
 * behind a second click. Both are deduplicated in the main process — a provider
 * failing in a loop becomes one entry with an occurrence count, which says
 * everything the repetition did and costs a line instead of a page.
 *
 * The report itself is assembled in the main process, which is the only side
 * that has the environment and the log. The on-screen context is passed down
 * rather than pasted on top, so the provider and message are not restated above
 * a body that already deduplicates them.
 */
export const CopyErrorButton: React.FC<{
  /** What the user was doing, in their terms. Also selects the log entries. */
  context: { query?: string; title?: string; url?: string; message?: string; source?: string };
  /** Narrows the attached log to specific records; omit to select by context. */
  recordIds?: string[];
  label?: string;
  compact?: boolean;
}> = ({ context, recordIds, label = 'Copy error details', compact = false }) => {
  const { message: copied, flash: setCopied } = useFlash<'current' | 'full'>(2500);
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onOutside = (event: PointerEvent) => {
      if (wrapper.current && !wrapper.current.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onOutside, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const copy = useCallback(
    async (mode: 'current' | 'full') => {
      setBusy(true);
      setMenuOpen(false);
      try {
        const response = await window.cloudstream?.reportDiagnostics?.({
          ids: recordIds,
          mode,
          context,
        });
        if (!response?.text) return;
        await navigator.clipboard.writeText(response.text);
        setCopied(mode);
      } catch {
        // Clipboard access can be refused; the diagnostics panel in Settings is
        // the way through when it is, so failing quietly here is acceptable.
      } finally {
        setBusy(false);
      }
    },
    [context, recordIds, setCopied]
  );

  return (
    <div className="copy-error-group" ref={wrapper}>
      <button
        type="button"
        className={`copy-error${compact ? ' copy-error--compact' : ''}`}
        onClick={() => void copy('current')}
        disabled={busy}
        title="Copies this failure only — the provider, item, address and error, plus app and runtime versions"
      >
        {copied ? <Check size={13} /> : <ClipboardCopy size={13} />}
        <span>{copied === 'current' ? 'Copied' : copied === 'full' ? 'Copied full' : label}</span>
      </button>

      <button
        type="button"
        className={`copy-error copy-error--more${compact ? ' copy-error--compact' : ''}`}
        onClick={() => setMenuOpen((open) => !open)}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label="Other report options"
        title="Other report options"
      >
        <ChevronDown size={12} />
      </button>

      {menuOpen && (
        <div className="copy-error__menu" role="menu">
          <button role="menuitem" onClick={() => void copy('current')}>
            <ClipboardCopy size={13} />
            <span>
              <strong>This failure</strong>
              <em>The error on screen and the entries around it.</em>
            </span>
          </button>
          <button role="menuitem" onClick={() => void copy('full')}>
            <FileText size={13} />
            <span>
              <strong>Full session report</strong>
              <em>Everything logged, deduplicated with occurrence counts.</em>
            </span>
          </button>
        </div>
      )}
    </div>
  );
};
