import React, { useCallback, useEffect, useState } from 'react';
import { X, Search, Loader2, Check, AlertTriangle, Subtitles, CheckCircle2, Download, RotateCcw, HardDrive, Minus, Plus, Star } from 'lucide-react';
import type { SavedSubtitle } from '../../../electron/subtitles/subtitleLibrary';
import type { SubtitleFindResult, SubtitleSearchResult } from '../../../electron/subtitleService';

/**
 * In-player subtitle search & management.
 *
 * Subtitles are the single most common reason a viewer leaves a player, and
 * leaving means losing position and, for a torrent stream, sometimes the swarm.
 * Searching here keeps playback running throughout.
 *
 * Users can search subtitles by automatic IMDb id, extension provider links,
 * or by inputting their own custom movie/series title or IMDb id (e.g. tt1234567).
 *
 * Results are grouped by language rather than listed flat: OpenSubtitles
 * returns many near-identical files per language, and the choice a viewer
 * actually wants to make first is "which language", not "which of eight English
 * uploads".
 */

interface SubtitlePanelProps {
  open: boolean;
  /** Absent when the title has no IMDb id, which OpenSubtitles is keyed on. */
  imdbId?: string;
  /** Current media title (for pre-filling custom search and title resolution). */
  title?: string;
  /** Current episode title. */
  episodeTitle?: string;
  /**
   * The media URL being played. A `cs3ext://` one lets the extension provider be
   * asked for its own subtitles — frequently the only ones that exist for a
   * title no catalogue carries, and therefore the only ones for content with no
   * IMDb id at all.
   */
  mediaUrl?: string;
  season?: number;
  episode?: number;
  /** Subtitles already embedded in the stream, offered alongside online ones. */
  embedded: Array<{ name: string; url: string }>;
  activeUrl: string | null;
  onClose: () => void;
  onSelect: (url: string | null, label: string) => void;
  year?: number;
  /** Seconds the cues are shifted by; positive shows them later. */
  delay: number;
  onDelayChange: (seconds: number) => void;
  /** The playing source's release name; ranks the subtitle timed to it first. */
  releaseName?: string;
}

/** Languages offered as one-press filters before a search has returned any. */
const COMMON_LANGUAGES: Array<{ code: string; name: string }> = [
  { code: 'eng', name: 'English' },
  { code: 'hin', name: 'Hindi' },
  { code: 'spa', name: 'Spanish' },
  { code: 'fre', name: 'French' },
  { code: 'ger', name: 'German' },
  { code: 'ara', name: 'Arabic' },
  { code: 'por', name: 'Portuguese' },
  { code: 'tam', name: 'Tamil' },
  { code: 'tel', name: 'Telugu' },
  { code: 'mal', name: 'Malayalam' },
];

