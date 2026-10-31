import React from 'react';
import { CheckSquare, MoreHorizontal, Power, PowerOff, Repeat, Trash2, X } from 'lucide-react';
import { Button } from '../ui/Button';
import { Menu } from '../ui/Menu';
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

  /**
   * Two states, each with only what it needs (2026-10-23).
   *
   * With nothing ticked the bar says how to start and offers one way to tick
   * everything. With something ticked it says how many and offers the actions
   * in plain verbs. Invert and "everything installed" were always on screen
   * beside six other controls and read as a wall of buttons; they are in More.
   */
  const more = [
    {
      label: 'Invert selection',
      description: 'Tick what is shown and unticked; untick the rest',
      icon: Repeat,
      onSelect: onInvert,
      disabled: matchingCount === 0,
    },
    ...(filtersActive
      ? [
          {
            label: `Select everything installed (${everythingCount})`,
            description: 'Including what the current search or filters hide',
            icon: CheckSquare,
            onSelect: onSelectEverything,
          },
        ]
      : []),
  ];

  return (
    <div className={`ext-bulk${selected > 0 ? ' ext-bulk--active' : ''}`} role="toolbar" aria-label="Selection">
      <span className="ext-bulk__count" aria-live="polite">
        {selected === 0 ? 'Tick extensions to turn them on, off or remove them together' : `${selected} selected`}
        {plan.hidden > 0 ? (
          <button type="button" className="ext-bulk__hidden" onClick={onClearHidden} title="Selected, but hidden by the current search or filters — never included in an action. Click to deselect them.">
            + {plan.hidden} hidden, not included ✕
          </button>
        ) : null}
      </span>

      <span className="ext-bulk__spacer" />

      {selected > 0 ? (
        <>
          <Button size="compact" icon={Power} onClick={() => onAction('enable')} disabled={enable === 0}
            title={enable === 0 ? 'Everything selected is already on' : `Turn on ${plural(enable, 'item')}`}>
            Turn on{enable ? ` ${enable}` : ''}
          </Button>
          <Button size="compact" icon={PowerOff} onClick={() => onAction('disable')} disabled={disable === 0}
            title={disable === 0 ? 'Everything selected is already off' : `Turn off ${plural(disable, 'item')}`}>
            Turn off{disable ? ` ${disable}` : ''}
          </Button>
          <Button size="compact" variant="destructive" icon={Trash2} onClick={() => onAction('uninstall')} disabled={uninstall === 0}
            title={
              uninstall === 0
                ? 'Providers are uninstalled with their extension — select an extension to uninstall it'
                : `Uninstall ${plural(uninstall, 'extension')}`
            }>
            Uninstall{uninstall ? ` ${uninstall}` : ''}
          </Button>
          <Button size="compact" variant="ambient" icon={X} onClick={onClear}>
            Clear
          </Button>
        </>
      ) : (
        <Button size="compact" variant="ambient" icon={CheckSquare} onClick={onSelectMatching} disabled={matchingCount === 0}
          title={filtersActive ? 'Select what the current search and filters show' : 'Select everything shown'}>
          {filtersActive ? `Select all shown (${matchingCount})` : `Select all (${matchingCount})`}
        </Button>
      )}
      {selected > 0 && matchingCount > selected ? (
        <Button size="compact" variant="ambient" onClick={onSelectMatching}>
          {filtersActive ? `All shown (${matchingCount})` : `All (${matchingCount})`}
        </Button>
      ) : null}
      <Menu
        label="More selection options"
        items={more}
        trigger={(props) => (
          <Button {...props} size="compact" variant="ambient" iconOnly icon={MoreHorizontal} aria-label="More selection options" title="More" />
        )}
      />
      {plan.busy.length > 0 ? (
        <span className="ext-bulk__busy" title={plan.busy.map((b) => `${b.name}: ${b.reason}`).join('\n')}>
          {plural(plan.busy.length, 'item')} busy — left out
        </span>
      ) : null}
    </div>
  );
};
