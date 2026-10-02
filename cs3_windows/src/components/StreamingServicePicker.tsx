import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2, Search, X } from 'lucide-react';
import './StreamingServicePicker.css';

/**
 * Which streaming services appear in the sidebar — Android's home-screen
 * provider picker, desktop-shaped.
 *
 * The list is not a table we maintain. Beside the three hand-listed services it
 * carries every installed, enabled provider that publishes a catalogue
 * (`hasMainPage`), discovered by the main process from what extensions
 * registered. Installing an extension grows this list; nothing here names one.
 *
 * Android's selector filters by content type and language and the choice is a
 * set, so this one does the same: chips narrow what is shown, and Select all /
 * Select none act on exactly what is shown — never on rows the filter hid,
 * which would change things the viewer cannot see.
 */
interface PickerPlatform {
  id: string;
  name: string;
  accent: string;
  availability: 'ready' | 'disabled' | 'aggregate' | 'missing';
  discovered?: boolean;
  extension?: string;
  types?: string[];
  lang?: string;
}

interface Props {
  onClose: () => void;
  /** Called after every saved change so the sidebar re-reads its list. */
  onChanged: () => void;
}

/** Upstream `TvType` names, as a viewer would say them. */
const TYPE_LABELS: Record<string, string> = {
  Movie: 'Movies',
  TvSeries: 'TV series',
  Anime: 'Anime',
  AnimeMovie: 'Anime films',
  OVA: 'OVA',
  Cartoon: 'Cartoons',
  Documentary: 'Documentaries',
  AsianDrama: 'Asian drama',
  Live: 'Live TV',
  Torrent: 'Torrents',
  Music: 'Music',
  AudioBook: 'Audiobooks',
  Audio: 'Audio',
  Podcast: 'Podcasts',
  CustomMedia: 'Other',
  Others: 'Other',
};

const typeLabel = (type: string) => TYPE_LABELS[type] ?? type;

const languageNames = (() => {
  try {
    return new Intl.DisplayNames(undefined, { type: 'language' });
  } catch {
    return null;
  }
})();

