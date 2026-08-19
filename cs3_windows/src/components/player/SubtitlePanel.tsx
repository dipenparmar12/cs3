import React, { useCallback, useEffect, useState } from 'react';
import { X, Search, Loader2, Check, AlertTriangle, Subtitles, CheckCircle2 } from 'lucide-react';
import type { SubtitleSearchResult } from '../../../electron/subtitleService';

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
}) => {
  const [results, setResults] = useState<SubtitleSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState<string | null>(null);

  // Custom search query and episode parameters
  const [searchQuery, setSearchQuery] = useState(title || imdbId || '');
  const [searchSeason, setSearchSeason] = useState<string>(season !== undefined ? String(season) : '');
  const [searchEpisode, setSearchEpisode] = useState<string>(episode !== undefined ? String(episode) : '');
  const [matchedInfo, setMatchedInfo] = useState<{ imdbId?: string; matchedTitle?: string } | null>(null);
  const [lastSearched, setLastSearched] = useState<string>('');

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
      const termToSearch = q || imdbId || title || '';
      setLastSearched(termToSearch);

      try {
        let response;
        if (window.cloudstream?.searchSubtitlesByTitle) {
          response = await window.cloudstream.searchSubtitlesByTitle(termToSearch, s, e, mediaUrl);
        } else {
          response = await window.cloudstream?.searchSubtitles(termToSearch, s, e, mediaUrl);
        }

        setLoading(false);

        if (!response?.ok) {
          setError(response?.error ?? 'Subtitle search failed.');
          return;
        }

        setResults(response.results);
        const resImdbId = response && 'imdbId' in response ? (response as { imdbId?: string }).imdbId : undefined;
        const resMatchedTitle = response && 'matchedTitle' in response ? (response as { matchedTitle?: string }).matchedTitle : undefined;

        if (resImdbId || resMatchedTitle) {
          setMatchedInfo({
            imdbId: resImdbId,
            matchedTitle: resMatchedTitle,
          });
        } else if (/^tt\d+$/i.test(termToSearch)) {
          setMatchedInfo({
            imdbId: termToSearch,
            matchedTitle: termToSearch,
          });
        } else {
          setMatchedInfo(null);
        }

        if (response.results.length === 0) {
          setError(
            `No subtitles found for "${termToSearch}". Try refining the title, checking season/episode, or searching with an exact IMDb ID (e.g. tt1234567).`
          );
        }
      } catch (err) {
        setLoading(false);
        setError(err instanceof Error ? err.message : 'Subtitle search failed.');
      }
    },
    [searchQuery, searchSeason, searchEpisode, season, episode, imdbId, title, providerCanAnswer, mediaUrl]
  );

  // Sync state when props change
  useEffect(() => {
    const initial = title || imdbId || '';
    setSearchQuery(initial);
    setSearchSeason(season !== undefined ? String(season) : '');
    setSearchEpisode(episode !== undefined ? String(episode) : '');
    setResults([]);
    setError(null);
    setMatchedInfo(null);
    setLastSearched('');
  }, [title, imdbId, season, episode]);

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
  for (const result of results) {
    const list = byLanguage.get(result.langName) ?? [];
    list.push(result);
    byLanguage.set(result.langName, list);
  }

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
          <button
            type="submit"
            className="subtitle-panel__search-submit-btn"
            disabled={loading || !searchQuery.trim()}
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>
      </form>

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

      {error && (
        <p className="player-panel__error">
          <AlertTriangle size={14} /> {error}
        </p>
      )}

      {[...byLanguage.entries()].map(([language, items]) => (
        <div key={language} className="player-panel__sub-group">
          <div className="player-panel__sub-heading">{language}</div>
          <ul className="player-panel__subs">
            {items.map((item, index) => (
              <li key={item.id}>
                <button
                  className="player-panel__sub"
                  onClick={() => applySubtitle(item)}
                  disabled={applying !== null}
                >
                  {applying === item.id ? (
                    <Loader2 className="spin" size={13} />
                  ) : (
                    <Subtitles size={13} />
                  )}
                  <span className="player-panel__sub-label">
                    {language} {items.length > 1 ? `#${index + 1}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </aside>
  );
};
