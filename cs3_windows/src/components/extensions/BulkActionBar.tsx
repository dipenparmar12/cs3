import React from 'react';
import { Loader2, X } from 'lucide-react';

/**
 * Actions for the current selection.
 *
 * One bar, driven by which tab is active, rather than the three near-identical
 * selection toolbars the old screen carried — each with its own "select all /
 * none" links and its own subtly different idea of what "all" meant.
 *
 * It only appears when something is selected. A permanently visible toolbar of
 * disabled buttons is noise on a screen that already had too much of it.
 */

export interface BulkAction {
  label: string;
  onRun: () => void;
  tone?: 'primary' | 'danger';
  /** Why this action cannot run right now, if it cannot. */
  disabledReason?: string;
}

interface Props {
  count: number;
  noun: string;
  actions: BulkAction[];
  busy: string | null;
  onClear: () => void;
  onSelectAll: () => void;
}

export const BulkActionBar: React.FC<Props> = ({
  count,
  noun,
  actions,
  busy,
  onClear,
  onSelectAll,
}) => {
  if (busy) {
    return (
      <div className="ext-bulk">
        <Loader2 size={15} className="spin" style={{ color: 'var(--accent-light)' }} />
        <span className="ext-bulk__count">{busy}</span>
      </div>
    );
  }

  if (count === 0) return null;

  return (
    <div className="ext-bulk">
      <span className="ext-bulk__count">
        {count} {noun}
        {count === 1 ? '' : 's'} selected
      </span>
      <button type="button" className="ext-btn" onClick={onSelectAll}>
        Select all visible
      </button>
      <span className="ext-bulk__spacer" />
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          className={`ext-btn${action.tone ? ` ext-btn--${action.tone}` : ''}`}
          disabled={!!action.disabledReason}
          title={action.disabledReason}
          onClick={action.onRun}
        >
          {action.label}
        </button>
      ))}
      <button type="button" className="ext-btn" onClick={onClear} title="Clear selection">
        <X size={12} />
      </button>
    </div>
  );
};
