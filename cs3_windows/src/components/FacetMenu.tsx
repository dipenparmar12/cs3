import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';

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
 */

export interface FacetOption {
  value: string;
  label: string;
  /** How many rows this option would leave. Hidden when undefined. */
  count?: number;
}

interface FacetMenuProps {
  /** Short noun for the dimension, shown when nothing is selected. */
  label: string;
  value: string;
  options: FacetOption[];
  onChange: (value: string) => void;
  /** The "no filter" option, always offered first. */
  allValue?: string;
  allLabel?: string;
  icon?: React.ReactNode;
  /** Adds a filter box inside the menu. Defaults on past ten options. */
  searchable?: boolean;
  title?: string;
}

export const FacetMenu: React.FC<FacetMenuProps> = ({
  label,
  value,
  options,
  onChange,
  allValue = 'all',
  allLabel,
  icon,
  searchable,
  title,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapper = useRef<HTMLDivElement | null>(null);

  const active = value !== allValue;
  const withSearch = searchable ?? options.length > 10;

  useEffect(() => {
    if (!open) return;
    const onOutside = (event: PointerEvent) => {
      if (wrapper.current && !wrapper.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onOutside, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) => option.label.toLowerCase().includes(needle));
  }, [options, query]);

  const current = options.find((option) => option.value === value);

  return (
    <div className="facet" ref={wrapper}>
      <button
        type="button"
        className={`facet__trigger${active ? ' facet__trigger--active' : ''}`}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="listbox"
        title={title ?? label}
      >
        {icon}
        <span className="facet__value">{active ? (current?.label ?? value) : label}</span>
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
              onChange(allValue);
            }}
          >
            <X size={11} />
          </span>
        ) : (
          <ChevronDown size={12} />
        )}
      </button>

      {open && (
        <div className="facet__menu" role="listbox">
          {withSearch && (
            <div className="facet__search">
              <Search size={12} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={`Find ${label.toLowerCase()}…`}
                aria-label={`Find ${label}`}
                autoFocus
              />
            </div>
          )}

          <button
            type="button"
            className={`facet__option${!active ? ' facet__option--on' : ''}`}
            onClick={() => {
              onChange(allValue);
              setOpen(false);
            }}
          >
            <span className="facet__tick">{!active && <Check size={11} strokeWidth={3} />}</span>
            <span className="facet__label">{allLabel ?? `All ${label.toLowerCase()}`}</span>
          </button>

          {shown.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`facet__option${option.value === value ? ' facet__option--on' : ''}`}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <span className="facet__tick">
                {option.value === value && <Check size={11} strokeWidth={3} />}
              </span>
              <span className="facet__label">{option.label}</span>
              {option.count !== undefined && <span className="facet__count">{option.count}</span>}
            </button>
          ))}

          {shown.length === 0 && <p className="facet__empty">Nothing matches.</p>}
        </div>
      )}
    </div>
  );
};
