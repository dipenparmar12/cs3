import React, { useEffect, useRef, useState } from 'react';
import { CheckCheck, FlipVertical2, Square, Trash2, X } from 'lucide-react';
import { Button } from './Button';

/**
 * The one bulk-selection bar, for Library, History and Downloads (PRD §116).
 *
 * Shown only while a screen is in selection mode, so the default screen keeps
 * no permanent clutter; entered from each screen's own quiet "Select" action.
 * Every screen gets the same controls in the same order — count, All, Invert,
 * None, the screen's own actions, Remove, Done — because three slightly
 * different versions of one tool is three things to learn.
 *
 * Remove confirms in place: the first press turns the button into "Remove 5?"
 * for a few seconds, the second does it. A modal for every history clean-up
 * is heavier than the action deserves; a screen whose removal can destroy
 * files (Downloads) passes `confirmRemove={false}` and keeps its own dialog.
 */
export const SelectionToolbar: React.FC<{
  count: number;
  total: number;
  /** Singular and plural, for "3 of 12 titles selected". */
  noun: [string, string];
  onSelectAll: () => void;
  onInvert: () => void;
  onSelectNone: () => void;
  onDone: () => void;
  /** Absent when the screen offers no removal. */
  onRemove?: () => void | Promise<void>;
  removeLabel?: string;
  confirmRemove?: boolean;
  /** What the last bulk action did, or why it could not. */
  status?: string | null;
  children?: React.ReactNode;
}> = ({
  count,
  total,
  noun,
  onSelectAll,
  onInvert,
  onSelectNone,
  onDone,
  onRemove,
  removeLabel = 'Remove',
  confirmRemove = true,
  status,
  children,
}) => {
  const [arming, setArming] = useState(false);
  const [busy, setBusy] = useState(false);
  const disarm = useRef<number | null>(null);

  useEffect(() => () => {
    if (disarm.current) window.clearTimeout(disarm.current);
  }, []);
  // A changed selection is a different question; the armed button must not answer it.
  useEffect(() => setArming(false), [count]);

  const remove = async () => {
    if (!onRemove || count === 0 || busy) return;
    if (confirmRemove && !arming) {
      setArming(true);
      if (disarm.current) window.clearTimeout(disarm.current);
      disarm.current = window.setTimeout(() => setArming(false), 4000);
      return;
    }
    setArming(false);
    setBusy(true);
    try {
      await onRemove();
    } finally {
      setBusy(false);
    }
  };

  const word = total === 1 ? noun[0] : noun[1];
  return (
    <div className="ui-selection-bar" role="toolbar" aria-label="Selection">
      <span className="ui-selection-bar__count" aria-live="polite">
        {count} of {total} {word} selected
      </span>
      <div className="ui-selection-bar__scope">
        <Button size="compact" variant="ambient" icon={CheckCheck} onClick={onSelectAll} disabled={count === total}>
          All
        </Button>
        <Button size="compact" variant="ambient" icon={FlipVertical2} onClick={onInvert} disabled={total === 0}>
          Invert
        </Button>
        <Button size="compact" variant="ambient" icon={Square} onClick={onSelectNone} disabled={count === 0}>
          None
        </Button>
      </div>
      <div className="ui-selection-bar__actions">
        {children}
        {onRemove && (
          <Button
            size="compact"
            variant="destructive"
            icon={Trash2}
            onClick={() => void remove()}
            disabled={count === 0}
            loading={busy}
          >
            {arming ? `${removeLabel} ${count}? Press again` : `${removeLabel}${count > 0 ? ` ${count}` : ''}`}
          </Button>
        )}
        <Button size="compact" variant="ambient" icon={X} onClick={onDone}>
          Done
        </Button>
      </div>
      {status && (
        <span className="ui-selection-bar__status" role="status">
          {status}
        </span>
      )}
    </div>
  );
};