function languageLabel(code: string): string {
  if (code === 'multi' || code === 'mul') return 'Multilingual';
  try {
    return languageNames?.of(code) ?? code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

const FEATURED = 'Featured';

function availabilityNote(p: PickerPlatform): string {
  switch (p.availability) {
    case 'missing':
      return 'Not installed — its page offers the extension';
    case 'disabled':
      return 'Installed but switched off';
    case 'aggregate':
      return 'Carried by another extension';
    default:
      return 'Installed';
  }
}

/** Facet values with counts, most common first. */
function facet(values: string[][]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const list of values) for (const v of new Set(list)) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export const StreamingServicePicker: React.FC<Props> = ({ onClose, onChanged }) => {
  const [platforms, setPlatforms] = useState<PickerPlatform[] | null>(null);
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [types, setTypes] = useState<Set<string>>(new Set());
  const [langs, setLangs] = useState<Set<string>>(new Set());
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    void window.cloudstream?.listAllOttPlatforms().then((response) => {
      if (!live) return;
      if (!response?.ok) {
        setError(response?.error ?? 'Could not read the installed providers.');
        setPlatforms([]);
        return;
      }
      setPlatforms((response.platforms ?? []) as PickerPlatform[]);
      setEnabled(new Set(response.enabled ?? []));
    });
    return () => {
      live = false;
    };
  }, []);

  /**
   * Optimistic, then corrected by the main process's answer — which is the
   * whole enabled set, so a failed write cannot leave the tiles lying.
   */
  const apply = useCallback(
    async (changes: Record<string, boolean>) => {
      if (Object.keys(changes).length === 0) return;
      const previous = enabled;
      const next = new Set(enabled);
      for (const [id, on] of Object.entries(changes)) {
        if (on) next.add(id);
        else next.delete(id);
      }
      setEnabled(next);
      setSaving(true);
      setError(null);
      const response = await window.cloudstream?.setOttPlatformsEnabled(changes);
      setSaving(false);
      if (response?.ok && response.enabled) {
        setEnabled(new Set(response.enabled));
        onChanged();
      } else {
        setEnabled(previous);
        setError(response?.error ?? 'That change was not saved.');
      }
    },
    [enabled, onChanged]
  );

  const all = useMemo(() => platforms ?? [], [platforms]);
  const typeFacet = useMemo(() => facet(all.map((p) => p.types ?? [])), [all]);
  const langFacet = useMemo(
    () => facet(all.map((p) => (p.lang ? [p.lang] : []))),
    [all]
  );

  // OR within a facet, AND across facets — the rule every other picker here uses.
  const visible = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return all.filter((p) => {
      if (selectedOnly && !enabled.has(p.id)) return false;
      if (types.size > 0 && !(p.types ?? []).some((t) => types.has(t))) return false;
      if (langs.size > 0 && !(p.lang && langs.has(p.lang))) return false;
      if (words.length === 0) return true;
      const hay = [
        p.name,
        p.extension,
        p.lang && languageLabel(p.lang),
        ...(p.types ?? []).map(typeLabel),
      ]
        .join(' ')
        .toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [all, query, types, langs, selectedOnly, enabled]);

  const groups = useMemo(() => {
    const map = new Map<string, PickerPlatform[]>();
    for (const p of visible) {
      const key = p.discovered ? (p.extension ?? 'Other extensions') : FEATURED;
      const list = map.get(key) ?? [];
      list.push(p);
      map.set(key, list);
    }
    return [...map].sort(([a], [b]) =>
      a === FEATURED ? -1 : b === FEATURED ? 1 : a.localeCompare(b)
    );
  }, [visible]);

  const setAll = (list: PickerPlatform[], on: boolean) =>
    void apply(
      Object.fromEntries(list.filter((p) => enabled.has(p.id) !== on).map((p) => [p.id, on]))
    );

  const visibleOn = visible.filter((p) => enabled.has(p.id)).length;
  const filtered = query.trim() !== '' || types.size > 0 || langs.size > 0 || selectedOnly;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const toggleIn = (set: Set<string>, value: string) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  return (
    <div className="ssp-backdrop" onClick={onClose}>
      <div
        className="ssp"
        role="dialog"
        aria-modal="true"
        aria-label="Choose streaming services"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="ssp__head">
          <div className="ssp__title-row">
            <h2 className="ssp__title">Streaming services</h2>
            <span className="ssp__count">
              {enabled.size} shown in sidebar
            </span>
            <button className="ssp__icon-btn" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          </div>

          <label className="ssp__search">
            <Search size={15} aria-hidden />
            <input
              ref={searchRef}
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search services, extensions, languages"
              aria-label="Search services"
            />
            {query && (
              <button className="ssp__icon-btn" onClick={() => setQuery('')} aria-label="Clear search">
                <X size={14} />
              </button>
            )}
          </label>

          {typeFacet.length > 1 && (
            <div className="ssp__chips" role="group" aria-label="Content type">
              {typeFacet.map(([type, count]) => (
                <button
                  key={type}
                  className="ssp__chip"
                  aria-pressed={types.has(type)}
                  onClick={() => setTypes((set) => toggleIn(set, type))}
                >
                  {typeLabel(type)} <span className="ssp__chip-count">{count}</span>
                </button>
              ))}
            </div>
          )}

          {langFacet.length > 1 && (
            <div className="ssp__chips" role="group" aria-label="Language">
              {langFacet.map(([lang, count]) => (
                <button
                  key={lang}
                  className="ssp__chip"
                  aria-pressed={langs.has(lang)}
                  onClick={() => setLangs((set) => toggleIn(set, lang))}
                >
                  {languageLabel(lang)} <span className="ssp__chip-count">{count}</span>
                </button>
              ))}
            </div>
          )}

          <div className="ssp__toolbar">
            <button
              className="ssp__btn"
              disabled={visible.length === 0 || visibleOn === visible.length}
              onClick={() => setAll(visible, true)}
            >
              {filtered ? `Select these (${visible.length})` : `Select all (${visible.length})`}
            </button>
            <button
              className="ssp__btn"
              disabled={visibleOn === 0}
              onClick={() => setAll(visible, false)}
            >
              {filtered ? 'Clear these' : 'Select none'}
            </button>
            <button
              className="ssp__chip"
              aria-pressed={selectedOnly}
              onClick={() => setSelectedOnly((on) => !on)}
            >
              Selected only
            </button>
            <span className="ssp__toolbar-spacer" />
            {filtered && (
              <button
                className="ssp__btn"
                onClick={() => {
                  setQuery('');
                  setTypes(new Set());
                  setLangs(new Set());
                  setSelectedOnly(false);
                }}
              >
                Reset filters
              </button>
            )}
          </div>
        </div>

        <div className="ssp__body">
          {platforms === null ? (
            <div className="ssp__empty">
              <Loader2 size={16} className="spin" /> Reading installed providers…
            </div>
          ) : groups.length === 0 ? (
            <div className="ssp__empty">
              {filtered
                ? 'Nothing matches these filters.'
                : 'No installed provider publishes a catalogue yet. Add a repository on the Extensions screen.'}
            </div>
          ) : (
            groups.map(([group, list]) => {
              const on = list.filter((p) => enabled.has(p.id)).length;
              return (
                <section key={group}>
                  <label className="ssp__group-head">
                    <input
                      type="checkbox"
                      checked={on === list.length}
                      ref={(el) => {
                        if (el) el.indeterminate = on > 0 && on < list.length;
                      }}
                      onChange={() => setAll(list, on !== list.length)}
                      aria-label={`Select every service in ${group}`}
                    />
                    <span>
                      {group} · {on}/{list.length}
                    </span>
                  </label>
                  <div className="ssp__grid">
                    {list.map((p) => {
                      const selected = enabled.has(p.id);
                      const sub = p.discovered
                        ? [p.lang && languageLabel(p.lang), (p.types ?? []).slice(0, 2).map(typeLabel).join(', ')]
                            .filter(Boolean)
                            .join(' · ')
                        : availabilityNote(p);
                      return (
                        <button
                          key={p.id}
                          className="ssp__tile"
                          aria-pressed={selected}
                          title={sub ? `${p.name} — ${sub}` : p.name}
                          style={{ '--tile-accent': p.accent } as React.CSSProperties}
                          onClick={() => void apply({ [p.id]: !selected })}
                        >
                          <span className="ssp__badge" aria-hidden>
                            {p.name.trim().charAt(0).toUpperCase()}
                          </span>
                          <span className="ssp__tile-text">
                            <span className="ssp__tile-name">{p.name}</span>
                            {sub && <span className="ssp__tile-sub">{sub}</span>}
                          </span>
                          <span className="ssp__check" aria-hidden>
                            {selected && <Check size={12} strokeWidth={3} />}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })
          )}
        </div>

        <div className="ssp__foot">
          {error ? (
            <span className="ssp__error">{error}</span>
          ) : saving ? (
            <span>
              <Loader2 size={12} className="spin" /> Saving…
            </span>
          ) : (
            <span>
              Showing {visible.length} of {all.length} · changes save as you go
            </span>
          )}
          <span className="ssp__toolbar-spacer" />
          <button className="ssp__btn ssp__btn--primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
