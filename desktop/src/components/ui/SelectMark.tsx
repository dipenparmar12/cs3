import React from 'react';
import { Check, Minus } from 'lucide-react';
import type { GroupState } from '../../utils/listSelection';

/**
 * The per-item mark shown in selection mode: a real `role="checkbox"` with a
 * name, reachable by Tab and toggled by Space/Enter, and a tick or dash rather
 * than a colour alone.
 *
 * Its click is stopped so it never also opens the card it sits on.
 */
export const SelectMark: React.FC<{
  state: GroupState | boolean;
  onToggle: () => void;
  label: string;
  overlay?: boolean;
}> = ({ state, onToggle, label, overlay = false }) => {
  const value = state === true || state === 'all' ? 'true' : state === 'some' ? 'mixed' : 'false';
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={value}
      aria-label={label}
      className={`ui-select-mark${overlay ? ' ui-select-mark--overlay' : ''}`}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      {value === 'true' ? <Check size={14} aria-hidden /> : value === 'mixed' ? <Minus size={14} aria-hidden /> : null}
    </button>
  );
};
