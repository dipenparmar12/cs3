import React from 'react';
import { CheckSquare, Power, PowerOff, Repeat, Square, Trash2, X } from 'lucide-react';
import { Button } from '../ui/Button';
import { changeCount, type BulkPlan } from './bulkSelection';
import type { BulkVerb } from './BulkConfirmDialog';

/**
 * Selection and the actions on it, above the Installed tree.
 *
 * Always on screen, so selecting is discoverable without a "manage" mode, and
 * worded so nobody has to guess what a select-all reaches: **matching** is
 * what the search and filters show; **everything installed** ignores them and
 * says so. Each action carries the number it would change, and is disabled
 * with the reason when that number is zero — a button that would do nothing
 * says why rather than doing nothing.
 */
interface Props {
  plan: BulkPlan;
  /** How many keys "Select all matching" would select. */
  matchingCount: number;
  /** Every installed extension; offered only while filters narrow the view. */
  everythingCount: number;
  filtersActive: boolean;
  onSelectMatching(): void;
  onSelectEverything(): void;
  onInvert(): void;
  onClear(): void;
  onClearHidden(): void;
  onAction(verb: BulkVerb): void;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export const BulkActionBar: React.FC<Props> = ({
  plan,
  matchingCount,
  everythingCount,
  filtersActive,
  onSelectMatching,
  onSelectEverything,
  onInvert,
  onClear,
  onClearHidden,
  onAction,
}) => {
  const selected = plan.count;
  const enable = changeCount(plan.enable);
  const disable = changeCount(plan.disable);
  const uninstall = plan.uninstall.length;

  return (
    <div className={`ext-bulk${selected > 0 ? ' ext-bulk--active' : ''}`} role="toolbar" aria-label="Selection">
      <span className="ext-bulk__count" aria-live="polite">
        {selected === 0 ? 'Nothing selected' : `${selected} selected`}
        {plan.hidden > 0 ? (
          <button type="button" className="ext-bulk__hidden" onClick={onClearHidden} title="Selected, but hidden by the current search or filters — never included in an action. Click to deselect them.">
            + {plan.hidden} hidden, not included ✕
          </button>
        ) : null}
      </span>

      <Button size="compact" variant="ambient" icon={CheckSquare} onClick={onSelectMatching} disabled={matchingCount === 0}
        title={filtersActive ? 'Select what the current search and filters show' : 'Select everything shown'}>
        {filtersActive ? `Select all matching (${matchingCount})` : `Select all (${matchingCount})`}
      </Button>
      {filtersActive ? (
        <Button size="compact" variant="ambient" onClick={onSelectEverything}
          title="Every installed extension, including ones the filters hide">
          Everything installed ({everythingCount})
        </Button>
      ) : null}
      <Button size="compact" variant="ambient" icon={Repeat} onClick={onInvert} disabled={matchingCount === 0}
        title="Select what is shown and unselected; deselect the rest of what is shown">
        Invert
      </Button>
      <Button size="compact" variant="ambient" icon={Square} onClick={onClear} disabled={selected === 0 && plan.hidden === 0}>
        None
      </Button>

      <span className="ext-bulk__spacer" />

      {selected > 0 ? (
        <>
          <Button size="compact" icon={Power} onClick={() => onAction('enable')} disabled={enable === 0}
            title={enable === 0 ? 'Everything selected is already enabled' : `Enable ${plural(enable, 'item')}`}>
            Enable{enable ? ` ${enable}` : ''}
          </Button>
          <Button size="compact" icon={PowerOff} onClick={() => onAction('disable')} disabled={disable === 0}
            title={disable === 0 ? 'Everything selected is already disabled' : `Disable ${plural(disable, 'item')}`}>
            Disable{disable ? ` ${disable}` : ''}
          </Button>
          <Button size="compact" variant="destructive" icon={Trash2} onClick={() => onAction('uninstall')} disabled={uninstall === 0}
            title={
              uninstall === 0
                ? 'Providers are uninstalled with their extension — select an extension to uninstall it'
                : `Uninstall ${plural(uninstall, 'extension')}`
            }>
            Uninstall{uninstall ? ` ${uninstall}` : ''}
          </Button>
          <Button size="compact" variant="ambient" iconOnly icon={X} aria-label="Clear selection" title="Clear selection" onClick={onClear} />
        </>
      ) : null}
      {plan.busy.length > 0 ? (
        <span className="ext-bulk__busy" title={plan.busy.map((b) => `${b.name}: ${b.reason}`).join('\n')}>
          {plural(plan.busy.length, 'item')} busy — left out
        </span>
      ) : null}
    </div>
  );
};