const compactCount = (value: number): string =>
  value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M` : value >= 1_000 ? `${Math.round(value / 1_000)}k` : String(value);

/** What a row is called: the release it was timed to, which is what a viewer chooses by. */
function rowLabel(result: SubtitleSearchResult, fallback: string): string {
  const name = result.releaseName || result.fileName?.replace(/\.(srt|ass|ssa|vtt|sub)$/i, '');
  return name ? name.replace(/[._]+/g, ' ').trim() : fallback;
}

type DownloadState = { status: 'saving' } | { status: 'saved'; reused: boolean } | { status: 'failed'; error: string };

/** Where a result came from, in words a viewer can act on. */
function originLabel(result: SubtitleSearchResult): string {
  return result.id.startsWith('provider:') ? 'from this source' : 'OpenSubtitles';
}

export const SubtitlePanel: React.FC<SubtitlePanelProps> = ({
  open,
  imdbId,
  title,
  mediaUrl,
  season,
  episode,
  embedded,
  activeUrl,
  onClose,
  onSelect,
  year,
  delay,
  onDelayChange,
  releaseName,
}) => {
  const [results, setResults] = useState<SubtitleSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedSubtitle[]>([]);
  const [downloads, setDownloads] = useState<Record<string, DownloadState>>({});

  const refreshSaved = useCallback(async () => {
    if (!title) {
      setSaved([]);
      return;
    }
    const response = await window.cloudstream?.listSavedSubtitles(title, year, season, episode);
    setSaved(response?.ok ? response.entries : []);
  }, [title, year, season, episode]);

  useEffect(() => {
    if (open) void refreshSaved();
  }, [open, refreshSaved]);

  /**
   * Saves a result to the subtitle folder. A second press on a saved row asks
   * for a fresh copy; the first one never re-downloads what is already there.
   * Nothing here touches the track that is playing.
   */
  const downloadResult = useCallback(
    async (result: SubtitleSearchResult, refresh: boolean) => {
      if (!title) return;
      setDownloads((d) => ({ ...d, [result.id]: { status: 'saving' } }));
      const response = await window.cloudstream?.downloadSubtitle({
        title,
        year,
        season,
        episode,
        lang: result.lang,
        langName: result.langName,
        origin: result.id.startsWith('provider:') ? 'provider' : 'opensubtitles',
        sourceUrl: result.url,
        refresh,
      });
      setDownloads((d) => ({
        ...d,
        [result.id]: response?.ok
          ? { status: 'saved', reused: response.reused }
          : { status: 'failed', error: response?.error ?? 'The subtitle could not be saved.' },
      }));
      if (response?.ok) void refreshSaved();
    },
    [title, year, season, episode, refreshSaved]
  );

  const applySaved = useCallback(
    async (entry: SavedSubtitle) => {
      const response = await window.cloudstream?.readSavedSubtitle(entry.id);
      if (!response?.ok || !response.vtt) {
        setError(response?.error ?? 'That saved subtitle could not be read.');
        void refreshSaved();
        return;
      }
      onSelect(URL.createObjectURL(new Blob([response.vtt], { type: 'text/vtt' })), entry.langName);
      onClose();
    },
    [onSelect, onClose, refreshSaved]
  );
  const [applying, setApplying] = useState<string | null>(null);

  // Custom search query and episode parameters
  const [searchQuery, setSearchQuery] = useState(title || imdbId || '');
  const [searchSeason, setSearchSeason] = useState<string>(season !== undefined ? String(season) : '');
  const [searchEpisode, setSearchEpisode] = useState<string>(episode !== undefined ? String(episode) : '');
  const [searchYear, setSearchYear] = useState<string>(year !== undefined ? String(year) : '');
  const [matchedInfo, setMatchedInfo] = useState<{ imdbId?: string; matchedTitle?: string } | null>(null);
  const [lastSearched, setLastSearched] = useState<string>('');
  /**
   * Languages to show — several at once, because a viewer who reads two
   * languages wants both lists, not to flip a dropdown between them. Empty is
   * every language. Applied to what was already fetched; a search sends them
   * too, so a language the catalogue would otherwise cut short comes back full.
   */
  const [languages, setLanguages] = useState<string[]>([]);
  const [sourceNote, setSourceNote] = useState<string | null>(null);

  const providerCanAnswer = Boolean(mediaUrl?.startsWith('cs3ext://'));

  const runSearch = useCallback(
    async (queryOverride?: string, sNum?: number, eNum?: number) => {
      const q = (queryOverride !== undefined ? queryOverride : searchQuery).trim();
      const s = sNum !== undefined ? sNum : searchSeason ? parseInt(searchSeason, 10) : season;
      const e = eNum !== undefined ? eNum : searchEpisode ? parseInt(searchEpisode, 10) : episode;

      // An extension-sourced stream is worth asking about even with no query;
      // anything else without one has nothing to query.
      if (!q && !imdbId && !providerCanAnswer) {
        setError('Please enter a movie title, series name, or IMDb ID to search for subtitles.');
        return;
      }

      setLoading(true);
      setError(null);
      setSourceNote(null);
      const termToSearch = q || imdbId || title || '';
      setLastSearched(termToSearch);
      const y = searchYear ? parseInt(searchYear, 10) : undefined;

      try {
        const response = await window.cloudstream?.findSubtitles({
          // The detected id only while the viewer is searching the detected title.
          imdbId: q === (title || '') || !q ? imdbId : undefined,
          title: termToSearch,
          year: Number.isFinite(y) ? y : undefined,
          season: s,
          episode: e,
          mediaUrl,
          languages,
          releaseName,
        });

        setLoading(false);

        if (!response?.ok) {
          setError(response?.error ?? 'Subtitle search failed.');
          return;
        }

        setResults(response.results);
        setMatchedInfo(
          response.imdbId || response.matchedTitle
            ? { imdbId: response.imdbId, matchedTitle: response.matchedTitle }
            : null
        );

        // A catalogue that could not be reached is said so, never folded into
        // "nothing found" — the two need different things from the viewer.
        const sources = response.sources as SubtitleFindResult['sources'] | undefined;
        const failed = sources
          ? Object.entries(sources).filter(([, v]) => v.status === 'failed').map(([k]) => (k === 'stremio' ? 'Stremio OpenSubtitles' : 'OpenSubtitles'))
          : [];
        if (failed.length) setSourceNote(`${failed.join(' and ')} could not be reached; results may be incomplete.`);

        if (response.results.length === 0) {
          setError(
            failed.length === 2
              ? 'The subtitle catalogues could not be reached. Check the connection and search again.'
              : `No subtitles found for "${termToSearch}". Try the original title, a different year, or an IMDb ID (tt1234567).`
          );
        }
      } catch (err) {
        setLoading(false);
        setError(err instanceof Error ? err.message : 'Subtitle search failed.');
      }
    },
    [searchQuery, searchSeason, searchEpisode, searchYear, season, episode, imdbId, title, providerCanAnswer, mediaUrl, languages, releaseName]
  );

  // Sync state when props change
  useEffect(() => {
    const initial = title || imdbId || '';
    setSearchQuery(initial);
    setSearchSeason(season !== undefined ? String(season) : '');
    setSearchEpisode(episode !== undefined ? String(episode) : '');
    setSearchYear(year !== undefined ? String(year) : '');
    setResults([]);
    setError(null);
    setMatchedInfo(null);
    setLastSearched('');
  }, [title, imdbId, season, episode, year]);

  // Searching on open rather than behind a button: the viewer opened this panel
  // because they want subtitles, and an empty list with a button is a wasted step.
  useEffect(() => {
    if (open && (imdbId || title) && results.length === 0 && !loading && !error && !lastSearched) {
      void runSearch(title || imdbId);
    }
  }, [open, imdbId, title, results.length, loading, error, lastSearched, runSearch]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void runSearch();
  };

  /**
   * Downloads a subtitle and hands the player a blob URL.
   *
   * The main process fetches and converts SubRip to WebVTT; a `<track>` given
   * the original `.srt` renders nothing and reports no error.
   */
  const applySubtitle = useCallback(
    async (result: SubtitleSearchResult) => {
      setApplying(result.id);
      const response = await window.cloudstream?.fetchSubtitle(result.url);
      setApplying(null);

      if (!response?.ok || !response.vtt) {
        setError(response?.error ?? 'That subtitle could not be downloaded.');
        return;
      }
      const blob = new Blob([response.vtt], { type: 'text/vtt' });
      onSelect(URL.createObjectURL(blob), result.langName);
      onClose();
    },
    [onSelect, onClose]
  );

  if (!open) return null;

  const byLanguage = new Map<string, SubtitleSearchResult[]>();
  const codeFor = new Map<string, string>();
  for (const result of results) {
    const list = byLanguage.get(result.langName) ?? [];
    list.push(result);
    byLanguage.set(result.langName, list);
    codeFor.set(result.langName, result.lang.toLowerCase());
  }
  // Chips: every language the results carry, plus the common ones before a search.
  const languageChips = (() => {
    const chips = new Map<string, { code: string; name: string; count: number }>();
    for (const [name, items] of byLanguage) {
      const code = codeFor.get(name) ?? name;
      chips.set(code, { code, name: name.replace(/\s*\(from this provider\)$/, ''), count: items.length });
    }
    if (chips.size === 0) for (const l of COMMON_LANGUAGES) chips.set(l.code, { ...l, count: 0 });
    for (const code of languages) if (!chips.has(code)) chips.set(code, { code, name: code.toUpperCase(), count: 0 });
    return [...chips.values()].sort((a, b) => (a.code === 'eng' ? -1 : b.code === 'eng' ? 1 : b.count - a.count || a.name.localeCompare(b.name)));
  })();
  const showLanguage = (name: string) => languages.length === 0 || languages.includes(codeFor.get(name) ?? '');

  return (
    <aside className="player-panel player-panel--subtitles" aria-label="Subtitles">
      <header className="player-panel__head">
        <div>
          <h3>Subtitles</h3>
          <div className="player-panel__facts">
            <span>
              {results.length > 0
                ? `${results.length} online · ${byLanguage.size} languages`
                : 'Online & stream subtitles'}
            </span>
          </div>
        </div>
        <div className="player-panel__head-actions">
          <button
            className="icon-button"
            onClick={() => void runSearch()}
            disabled={loading}
            title="Search again"
            aria-label="Search subtitles again"
          >
            {loading ? <Loader2 className="spin" size={18} /> : <Search size={18} />}
          </button>
          <button className="icon-button" onClick={onClose} aria-label="Close subtitles">
            <X size={18} />
          </button>
        </div>
      </header>

      {/* Custom Subtitle Search Form */}
      <form className="subtitle-panel__search-form" onSubmit={handleSearchSubmit}>
        <div className="subtitle-panel__search-bar">
          <Search size={14} style={{ flexShrink: 0, opacity: 0.6 }} />
          <input
            type="text"
            className="subtitle-panel__search-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search custom title or IMDb ID (tt...)"
            aria-label="Custom subtitle search query"
          />
          {searchQuery && (
            <button
              type="button"
              className="subtitle-panel__search-btn"
              onClick={() => setSearchQuery('')}
              title="Clear title query"
              aria-label="Clear query"
            >
              <X size={14} />
            </button>
          )}
          {title && searchQuery !== title && (
            <button
              type="button"
              className="subtitle-panel__search-btn"
              onClick={() => {
                setSearchQuery(title);
                void runSearch(title);
              }}
              title="Search with the detected title again"
              aria-label="Reset to detected title"
            >
              <RotateCcw size={14} />
            </button>
          )}
          <button
            type="submit"
            className="subtitle-panel__search-btn"
            disabled={loading || !searchQuery.trim()}
            title="Search subtitles"
            aria-label="Search"
          >
            {loading ? <Loader2 className="spin" size={14} /> : <Search size={14} />}
          </button>
        </div>

        <div className="subtitle-panel__ep-inputs">
          <div className="subtitle-panel__ep-field">
            <span>Season:</span>
            <input
              type="number"
              min="1"
              className="subtitle-panel__ep-input"
              value={searchSeason}
              placeholder="S#"
              onChange={(e) => setSearchSeason(e.target.value)}
              aria-label="Season number"
            />
          </div>
          <div className="subtitle-panel__ep-field">
            <span>Episode:</span>
            <input
              type="number"
              min="1"
              className="subtitle-panel__ep-input"
              value={searchEpisode}
              placeholder="Ep#"
              onChange={(e) => setSearchEpisode(e.target.value)}
              aria-label="Episode number"
            />
          </div>
          <div className="subtitle-panel__ep-field">
            <span>Year:</span>
            <input
              type="number"
              min="1900"
              max="2100"
              className="subtitle-panel__ep-input subtitle-panel__ep-input--year"
              value={searchYear}
              placeholder="Year"
              onChange={(e) => setSearchYear(e.target.value)}
              aria-label="Release year"
            />
          </div>
          <button
            type="submit"
            className="subtitle-panel__search-submit-btn"
            disabled={loading || !searchQuery.trim()}
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>
      </form>

      <div className="subtitle-panel__languages" role="group" aria-label="Subtitle languages">
        <button
          type="button"
          className={`subtitle-panel__chip${languages.length === 0 ? ' subtitle-panel__chip--on' : ''}`}
          onClick={() => setLanguages([])}
        >
          All{results.length > 0 ? ` (${results.length})` : ''}
        </button>
        {languageChips.map(({ code, name, count }) => {
          const on = languages.includes(code);
          return (
            <button
              key={code}
              type="button"
              className={`subtitle-panel__chip${on ? ' subtitle-panel__chip--on' : ''}`}
              onClick={() => setLanguages((current) => (on ? current.filter((c) => c !== code) : [...current, code]))}
              aria-pressed={on}
            >
              {name}
              {count > 0 ? ` (${count})` : ''}
            </button>
          );
        })}
      </div>

      {/* Matched Title Info Tag */}
      {matchedInfo && (
        <div className="subtitle-panel__matched">
          <CheckCircle2 size={13} style={{ flexShrink: 0 }} />
          <span>
            Matched: <strong>{matchedInfo.matchedTitle || matchedInfo.imdbId}</strong>
            {matchedInfo.imdbId && matchedInfo.matchedTitle !== matchedInfo.imdbId && (
              <span style={{ opacity: 0.8, marginLeft: '0.3rem' }}>({matchedInfo.imdbId})</span>
            )}
          </span>
        </div>
      )}

      <ul className="player-panel__subs">
        <li>
          <button
            className={`player-panel__sub${activeUrl === null ? ' player-panel__sub--current' : ''}`}
            onClick={() => {
              onSelect(null, 'Off');
              onClose();
            }}
          >
            <span className="player-panel__sub-label">Off</span>
            {activeUrl === null && <Check size={14} />}
          </button>
        </li>

        {embedded.map((sub) => (
          <li key={sub.url}>
            <button
              className={`player-panel__sub${activeUrl === sub.url ? ' player-panel__sub--current' : ''}`}
              onClick={() => {
                onSelect(sub.url, sub.name);
                onClose();
              }}
            >
              <Subtitles size={13} />
              <span className="player-panel__sub-label">{sub.name}</span>
              <span className="player-panel__sub-tag">in stream</span>
              {activeUrl === sub.url && <Check size={14} />}
            </button>
          </li>
        ))}
      </ul>

      <div className="subtitle-panel__sync" aria-label="Subtitle timing">
        <span>Timing</span>
        <button
          className="icon-button"
          onClick={() => onDelayChange(Math.round((delay - 0.25) * 100) / 100)}
          aria-label="Show subtitles earlier"
          title="Earlier by 0.25s"
        >
          <Minus size={14} />
        </button>
        <output>
          {delay > 0 ? '+' : ''}
          {delay.toFixed(2)}s
        </output>
        <button
          className="icon-button"
          onClick={() => onDelayChange(Math.round((delay + 0.25) * 100) / 100)}
          aria-label="Show subtitles later"
          title="Later by 0.25s"
        >
          <Plus size={14} />
        </button>
        {delay !== 0 && (
          <button className="subtitle-panel__sync-reset" onClick={() => onDelayChange(0)}>
            Reset
          </button>
        )}
      </div>

      {saved.length > 0 && (
        <div className="player-panel__sub-group">
          <div className="player-panel__sub-heading">Saved on this computer</div>
          <ul className="player-panel__subs">
            {saved.map((entry) => (
              <li key={entry.id}>
                <button
                  className="player-panel__sub"
                  onClick={() => void applySaved(entry)}
                  title={entry.filePath}
                >
                  <HardDrive size={13} />
                  <span className="player-panel__sub-label">{entry.langName}</span>
                  <span className="player-panel__sub-tag">
                    saved · {entry.origin === 'opensubtitles' ? 'OpenSubtitles' : 'from source'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!loading && lastSearched && results.length === 0 && !error && (
        <p className="player-panel__error">
          No matching subtitle was found online. Edit the title above and search again.
        </p>
      )}

      {error && (
        <p className="player-panel__error">
          <AlertTriangle size={14} /> {error}
        </p>
      )}

      {sourceNote && <p className="subtitle-panel__note">{sourceNote}</p>}

      {[...byLanguage.entries()]
        .filter(([language]) => showLanguage(language))
        .map(([language, items]) => (
        <div key={language} className="player-panel__sub-group">
          <div className="player-panel__sub-heading">{language}</div>
          <ul className="player-panel__subs">
            {items.map((item, index) => {
              const state = downloads[item.id];
              return (
                <li key={item.id} className="subtitle-panel__row">
                  <button
                    className={`player-panel__sub subtitle-panel__result${item.best ? ' subtitle-panel__result--best' : ''}`}
                    onClick={() => applySubtitle(item)}
                    disabled={applying !== null}
                    title={[
                      item.fileName,
                      item.best ? 'Best match for what is playing' : undefined,
                      item.matchReasons?.length ? item.matchReasons.join(' · ') : undefined,
                    ]
                      .filter(Boolean)
                      .join('\n')}
                  >
                    {applying === item.id ? (
                      <Loader2 className="spin" size={13} />
                    ) : item.best ? (
                      <Star size={13} className="subtitle-panel__star" fill="currentColor" />
                    ) : (
                      <Subtitles size={13} />
                    )}
                    <span className="subtitle-panel__result-text">
                      <span className="player-panel__sub-label">
                        {rowLabel(item, `${language}${items.length > 1 ? ` #${index + 1}` : ''}`)}
                      </span>
                      <span className="subtitle-panel__result-meta">
                        {item.best && <span className="subtitle-panel__best">Best match</span>}
                        <span>{originLabel(item)}</span>
                        {item.downloads ? <span>{compactCount(item.downloads)} downloads</span> : null}
                        {item.rating ? <span>★ {item.rating.toFixed(1)}</span> : null}
                        {item.hearingImpaired && <span title="Includes sound descriptions">HI</span>}
                        {item.machineTranslated && <span>machine translated</span>}
                      </span>
                    </span>
                  </button>
                  <button
                    className="icon-button subtitle-panel__download"
                    onClick={() => void downloadResult(item, state?.status === 'saved')}
                    disabled={!title || state?.status === 'saving'}
                    title={
                      state?.status === 'saved'
                        ? `${state.reused ? 'Already saved' : 'Saved'}. Press to download again`
                        : state?.status === 'failed'
                          ? `${state.error} Press to retry.`
                          : 'Download this subtitle'
                    }
                    aria-label="Download subtitle"
                  >
                    {state?.status === 'saving' ? (
                      <Loader2 className="spin" size={13} />
                    ) : state?.status === 'saved' ? (
                      <Check size={13} />
                    ) : state?.status === 'failed' ? (
                      <AlertTriangle size={13} />
                    ) : (
                      <Download size={13} />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </aside>
  );
};
