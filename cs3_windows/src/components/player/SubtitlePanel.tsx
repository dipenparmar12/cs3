import React, { useCallback, useEffect, useState } from 'react';
import { X, Search, Loader2, Check, AlertTriangle, Subtitles } from 'lucide-react';
import type { SubtitleSearchResult } from '../../../electron/subtitleService';

/**
 * In-player subtitle search.
 *
 * Subtitles are the single most common reason a viewer leaves a player, and
 * leaving means losing position and, for a torrent stream, sometimes the swarm.
 * Searching here keeps playback running throughout.
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

  const providerCanAnswer = Boolean(mediaUrl?.startsWith('cs3ext://'));

  const runSearch = useCallback(async () => {
    // An extension-sourced stream is worth asking about even with no IMDb id;
    // anything else without one has nothing to query.
    if (!imdbId && !providerCanAnswer) return;
    setLoading(true);
    setError(null);

    const response = await window.cloudstream?.searchSubtitles(
      imdbId ?? '',
      season,
      episode,
      mediaUrl
    );
    setLoading(false);

    if (!response?.ok) {
      setError(response?.error ?? 'Subtitle search failed.');
      return;
    }
    setResults(response.results);
    if (response.results.length === 0) {
      setError('No subtitles were found for this title.');
    }
  }, [imdbId, mediaUrl, providerCanAnswer, season, episode]);

  // Searching on open rather than behind a button: the viewer opened this panel
  // because they want subtitles, and an empty list with a button is a wasted step.
  useEffect(() => {
    if (open && imdbId && results.length === 0 && !loading && !error) void runSearch();
  }, [open, imdbId, results.length, loading, error, runSearch]);

  // A new episode invalidates the list — subtitles are per-episode.
  useEffect(() => {
    setResults([]);
    setError(null);
  }, [imdbId, season, episode]);

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
                : 'Online search'}
            </span>
          </div>
        </div>
        <div className="player-panel__head-actions">
          <button
            className="icon-button"
            onClick={runSearch}
            disabled={loading || !imdbId}
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

      {!imdbId && (
        <p className="player-panel__empty">
          Online search needs an IMDb id, which this title does not have. Subtitles
          included with the stream are listed above.
        </p>
      )}

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
