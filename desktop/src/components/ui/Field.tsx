/**
 * Form fields: one structure for every label, control, helper and error.
 *
 * `FormField` wires the accessibility up so call sites cannot forget it: the
 * label's `htmlFor`, the control's `aria-describedby` (helper and error) and
 * `aria-invalid`, and the required marker, all from one id. The control is a
 * render function receiving those props, so it works with `Input`, `Select`
 * or anything else that accepts them.
 */
import React, { useId } from 'react';
import { AlertCircle, Search, X } from 'lucide-react';

export interface FieldControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
  'aria-required'?: true;
  required?: boolean;
}

export const FormField: React.FC<{
  label: React.ReactNode;
  /** Shown under the control; replaced by `error` when there is one. */
  helper?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  /** Marks the field "(optional)" — for forms where most fields are required. */
  optional?: boolean;
  children: (control: FieldControlProps) => React.ReactNode;
  className?: string;
}> = ({ label, helper, error, required, optional, children, className }) => {
  const id = useId();
  const helperId = `${id}-helper`;
  const errorId = `${id}-error`;
  const describedBy = [error ? errorId : helper ? helperId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`ui-field${className ? ` ${className}` : ''}`}>
      <label className="ui-field__label" htmlFor={id}>
        {label}
        {required ? <span className="ui-field__required" aria-hidden>*</span> : null}
        {optional ? <span className="ui-field__optional">(optional)</span> : null}
      </label>
      {children({
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
        'aria-required': required ? true : undefined,
        required,
      })}
      {error ? (
        <p id={errorId} className="ui-field__error" role="alert">
          <AlertCircle size={12} aria-hidden /> {error}
        </p>
      ) : helper ? (
        <p id={helperId} className="ui-field__helper">
          {helper}
        </p>
      ) : null}
    </div>
  );
};

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & { size?: 'default' | 'compact' };

/** A text-like input on the shared field tokens (`.ui-input`). */
export const Input = React.forwardRef<HTMLInputElement, Omit<InputProps, 'size'> & { size?: 'default' | 'compact' }>(
  function Input({ size = 'default', className, type = 'text', ...rest }, ref) {
    return (
      <input
        ref={ref}
        type={type}
        className={`ui-input${size === 'compact' ? ' ui-input--compact' : ''}${className ? ` ${className}` : ''}`}
        {...rest}
      />
    );
  }
);

type SelectProps = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> & {
  size?: 'default' | 'compact';
  options?: Array<{ value: string; label: string; disabled?: boolean }>;
};

/**
 * A native select on the shared tokens. Native on purpose: keyboard, type-to-
 * find and screen-reader behaviour come with it. For a filter with counts,
 * search inside the list or several values, use `FacetMenu`.
 */
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { size = 'default', className, options, children, ...rest },
  ref
) {
  return (
    <select
      ref={ref}
      className={`ui-select${size === 'compact' ? ' ui-select--compact' : ''}${className ? ` ${className}` : ''}`}
      {...rest}
    >
      {options
        ? options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))
        : children}
    </select>
  );
});

export type SearchVariant = 'default' | 'compact' | 'ambient';

/**
 * A search field: icon, input, live count, clear. One behaviour everywhere —
 * Escape clears, then blurs (consumed only when it did something); the clear
 * button keeps focus in the field; `type="search"` and a label for assistive tech.
 *
 * Variants change emphasis only. `ambient` is the quiet pill that filters the
 * screen it sits on (Library, History), distinct from the navbar's media search.
 */
export const SearchInput = React.forwardRef<
  HTMLInputElement,
  {
    value: string;
    onChange: (value: string) => void;
    /** Accessible name; also the placeholder when none is given. */
    label: string;
    placeholder?: string;
    variant?: SearchVariant;
    /** Small text inside the field — a count, "No matches". */
    meta?: React.ReactNode;
    metaTone?: 'default' | 'warn';
    /** Shown when empty, e.g. "Ctrl F". */
    shortcut?: string;
    autoFocus?: boolean;
    className?: string;
    title?: string;
    onFocus?: () => void;
    onBlur?: () => void;
    onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  }
>(function SearchInput(
  { value, onChange, label, placeholder, variant = 'default', meta, metaTone = 'default', shortcut, autoFocus, className, title, onFocus, onBlur, onKeyDown },
  ref
) {
  const local = React.useRef<HTMLInputElement | null>(null);
  const setRef = (node: HTMLInputElement | null) => {
    local.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  };
  return (
    <div className={`ui-search${variant === 'default' ? '' : ` ui-search--${variant}`}${className ? ` ${className}` : ''}`} role="search" title={title}>
      <Search size={variant === 'default' ? 15 : 14} className="ui-search__icon" aria-hidden />
      <input
        ref={setRef}
        type="search"
        className="ui-search__input"
        value={value}
        placeholder={placeholder ?? label}
        aria-label={label}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented || event.key !== 'Escape') return;
          event.stopPropagation();
          if (value) onChange('');
          else local.current?.blur();
        }}
      />
      {value && meta !== undefined && meta !== null ? (
        <span className={`ui-search__meta${metaTone === 'warn' ? ' ui-search__meta--warn' : ''}`}>{meta}</span>
      ) : null}
      {!value && shortcut ? <kbd className="ui-search__kbd">{shortcut}</kbd> : null}
      {value ? (
        <button
          type="button"
          className="ui-search__clear"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            onChange('');
            local.current?.focus();
          }}
          aria-label="Clear search"
          title="Clear (Esc)"
        >
          <X size={13} />
        </button>
      ) : null}
    </div>
  );
});
