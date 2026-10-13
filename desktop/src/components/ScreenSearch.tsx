/**
 * The small "find on this screen" control — Library, History and the like.
 *
 * Deliberately unlike the navbar's media search: an icon until it is wanted,
 * a short translucent field when it is, and worded "Find in …" rather than
 * "Search". It filters what the screen already shows and never fetches, so it
 * must not look like a second way to find films. Ctrl+F opens it while it is
 * mounted (App routes the shortcut here via `screenSearchAvailable`); Escape
 * clears it, then closes it.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { SearchInput } from './ui/Field';
import { SCREEN_SEARCH_FOCUS_EVENT, claimScreenSearch } from '../utils/screenSearch';

interface ScreenSearchProps {
  /** What is being searched, as the viewer calls it: "library", "history". */
  label: string;
  value: string;
  onChange: (query: string) => void;
  /**
   * How many rows the query leaves, shown inside the field while one is typed.
   * Omitted while the answer is not known yet (History asks its store).
   */
  matches?: number;
  /** Extra words for the tooltip: what the field looks at. */
  hint?: string;
}

export const ScreenSearch: React.FC<ScreenSearchProps> = ({ label, value, onChange, matches, hint }) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [focused, setFocused] = useState(false);
  const open = focused || value !== '';

  useEffect(() => claimScreenSearch(), []);

  const focus = useCallback(() => {
    setFocused(true);
    // The input is rendered only once open, so focus after that paint.
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, []);

  useEffect(() => {
    window.addEventListener(SCREEN_SEARCH_FOCUS_EVENT, focus);
    return () => window.removeEventListener(SCREEN_SEARCH_FOCUS_EVENT, focus);
  }, [focus]);

  const tooltip = `Find in ${label} (Ctrl+F) — only what is on this screen${hint ? `: ${hint}` : ''}. Nothing is fetched.`;

  if (!open) {
    return (
      <button
        type="button"
        className="screen-search screen-search--closed"
        onClick={focus}
        title={tooltip}
        aria-label={`Find in ${label}`}
      >
        <Search size={15} />
      </button>
    );
  }

  // The shared search field, in its ambient variant: same keys (Escape clears,
  // then closes), same clear button and labelling as every other search.
  return (
    <SearchInput
      ref={inputRef}
      className="screen-search screen-search--open"
      variant="ambient"
      label={`Find in ${label}`}
      placeholder={`Find in ${label}…`}
      title={tooltip}
      value={value}
      onChange={onChange}
      meta={matches === undefined ? undefined : matches === 0 ? 'No matches' : `${matches} found`}
      metaTone={matches === 0 ? 'warn' : 'default'}
      shortcut="Ctrl F"
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    />
  );
};

/**
 * What a find on this screen left: nothing here, and where else it matched.
 *
 * Without the second half a match in another bucket looks like no match at
 * all — the viewer typed a title they know is in their library and was told
 * it is not.
 */
export const ScreenSearchNoMatches: React.FC<{
  query: string;
  where: string;
  onClear: () => void;
  elsewhere?: Array<{ label: string; onClick: () => void }>;
}> = ({ query, where, onClear, elsewhere = [] }) => (
  <div className="screen-search-note" role="status">
    <span>
      Nothing in <strong>{where}</strong> matches “{query}”.
    </span>
    {elsewhere.length > 0 && (
      <>
        <span>Found in</span>
        {elsewhere.map((place, index) => (
          <React.Fragment key={place.label}>
            {index > 0 && <span aria-hidden>·</span>}
            <button type="button" className="screen-search-note__action" onClick={place.onClick}>
              {place.label}
            </button>
          </React.Fragment>
        ))}
      </>
    )}
    <span aria-hidden>·</span>
    <button type="button" className="screen-search-note__action" onClick={onClear}>
      Clear
    </button>
  </div>
);
