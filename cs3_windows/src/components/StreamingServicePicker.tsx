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
  availability: 'ready' | 'disabled' | 'missing';
  discovered?: boolean;
  extension?: string;
  types?: string[];
  lang?: string;
  adult?: boolean;
  mixedAdult?: boolean;
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
  NSFW: 'Adult (18+)',
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

function availabilityNote(p: PickerPlatform): string {
  switch (p.availability) {
    case 'missing':
      return 'Not installed — its page offers the extension';
    case 'disabled':
      return 'Installed but switched off';
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
  /**
   * Adult catalogues get their own control rather than a type chip: "hide
   * them" is the common wish, and a type chip can only *narrow to* a type.
   */
  const [adultFilter, setAdultFilter] = useState<'all' | 'hide' | 'only'>('all');
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
  // NSFW is left out of the type chips; the adult control below owns it.
  const typeFacet = useMemo(
    () => facet(all.map((p) => (p.types ?? []).filter((t) => t.toUpperCase() !== 'NSFW'))),
    [all]
  );
  const adultCount = useMemo(() => all.filter((p) => p.adult).length, [all]);
  const langFacet = useMemo(
    () => facet(all.map((p) => (p.lang ? [p.lang] : []))),
    [all]
  );

  // OR within a facet, AND across facets — the rule every other picker here uses.
  const visible = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return all.filter((p) => {
      if (selectedOnly && !enabled.has(p.id)) return false;
      if (adultFilter === 'hide' && p.adult) return false;
      if (adultFilter === 'only' && !p.adult) return false;
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
  }, [all, query, types, langs, selectedOnly, enabled, adultFilter]);

  /**
   * One flat list. Grouping by extension was mostly groups of one — an
   * extension usually registers a single catalogue — so the headings cost more
   * than they told. The extension is on each row instead. The three listed
   * services lead, then alphabetical; order never depends on selection, so a
   * row does not jump away from the pointer that just clicked it.
   */
  const rows = useMemo(
    () =>
      [...visible].sort(
        (a, b) =>
          Number(Boolean(a.discovered)) - Number(Boolean(b.discovered)) ||
          a.name.localeCompare(b.name)
      ),
    [visible]
  );

  const setAll = (list: PickerPlatform[], on: boolean) =>
    void apply(
      Object.fromEntries(list.filter((p) => enabled.has(p.id) !== on).map((p) => [p.id, on]))
    );

  const visibleOn = visible.filter((p) => enabled.has(p.id)).length;
  const filtered =
    query.trim() !== '' || types.size > 0 || langs.size > 0 || selectedOnly || adultFilter !== 'all';

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
            <FacetRow
              label="Type"
              entries={typeFacet}
              selected={types}
              format={typeLabel}
              onToggle={(value) => setTypes((set) => toggleIn(set, value))}
              onClear={() => setTypes(new Set())}
            />
          )}

          {langFacet.length > 1 && (
            <FacetRow
              label="Language"
              entries={langFacet}
              selected={langs}
              format={languageLabel}
              onToggle={(value) => setLangs((set) => toggleIn(set, value))}
              onClear={() => setLangs(new Set())}
            />
          )}

          {adultCount > 0 && (
            <div className="ssp__chips" role="radiogroup" aria-label="Adult content (18+)">
              {(
                [
                  ['all', 'All content'],
                  ['hide', 'Hide 18+'],
                  ['only', `18+ only (${adultCount})`],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={adultFilter === value}
                  aria-pressed={adultFilter === value}
                  className={`ssp__chip${value === 'only' ? ' ssp__chip--adult' : ''}`}
                  onClick={() => setAdultFilter(value)}
                >
                  {label}
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
                  setAdultFilter('all');
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
          ) : rows.length === 0 ? (
            <div className="ssp__empty">
              {filtered
                ? 'Nothing matches these filters.'
                : 'No installed provider publishes a catalogue yet. Add a repository on the Extensions screen.'}
            </div>
          ) : (
            <div className="ssp__list" role="list">
              {rows.map((p) => {
                const selected = enabled.has(p.id);
                const details = p.discovered
                  ? [
                      p.lang && languageLabel(p.lang),
                      (p.types ?? []).slice(0, 3).map(typeLabel).join(', '),
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : availabilityNote(p);
                return (
                  <button
                    key={p.id}
                    role="listitem"
                    className="ssp__row"
                    aria-pressed={selected}
                    title={details ? `${p.name} — ${details}` : p.name}
                    style={{ '--tile-accent': p.accent } as React.CSSProperties}
                    onClick={() => void apply({ [p.id]: !selected })}
                  >
                    <span className="ssp__badge" aria-hidden>
                      {p.name.trim().charAt(0).toUpperCase()}
                    </span>
                    <span className="ssp__tile-text">
                      <span className="ssp__tile-name">
                        {p.name}
                        {p.adult && (
                          <span className="adult-badge" style={{ marginLeft: '0.4rem' }} title="Adult content (18+)">
                            18+
                          </span>
                        )}
                        {!p.adult && p.mixedAdult && (
                          <span
                            className="adult-badge adult-badge--partial"
                            style={{ marginLeft: '0.4rem' }}
                            title="Has some adult (18+) rows; the rest is general content"
                          >
                            18+
                          </span>
                        )}
                      </span>
                      {details && <span className="ssp__tile-sub">{details}</span>}
                    </span>
                    {/* The extension, unless it only repeats the name — an archive
                        registering one provider named after itself is the common case. */}
                    {p.discovered ? (
                      p.extension && p.extension !== p.name && (
                        <span className="ssp__source">{p.extension}</span>
                      )
                    ) : (
                      <span className="ssp__source ssp__source--featured">Featured</span>
                    )}
                    <span className="ssp__check" aria-hidden>
                      {selected && <Check size={12} strokeWidth={3} />}
                    </span>
                  </button>
                );
              })}
            </div>
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

/**
 * One filter group on a single line: the label, every selected chip, then the
 * most common few, with the rest behind "+N more". Dozens of wrapping chips
 * used to push the service list — the point of this dialog — off screen.
 */
function FacetRow({
  label,
  entries,
  selected,
  format,
  onToggle,
  onClear,
}: {
  label: string;
  entries: Array<[string, number]>;
  selected: Set<string>;
  format: (value: string) => string;
  onToggle: (value: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const TOP = 5;
  const shown = open
    ? entries
    : entries.filter(([value], index) => index < TOP || selected.has(value));
  const hidden = entries.length - shown.length;
  return (
    <div className={`ssp__chips ssp__facet${open ? ' ssp__facet--open' : ''}`} role="group" aria-label={label}>
      <span className="ssp__facet-label">{label}</span>
      {shown.map(([value, count]) => (
        <button
          key={value}
          type="button"
          className="ssp__chip"
          aria-pressed={selected.has(value)}
          onClick={() => onToggle(value)}
        >
          {format(value)} <span className="ssp__chip-count">{count}</span>
        </button>
      ))}
      {(hidden > 0 || open) && entries.length > TOP && (
        <button type="button" className="ssp__chip ssp__chip--more" onClick={() => setOpen((v) => !v)}>
          {open ? 'Less' : `+${hidden} more`}
        </button>
      )}
      {selected.size > 0 && (
        <button type="button" className="ssp__chip ssp__chip--more" onClick={onClear}>
          Clear
        </button>
      )}
    </div>
  );
}
