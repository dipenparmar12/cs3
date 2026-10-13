import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { useDismissable } from '../utils/useDismissable';

/**
 * One filter, as a single button.
 *
 * Filter controls in this app live in two places with very different budgets:
 * the source picker on the detail page, and the source panel embedded in the
 * player's sidebar, which is a narrow column over video. A row of labelled
 * `<select>`s fits neither — it wrapped to three lines in the sidebar and pushed
 * the actual sources below the fold, which is the opposite of what a filter is
 * for.
 *
 * So each facet collapses to one chip that states its current value and nothing
 * else. The detail — every option, and how many results each would leave — is
 * one click away rather than permanently on screen. Options that would match
 * nothing are not offered at all, which is what keeps a list of forty providers
 * from becoming a list of forty ways to get an empty result.
 *
 * It is the design system's one dropdown (docs/agents/design-system.md): the
 * same trigger, popup, option rows, checkmarks, search-within-options, clear
 * and keyboard behaviour wherever a filter or selector appears. Keyboard:
 * ArrowDown opens and moves into the list; Up/Down/Home/End move; Enter or
 * Space chooses; Escape closes and returns focus to the trigger. `multiple`
 * keeps the list open and toggles values; "All" clears them.
 */

export interface FacetOption {
  value: string;
  label: string;
  /** How many rows this option would leave. Hidden when undefined. */
  count?: number;
}

interface CommonProps {
  /** Short noun for the dimension, shown when nothing is selected. */
  label: string;
  options: FacetOption[];
  /** The "no filter" option, always offered first. */
  allValue?: string;
  allLabel?: string;
  icon?: React.ReactNode;
  /** Adds a filter box inside the menu. Defaults on past ten options. */
  searchable?: boolean;
  title?: string;
  /** Shown instead of the list while options are being fetched. */
  loading?: boolean;
  /** Said when there are no options at all. */
  emptyLabel?: string;
}

type FacetMenuProps =
  | (CommonProps & { multiple?: false; value: string; onChange: (value: string) => void })
  | (CommonProps & { multiple: true; value: string[]; onChange: (value: string[]) => void });

export const FacetMenu: React.FC<FacetMenuProps> = (props) => {
  const { label, options, allValue = 'all', allLabel, icon, searchable, title, loading, emptyLabel } = props;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapper = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const list = useRef<HTMLDivElement | null>(null);

  const selected = useMemo(
    () => new Set(props.multiple ? props.value : props.value === allValue ? [] : [props.value]),
    [props.multiple, props.value, allValue]
  );
  const active = selected.size > 0;
  const withSearch = searchable ?? options.length > 10;

  const close = useCallback((refocus = false) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  }, []);
  const dismiss = useCallback(() => close(false), [close]);
  useDismissable(open, wrapper, dismiss);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) => option.label.toLowerCase().includes(needle));
  }, [options, query]);

  const optionButtons = () => [...(list.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])];
  const focusOption = (index: number) => {
    const items = optionButtons();
    if (items.length === 0) return;
    items[(index + items.length) % items.length].focus();
  };

  const choose = (value: string | null) => {
    if (props.multiple) {
      if (value === null) props.onChange([]);
      else props.onChange(selected.has(value) ? props.value.filter((v) => v !== value) : [...props.value, value]);
      return;
    }
    props.onChange(value ?? allValue);
    close(true);
  };

  const triggerText = (() => {
    if (!active) return label;
    if (props.multiple) {
      const first = options.find((option) => option.value === props.value[0]);
      return props.value.length === 1 ? (first?.label ?? props.value[0]) : `${label} · ${props.value.length}`;
    }
    return options.find((option) => option.value === props.value)?.label ?? props.value;
  })();

  const onListKey = (event: React.KeyboardEvent) => {
    const items = optionButtons();
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusOption(index + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (index <= 0 && withSearch) list.current?.querySelector<HTMLInputElement>('input')?.focus();
      else focusOption(index - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusOption(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusOption(items.length - 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'Tab') {
      close(false);
    }
  };

  const row = (value: string | null, text: string, count?: number) => {
    const on = value === null ? !active : selected.has(value);
    return (
      <button
        key={value ?? '__all'}
        type="button"
        role="option"
        aria-selected={on}
        tabIndex={-1}
        className={`facet__option${on ? ' facet__option--on' : ''}`}
        onClick={() => choose(value)}
      >
        <span className="facet__tick">{on && <Check size={11} strokeWidth={3} />}</span>
        <span className="facet__label">{text}</span>
        {count !== undefined && <span className="facet__count">{count}</span>}
      </button>
    );
  };

  return (
    <div className="facet" ref={wrapper}>
      <button
        ref={trigger}
        type="button"
        className={`facet__trigger${active ? ' facet__trigger--active' : ''}`}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
            requestAnimationFrame(() =>
              withSearch ? list.current?.querySelector<HTMLInputElement>('input')?.focus() : focusOption(0)
            );
          } else if (event.key === 'Escape' && open) {
            event.stopPropagation();
            close(true);
          }
        }}
        aria-expanded={open}
        aria-haspopup="listbox"
        title={title ?? label}
      >
        {icon}
        <span className="facet__value">{triggerText}</span>
        {active ? (
          // Clearing is the most likely next action once a facet is set, so it
          // is on the chip rather than inside the menu it would have to reopen.
          <span
            className="facet__clear"
            role="button"
            tabIndex={-1}
            aria-label={`Clear ${label} filter`}
            onClick={(event) => {
              event.stopPropagation();
              if (props.multiple) props.onChange([]);
              else props.onChange(allValue);
            }}
          >
            <X size={11} />
          </span>
        ) : (
          <ChevronDown size={12} />
        )}
      </button>

      {open && (
        <div
          className="facet__menu"
          role="listbox"
          aria-label={label}
          aria-multiselectable={props.multiple || undefined}
          ref={list}
          onKeyDown={onListKey}
        >
          {withSearch && (
            <div className="facet__search">
              <Search size={12} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    event.stopPropagation();
                    focusOption(0);
                  }
                }}
                placeholder={`Find ${label.toLowerCase()}…`}
                aria-label={`Find ${label}`}
                autoFocus
              />
            </div>
          )}

          {loading ? (
            <p className="facet__empty">Loading…</p>
          ) : options.length === 0 ? (
            <p className="facet__empty">{emptyLabel ?? 'Nothing to choose from yet.'}</p>
          ) : (
            <>
              {row(null, allLabel ?? `All ${label.toLowerCase()}`)}
              {shown.map((option) => row(option.value, option.label, option.count))}
              {shown.length === 0 && <p className="facet__empty">Nothing matches.</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
};
