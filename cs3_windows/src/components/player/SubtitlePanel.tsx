import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  X,
  Search,
  Loader2,
  Check,
  AlertTriangle,
  Subtitles,
  CheckCircle2,
  Download,
  RotateCcw,
  HardDrive,
  Minus,
  Plus,
  Star,
  Sliders,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { SavedSubtitle } from '../../../electron/subtitles/subtitleLibrary';
import type { SubtitleFindResult, SubtitleSearchResult } from '../../../electron/subtitleService';
import {
  DEFAULT_SUBTITLE_STYLE,
  SUBTITLE_BACKGROUNDS,
  SUBTITLE_COLORS,
  SUBTITLE_SCALES,
  subtitleCssVariables,
  type SubtitleBackground,
  type SubtitleStyle,
} from '../../utils/subtitleStyle';

export function getLanguageFlag(code: string, name?: string): string {
  const c = (code || '').toLowerCase().trim();
  const n = (name || '').toLowerCase().trim();
  if (c === 'eng' || c === 'en' || n.includes('english')) return '🇬🇧';
  if (c === 'hin' || c === 'hi' || n.includes('hindi')) return '🇮🇳';
  if (c === 'spa' || c === 'es' || n.includes('spanish')) return '🇪🇸';
  if (c === 'fre' || c === 'fra' || c === 'fr' || n.includes('french')) return '🇫🇷';
  if (c === 'ger' || c === 'deu' || c === 'de' || n.includes('german')) return '🇩🇪';
  if (c === 'ita' || c === 'it' || n.includes('italian')) return '🇮🇹';
  if (c === 'por' || c === 'pt' || n.includes('portuguese')) return '🇵🇹';
  if (c === 'ara' || c === 'ar' || n.includes('arabic')) return '🇸🇦';
  if (c === 'jpn' || c === 'ja' || n.includes('japanese')) return '🇯🇵';
  if (c === 'kor' || c === 'ko' || n.includes('korean')) return '🇰🇷';
  if (c === 'zho' || c === 'chi' || c === 'zh' || n.includes('chinese')) return '🇨🇳';
  if (c === 'rus' || c === 'ru' || n.includes('russian')) return '🇷🇺';
  if (c === 'tur' || c === 'tr' || n.includes('turkish')) return '🇹🇷';
  if (c === 'vie' || c === 'vi' || n.includes('vietnamese')) return '🇻🇳';
  if (c === 'ind' || c === 'id' || n.includes('indonesian')) return '🇮🇩';
  if (c === 'tha' || c === 'th' || n.includes('thai')) return '🇹🇭';
  if (c === 'pol' || c === 'pl' || n.includes('polish')) return '🇵🇱';
  if (c === 'dut' || c === 'nld' || c === 'nl' || n.includes('dutch')) return '🇳🇱';
  if (c === 'swe' || c === 'sv' || n.includes('swedish')) return '🇸🇪';
  if (c === 'nor' || c === 'no' || n.includes('norwegian')) return '🇳🇴';
  if (c === 'dan' || c === 'da' || n.includes('danish')) return '🇩🇰';
  if (c === 'fin' || c === 'fi' || n.includes('finnish')) return '🇫🇮';
  if (c === 'gre' || c === 'ell' || c === 'el' || n.includes('greek')) return '🇬🇷';
  if (c === 'heb' || c === 'he' || n.includes('hebrew')) return '🇮🇱';
  if (c === 'tam' || c === 'ta' || n.includes('tamil')) return '🇮🇳';
  if (c === 'tel' || c === 'te' || n.includes('telugu')) return '🇮🇳';
  if (c === 'mal' || c === 'ml' || n.includes('malayalam')) return '🇮🇳';
  if (c === 'kan' || c === 'kn' || n.includes('kannada')) return '🇮🇳';
  if (c === 'ben' || c === 'bn' || n.includes('bengali')) return '🇧🇩';
  if (c === 'mar' || c === 'mr' || n.includes('marathi')) return '🇮🇳';
  if (c === 'guj' || c === 'gu' || n.includes('gujarati')) return '🇮🇳';
  if (c === 'urd' || c === 'ur' || n.includes('urdu')) return '🇵🇰';
  if (c === 'fas' || c === 'per' || c === 'fa' || n.includes('persian') || n.includes('farsi')) return '🇮🇷';
  if (c === 'tgl' || c === 'fil' || c === 'tl' || n.includes('tagalog') || n.includes('filipino')) return '🇵🇭';
  if (c === 'msa' || c === 'may' || c === 'ms' || n.includes('malay')) return '🇲🇾';
  if (c === 'ron' || c === 'rum' || c === 'ro' || n.includes('romanian')) return '🇷🇴';
  if (c === 'ces' || c === 'cze' || c === 'cs' || n.includes('czech')) return '🇨🇿';
  if (c === 'hun' || c === 'hu' || n.includes('hungarian')) return '🇭🇺';
  if (c === 'ukr' || c === 'uk' || n.includes('ukrainian')) return '🇺🇦';
  return '🌐';
}

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
  onSelect: (url: string | null, label: string, detail?: string) => void;
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
      const detail = `saved · ${entry.origin === 'opensubtitles' ? 'OpenSubtitles' : 'from source'}`;
      onSelect(URL.createObjectURL(new Blob([response.vtt], { type: 'text/vtt' })), entry.langName, detail);
      onClose();
    },
    [onSelect, onClose, refreshSaved]
  );
  const [applying, setApplying] = useState<string | null>(null);

  // In-player subtitle style configuration & compact language selector state
  const [showConfig, setShowConfig] = useState(false);
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const [style, setStyle] = useState<SubtitleStyle>(DEFAULT_SUBTITLE_STYLE);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const stored = await window.cloudstream?.getPlayerPreferences();
      if (cancelled || !stored?.ok) return;
      const p = stored.preferences;
      setStyle({
        scale: p.subtitleScale ?? DEFAULT_SUBTITLE_STYLE.scale,
        color: p.subtitleColor ?? DEFAULT_SUBTITLE_STYLE.color,
        background: p.subtitleBackground ?? DEFAULT_SUBTITLE_STYLE.background,
        weight: p.subtitleWeight ?? DEFAULT_SUBTITLE_STYLE.weight,
        position: p.subtitlePosition ?? DEFAULT_SUBTITLE_STYLE.position,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const updateStyle = (patch: Partial<SubtitleStyle>) => {
    const next = { ...style, ...patch };
    setStyle(next);
    void window.cloudstream?.setPlayerPreferences({
      subtitleScale: next.scale,
      subtitleColor: next.color,
      subtitleBackground: next.background,
      subtitleWeight: next.weight,
      subtitlePosition: next.position,
    });
  };

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

  // Track if the user has manually edited or is currently typing in the search box
  const userEditedRef = useRef(false);
  const userTypingRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Sync state when props change, guarded by ref so active typing isn't wiped
  const prevPropsRef = useRef({ title, imdbId, season, episode, year });
  useEffect(() => {
    const prev = prevPropsRef.current;
    const changed =
      prev.title !== title ||
      prev.imdbId !== imdbId ||
      prev.season !== season ||
      prev.episode !== episode ||
      prev.year !== year;
    prevPropsRef.current = { title, imdbId, season, episode, year };
    if (!changed) return;

    // Never overwrite what the user is actively typing or has edited
    if (userEditedRef.current || userTypingRef.current) return;

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
      const detailParts = [
        result.best ? '★ Best' : undefined,
        result.releaseName || result.fileName?.replace(/\.(srt|ass|ssa|vtt|sub)$/i, ''),
        result.hearingImpaired ? 'HI' : undefined,
        originLabel(result),
      ].filter(Boolean);
      const detail = detailParts.join(' · ');
      onSelect(URL.createObjectURL(blob), result.langName, detail);
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

  const englishChip = languageChips.find((c) => c.code === 'eng');
  const activeOtherChips = languageChips.filter((c) => c.code !== 'eng' && languages.includes(c.code));
  const dropdownChips = languageChips.filter((c) => c.code !== 'eng');

  return (
    <aside
      className="player-panel player-panel--subtitles"
      aria-label="Subtitles"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
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
            type="button"
            className={`icon-button subtitle-panel__config-btn${showConfig ? ' active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setShowConfig((v) => !v);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            title={showConfig ? 'Hide subtitle appearance settings' : 'Subtitle style & appearance settings'}
            aria-label="Subtitle appearance settings"
          >
            <Sliders size={18} />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={(e) => {
              e.stopPropagation();
              void runSearch();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            disabled={loading}
            title="Search again"
            aria-label="Search subtitles again"
          >
            {loading ? <Loader2 className="spin" size={18} /> : <Search size={18} />}
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            aria-label="Close subtitles"
          >
            <X size={18} />
          </button>
        </div>
      </header>

      {/* In-player Subtitle Appearance Settings Drawer */}
      {showConfig && (
        <div
          className="subtitle-panel__config-panel"
          role="region"
          aria-label="Subtitle appearance settings"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="subtitle-panel__config-header">
            <span className="subtitle-panel__config-title">Subtitle Appearance</span>
            <button
              type="button"
              className="subtitle-panel__config-close"
              onClick={(e) => {
                e.stopPropagation();
                setShowConfig(false);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              aria-label="Close subtitle settings"
            >
              <X size={14} />
            </button>
          </div>

          {/* Live Preview */}
          <div className="sub-preview" style={subtitleCssVariables(style) as React.CSSProperties}>
            <span className="sub-preview__cue">
              They're not going to make it. We should go back.
            </span>
          </div>

          {/* Size */}
          <div className="subtitle-panel__config-row subtitle-panel__config-row-stacked">
            <div className="subtitle-panel__config-label-row">
              <span>Size</span>
              <span className="subtitle-panel__config-val">{Math.round(style.scale * 100)}%</span>
            </div>
            <div className="sub-choices">
              {SUBTITLE_SCALES.map((scale) => (
                <button
                  key={scale}
                  type="button"
                  className={`btn btn-secondary sub-choice${style.scale === scale ? ' sub-choice--on' : ''}`}
                  onClick={() => updateStyle({ scale })}
                >
                  {Math.round(scale * 100)}%
                </button>
              ))}
            </div>
          </div>

          {/* Colour */}
          <div className="subtitle-panel__config-row subtitle-panel__config-row-stacked">
            <div className="subtitle-panel__config-label-row">
              <span>Colour</span>
              <span className="subtitle-panel__config-val">
                {SUBTITLE_COLORS.find((c) => c.value.toLowerCase() === style.color.toLowerCase())?.label ?? style.color}
              </span>
            </div>
            <div className="sub-choices">
              {SUBTITLE_COLORS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`sub-swatch${style.color.toLowerCase() === option.value.toLowerCase() ? ' sub-swatch--on' : ''}`}
                  style={{ background: option.value }}
                  title={option.label}
                  aria-label={option.label}
                  aria-pressed={style.color.toLowerCase() === option.value.toLowerCase()}
                  onClick={() => updateStyle({ color: option.value })}
                />
              ))}
            </div>
          </div>

          {/* Background */}
          <div className="subtitle-panel__config-row subtitle-panel__config-row-stacked">
            <div className="subtitle-panel__config-label-row">
              <span>Background</span>
              <span className="subtitle-panel__config-val">
                {SUBTITLE_BACKGROUNDS.find((b) => b.value === style.background)?.label}
              </span>
            </div>
            <div className="sub-choices">
              {SUBTITLE_BACKGROUNDS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`btn btn-secondary sub-choice${style.background === option.value ? ' sub-choice--on' : ''}`}
                  title={option.hint}
                  onClick={() => updateStyle({ background: option.value as SubtitleBackground })}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {/* Bold weight */}
          <div className="subtitle-panel__config-row">
            <span>Bold text</span>
            <label className="toggle">
              <input
                type="checkbox"
                checked={style.weight === 'bold'}
                onChange={(e) => updateStyle({ weight: e.target.checked ? 'bold' : 'normal' })}
              />
              <span>{style.weight === 'bold' ? 'On' : 'Off'}</span>
            </label>
          </div>

          {/* Vertical Lift / Position */}
          <div className="subtitle-panel__config-row subtitle-panel__config-row-stacked">
            <div className="subtitle-panel__config-label-row">
              <span>Raise from bottom</span>
              <span className="subtitle-panel__config-val">
                {style.position === 0 ? 'Default position' : `${style.position}% up`}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={40}
              step={5}
              value={style.position}
              onChange={(e) => updateStyle({ position: Number(e.target.value) })}
              className="subtitle-panel__range"
            />
          </div>

          {/* Reset */}
          <div className="subtitle-panel__config-footer">
            <button
              type="button"
              className="btn btn-secondary sub-choice"
              onClick={() => updateStyle(DEFAULT_SUBTITLE_STYLE)}
            >
              Reset appearance
            </button>
          </div>
        </div>
      )}

      {/* Custom Subtitle Search Form */}
      <form
        className="subtitle-panel__search-form"
        onSubmit={handleSearchSubmit}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          className="subtitle-panel__search-bar"
          onClick={() => searchInputRef.current?.focus()}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <Search size={14} style={{ flexShrink: 0, opacity: 0.6 }} />
          <input
            ref={searchInputRef}
            type="text"
            className="subtitle-panel__search-input"
            value={searchQuery}
            onChange={(e) => {
              userEditedRef.current = true;
              setSearchQuery(e.target.value);
            }}
            onFocus={() => {
              userTypingRef.current = true;
            }}
            onBlur={() => {
              userTypingRef.current = false;
            }}
            onKeyDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            placeholder="Search custom title or IMDb ID (tt...)"
            aria-label="Custom subtitle search query"
          />
          {searchQuery && (
            <button
              type="button"
              className="subtitle-panel__search-btn"
              onClick={(e) => {
                e.stopPropagation();
                userEditedRef.current = true;
                setSearchQuery('');
                searchInputRef.current?.focus();
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
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
              onClick={(e) => {
                e.stopPropagation();
                userEditedRef.current = false;
                setSearchQuery(title);
                void runSearch(title);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
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
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            title="Search subtitles"
            aria-label="Search"
          >
            {loading ? <Loader2 className="spin" size={14} /> : <Search size={14} />}
          </button>
        </div>

        <div
          className="subtitle-panel__ep-inputs"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="subtitle-panel__ep-field">
            <span>Season:</span>
            <input
              type="number"
              min="1"
              className="subtitle-panel__ep-input"
              value={searchSeason}
              placeholder="S#"
              onChange={(e) => {
                userEditedRef.current = true;
                setSearchSeason(e.target.value);
              }}
              onFocus={() => {
                userTypingRef.current = true;
              }}
              onBlur={() => {
                userTypingRef.current = false;
              }}
              onKeyDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
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
              onChange={(e) => {
                userEditedRef.current = true;
                setSearchEpisode(e.target.value);
              }}
              onFocus={() => {
                userTypingRef.current = true;
              }}
              onBlur={() => {
                userTypingRef.current = false;
              }}
              onKeyDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
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
              onChange={(e) => {
                userEditedRef.current = true;
                setSearchYear(e.target.value);
              }}
              onFocus={() => {
                userTypingRef.current = true;
              }}
              onBlur={() => {
                userTypingRef.current = false;
              }}
              onKeyDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              aria-label="Release year"
            />
          </div>
          <button
            type="submit"
            className="subtitle-panel__search-submit-btn"
            disabled={loading || !searchQuery.trim()}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>
      </form>

      {/* Language filter row with flags, primary choices (All, English, Active), and collapsible dropdown */}
      <div className="subtitle-panel__languages" role="group" aria-label="Subtitle languages">
        <button
          type="button"
          className={`subtitle-panel__chip${languages.length === 0 ? ' subtitle-panel__chip--on' : ''}`}
          onClick={() => setLanguages([])}
        >
          <span className="subtitle-panel__chip-flag">🌐</span>
          All{results.length > 0 ? ` (${results.length})` : ''}
        </button>

        {/* English chip (always offered as top option) */}
        {englishChip && (
          <button
            type="button"
            className={`subtitle-panel__chip${languages.includes(englishChip.code) ? ' subtitle-panel__chip--on' : ''}`}
            onClick={() =>
              setLanguages((current) =>
                current.includes(englishChip.code)
                  ? current.filter((c) => c !== englishChip.code)
                  : [...current, englishChip.code]
              )
            }
            aria-pressed={languages.includes(englishChip.code)}
          >
            <span className="subtitle-panel__chip-flag">🇬🇧</span>
            {englishChip.name}
            {englishChip.count > 0 ? ` (${englishChip.count})` : ''}
          </button>
        )}

        {/* Active chips that aren't English */}
        {activeOtherChips.map(({ code, name, count }) => (
          <button
            key={code}
            type="button"
            className="subtitle-panel__chip subtitle-panel__chip--on"
            onClick={() => setLanguages((current) => current.filter((c) => c !== code))}
            aria-pressed="true"
          >
            <span className="subtitle-panel__chip-flag">{getLanguageFlag(code, name)}</span>
            {name}
            {count > 0 ? ` (${count})` : ''}
          </button>
        ))}

        {/* Expand / Collapse toggle for remaining languages */}
        {dropdownChips.length > 0 && (
          <button
            type="button"
            className={`subtitle-panel__lang-toggle${langMenuOpen ? ' subtitle-panel__lang-toggle--open' : ''}`}
            onClick={() => setLangMenuOpen((v) => !v)}
            aria-expanded={langMenuOpen}
            aria-label="Show more subtitle languages"
          >
            <span>{langMenuOpen ? 'Fewer languages' : `More languages (${dropdownChips.length})`}</span>
            {langMenuOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        )}

        {/* Collapsible Dropdown Grid */}
        {langMenuOpen && dropdownChips.length > 0 && (
          <div className="subtitle-panel__languages-dropdown" role="group" aria-label="More subtitle languages">
            {dropdownChips.map(({ code, name, count }) => {
              const on = languages.includes(code);
              return (
                <button
                  key={code}
                  type="button"
                  className={`subtitle-panel__chip${on ? ' subtitle-panel__chip--on' : ''}`}
                  onClick={() =>
                    setLanguages((current) =>
                      on ? current.filter((c) => c !== code) : [...current, code]
                    )
                  }
                  aria-pressed={on}
                >
                  <span className="subtitle-panel__chip-flag">{getLanguageFlag(code, name)}</span>
                  {name}
                  {count > 0 ? ` (${count})` : ''}
                </button>
              );
            })}
          </div>
        )}
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
                onSelect(sub.url, sub.name, 'in stream');
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
