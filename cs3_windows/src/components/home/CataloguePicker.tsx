import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, Layers, Loader2 } from 'lucide-react';

/**
 * Which catalogue the home screen is built from, changed from the home screen.
 *
 * The control existed and lived in Settings → Home. Everything about that is
 * defensible except where it is: the person who wants to change what the front
 * page shows is *looking at the front page*, and asking them to leave it,
 * find a tab, change a dropdown and come back is three navigations to answer a
 * question they are already staring at.
 *
 * PRD 43 files this as F-8, "a setting in the wrong room", and it is the
 * cheapest of the eight to close because nothing new is needed underneath —
 * `home:listProviders` and `home:selectProvider` have been there all along.
 *
 * ## It is moved, not duplicated
 *
 * Settings keeps the *configuration* that has no place on a home screen: the
 * TMDB key, the custom addon URL, the health re-check. What moves here is the
 * one question a browsing viewer actually asks — "where are these rows coming
 * from, and can I have different ones?" Two controls that both write
 * `home:selectProvider` would be two things to keep in step; this reads the
 * same state and shows the same list, so they cannot disagree.
 *
 * ## An unavailable catalogue stays listed
 *
 * `HomeProviderRegistry` reports health per provider and refuses to select one
 * that is not answering. That refusal is worth showing rather than hiding: a
 * service missing from the menu reads as "this app does not support it", and a
 * service listed with "not answering" reads as what it is. Same argument the
 * OTT platform table makes for keeping Sony LIV in the list.
 */

/** Mirrors `HomeProviderSummary`, which `home:listProviders` returns. */
interface ProviderSummary {
  id: string;
  name: string;
  description: string;
  requiresKey: boolean;
  selectable: boolean;
  active: boolean;
  health: {
    status: 'healthy' | 'degraded' | 'unavailable' | 'unchecked';
    reason?: string;
    needsKey?: boolean;
  } | null;
}

export const CataloguePicker: React.FC<{
  /** Re-runs discovery once the catalogue has actually changed. */
  onChanged: () => void;
  /** Whether anime rows are mixed in, which is a per-view toggle not a service. */
  includeAnime: boolean;
  onIncludeAnimeChange: (next: boolean) => void;
}> = ({ onChanged, includeAnime, onIncludeAnimeChange }) => {
  const [open, setOpen] = useState(false);
  const [providers, setProviders] = useState<ProviderSummary[] | null>(null);
  const [selected, setSelected] = useState<string>('');
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  /*
   * Loaded on mount rather than on open, so the button can show the current
   * catalogue's name straight away. The health probe is the expensive half and
   * is not forced here — `force` is what Settings' "Check all" is for.
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await window.cloudstream?.listHomeProviders?.(false);
      if (cancelled || !result?.ok) return;
      setProviders((result.providers ?? []) as ProviderSummary[]);
      setSelected(String(result.selected ?? ''));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDocument = (event: MouseEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocument);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocument);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const choose = useCallback(
    async (id: string) => {
      if (id === selected) {
        setOpen(false);
        return;
      }
      setSwitching(id);
      setError(null);
      try {
        const result = await window.cloudstream?.selectHomeProvider?.(id);
        if (!result?.ok) {
          /*
           * The registry refuses a catalogue that is not answering, and the
           * reason it gives is the useful part. Reporting "could not switch"
           * without it would leave the viewer with a menu that silently does
           * nothing for one entry.
           */
          setError(result?.error ?? 'That catalogue could not be selected.');
          return;
        }
        setSelected(id);
        setOpen(false);
        onChanged();
      } finally {
        setSwitching(null);
      }
    },
    [selected, onChanged]
  );

  const current = providers?.find((provider) => provider.id === selected);

  return (
    <div className="cat-picker" ref={wrap}>
      <button
        type="button"
        className={`cat-picker__button${open ? ' cat-picker__button--open' : ''}`}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        title="Where the rows on this page come from"
      >
        <Layers size={13} aria-hidden />
        <span className="cat-picker__label">{current?.name ?? 'Catalogue'}</span>
        <ChevronDown size={13} aria-hidden />
      </button>

      {open && (
        <div className="cat-picker__menu" role="menu">
          <p className="cat-picker__hint">
            Where these rows come from. The page rebuilds from whatever you pick.
          </p>

          {providers === null ? (
            <p className="cat-picker__loading">
              <Loader2 size={13} className="spin" aria-hidden /> Reading catalogues…
            </p>
          ) : (
            <ul className="cat-picker__list">
              {providers.map((provider) => {
                /*
                 * `selectable` is the registry's own answer and is the only
                 * thing worth reading here. An *unchecked* provider is
                 * selectable — the health probe is expensive and is not forced
                 * on open — so treating "no health record" as broken would grey
                 * out every entry on a cold start.
                 */
                const blocked = !provider.selectable;
                const reason =
                  provider.health?.reason ??
                  (provider.health?.status === 'unavailable'
                    ? 'Not answering right now'
                    : provider.requiresKey
                      ? 'Needs a key, set in Settings → Home'
                      : undefined);
                return (
                  <li key={provider.id}>
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={provider.id === selected}
                      className={`cat-picker__item${
                        provider.id === selected ? ' cat-picker__item--on' : ''
                      }${blocked ? ' cat-picker__item--blocked' : ''}`}
                      onClick={() => void choose(provider.id)}
                      disabled={switching !== null || blocked}
                    >
                      <span className="cat-picker__tick">
                        {switching === provider.id ? (
                          <Loader2 size={12} className="spin" aria-hidden />
                        ) : provider.id === selected ? (
                          <Check size={12} aria-hidden />
                        ) : null}
                      </span>
                      <span className="cat-picker__text">
                        <strong>{provider.name}</strong>
                        {/* The reason, when there is one — an entry greyed out
                            with no explanation reads as a broken menu. */}
                        {blocked && reason ? (
                          <em className="cat-picker__why">{reason}</em>
                        ) : provider.description ? (
                          <em>{provider.description}</em>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="cat-picker__foot">
            <label className="cat-picker__toggle">
              <input
                type="checkbox"
                checked={includeAnime}
                onChange={(event) => onIncludeAnimeChange(event.target.checked)}
              />
              {/*
                Anime is a separate source (AniList) rather than a genre of the
                chosen catalogue, which is why it is a checkbox here and not one
                of the entries above. Picking "Animation" on an IMDb-derived
                catalogue returns Western film, not anime.
              */}
              <span>Include anime rows</span>
            </label>
          </div>

          {error && (
            <p className="cat-picker__error" role="status">
              <AlertTriangle size={12} aria-hidden /> {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
