/**
 * Choices: checkbox, radio group, switch — one look, real semantics.
 *
 * - `Checkbox` is a native checkbox (keyboard and form behaviour for free)
 *   with its label and an optional description in one click target.
 * - `RadioGroup` is a `fieldset` of native radios with a `legend`.
 * - `Switch` is for an immediate on/off setting: a button with
 *   `role="switch"` and `aria-checked`, the state also said in words.
 *   It replaces the old `settings__switch` (a checkbox dressed as a switch)
 *   and draws the extensions screen's `Toggle`.
 */
import React, { useId } from 'react';

export const Checkbox: React.FC<{
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: React.ReactNode;
  description?: React.ReactNode;
  disabled?: boolean;
  /** For a parent of a partly selected group. */
  indeterminate?: boolean;
  title?: string;
  className?: string;
}> = ({ checked, onChange, label, description, disabled, indeterminate, title, className }) => {
  const ref = React.useRef<HTMLInputElement | null>(null);
  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = Boolean(indeterminate);
  }, [indeterminate]);
  return (
    <label className={`ui-check${disabled ? ' ui-check--disabled' : ''}${className ? ` ${className}` : ''}`} title={title}>
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-checked={indeterminate ? 'mixed' : checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="ui-check__text">
        <span>{label}</span>
        {description ? <span className="ui-check__description">{description}</span> : null}
      </span>
    </label>
  );
};

export function RadioGroup<T extends string>({
  legend,
  value,
  options,
  onChange,
  inline,
  disabled,
}: {
  legend: React.ReactNode;
  value: T;
  options: Array<{ value: T; label: React.ReactNode; description?: React.ReactNode }>;
  onChange: (value: T) => void;
  inline?: boolean;
  disabled?: boolean;
}): React.ReactElement {
  const name = useId();
  return (
    <fieldset className={`ui-radio-group${inline ? ' ui-radio-group--inline' : ''}`} disabled={disabled}>
      <legend>{legend}</legend>
      {options.map((option) => (
        <label key={option.value} className={`ui-check${disabled ? ' ui-check--disabled' : ''}`}>
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
          />
          <span className="ui-check__text">
            <span>{option.label}</span>
            {option.description ? <span className="ui-check__description">{option.description}</span> : null}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export const Switch: React.FC<{
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Accessible name — what is being switched. */
  label: string;
  /** Words beside the switch; defaults to On/Off. Pass `null` for none. */
  stateLabel?: React.ReactNode | null;
  disabled?: boolean;
  /** On, but without effect (an ancestor is off): drawn dimmer, still its own state. */
  muted?: boolean;
  title?: string;
}> = ({ checked, onChange, label, stateLabel, disabled, muted, title }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    title={title ?? label}
    className={`ui-switch${muted ? ' ui-switch--muted' : ''}`}
    onClick={(event) => {
      event.stopPropagation();
      onChange(!checked);
    }}
  >
    <span className="ui-switch__track" aria-hidden>
      <span className="ui-switch__thumb" />
    </span>
    {stateLabel === null ? null : <span>{stateLabel ?? (checked ? 'On' : 'Off')}</span>}
  </button>
);
