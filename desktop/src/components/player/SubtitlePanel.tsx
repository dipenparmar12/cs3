import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  X,
  Search,
  Loader2,
  Check,
  AlertTriangle,
  CheckCircle2,
  Download,
  RotateCcw,
  Star,
  Sliders,
  ChevronDown,
  ChevronUp,
  Subtitles,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Move,
} from 'lucide-react';
import type { SavedSubtitle } from '../../../electron/subtitles/subtitleLibrary';
import type { SubtitleFindResult, SubtitleSearchResult } from '../../../electron/subtitleService';
import {
  DEFAULT_SUBTITLE_STYLE,
  SUBTITLE_BACKGROUNDS,
  SUBTITLE_COLORS,
  SUBTITLE_LINE_HEIGHTS,
  SUBTITLE_PRESETS,
  SUBTITLE_SCALES,
  isAssSubtitleTrack,
  isBitmapSubtitleTrack,
  subtitleCssVariables,
  type SubtitleBackground,
  type SubtitleHorizontalAlign,
  type SubtitleStyle,
} from '../../utils/subtitleStyle';
import { SubtitleSyncSlider } from './SubtitleSyncSlider';
import { getLanguageFlag, getLanguageName } from '../../utils/languageFlag';
import { describeError } from '../../utils/errors';
import { FlagIcon } from '../FlagIcon';
import { orderLanguageChips, preferredLanguageKeys } from '../../utils/subtitleLanguageOrder';
import { Globe } from 'lucide-react';
import { InfoHint } from '../settings/InfoHint';

export { getLanguageFlag, getLanguageName };

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
  /** Current video playback position in seconds (used for audio-cue bookmark calibration). */
  currentTime?: number;
  /** Active cue start time in seconds if available. */
  activeCueStartTime?: number;
  /** Live callback when appearance or position changes so VideoPlayer updates immediately. */
  onStyleChange?: (next: SubtitleStyle) => void;
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
  currentTime,
  activeCueStartTime,
  onStyleChange,
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

  // In-player subtitle panel section tabs & advanced appearance disclosure
  type PanelTab = 'tracks' | 'sync' | 'position' | 'appearance';
  const [panelTab, setPanelTab] = useState<PanelTab>('tracks');
  const [advancedAppearanceOpen, setAdvancedAppearanceOpen] = useState(false);
  const [langMenuOpen, setLangMenuOpen] = useState(false);

  const activeTrackName = embedded.find((s) => s.url === activeUrl)?.name;
  const isBitmapTrack = isBitmapSubtitleTrack(activeTrackName);
  const isAssTrack = isAssSubtitleTrack(activeTrackName);
  /**
   * The languages of the regions the viewer picked (PRD-54), which order the
   * language list: English, then these, then the rest. Asked when the panel
   * opens; a failure just means the plain order.
   */
  const [regionLanguages, setRegionLanguages] = useState<string[]>([]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    void window.cloudstream
      ?.getRegions?.()
      .then((state) => {
        if (!active || !state || state.selected.includes('ALL' as never)) return;
        setRegionLanguages(
          state.regions
            .filter((region) => state.selected.includes(region.id))
            .flatMap((region) => region.languages)
        );
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [open]);
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

  useEffect(() => {
    const unsubscribe = window.cloudstream?.onPlayerPreferencesChanged?.((p) => {
      setStyle({
        scale: p.subtitleScale ?? DEFAULT_SUBTITLE_STYLE.scale,
        color: p.subtitleColor ?? DEFAULT_SUBTITLE_STYLE.color,
        background: p.subtitleBackground ?? DEFAULT_SUBTITLE_STYLE.background,
        weight: p.subtitleWeight ?? DEFAULT_SUBTITLE_STYLE.weight,
        position: p.subtitlePosition ?? DEFAULT_SUBTITLE_STYLE.position,
      });
    });
    return () => {
      unsubscribe?.();
    };
  }, []);

  const updateStyle = (patch: Partial<SubtitleStyle>) => {
    const next = { ...style, ...patch };
    setStyle(next);
    onStyleChange?.(next);
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
        setError(describeError(err));
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
    return orderLanguageChips([...chips.values()], preferredLanguageKeys(regionLanguages));
  })();
  const showLanguage = (name: string) => languages.length === 0 || languages.includes(codeFor.get(name) ?? '');

  /*
   * The first few in preference order stay on the row — English and the
   * viewer's region languages — plus anything selected; the rest are one
   * click away under "More".
   */
  const INLINE_CHIPS = 4;
  const inlineChips = languageChips.filter((c, index) => index < INLINE_CHIPS || languages.includes(c.code));
  const dropdownChips = languageChips.filter((c) => !inlineChips.includes(c));
  const flagFor = (code: string, name: string) => (
    <FlagIcon flag={getLanguageFlag(code, name)} fallback={code || name.slice(0, 2)} size={18} className="subtitle-panel__flag" />
  );

  return (
    <aside
      className="player-panel player-panel--subtitles"
      aria-label="Subtitles"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <header className="player-panel__head">
        <div>
          <div className="player-panel__title-row">
            <Subtitles size={18} className="player-panel__head-icon" aria-hidden="true" />
            <h3>Subtitles</h3>
          </div>
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
            className={`icon-button subtitle-panel__config-btn${panelTab === 'appearance' ? ' active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setPanelTab((prev) => (prev === 'appearance' ? 'tracks' : 'appearance'));
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            title={panelTab === 'appearance' ? 'Back to tracks' : 'Subtitle style & appearance settings'}
            aria-label="Subtitle appearance settings"
          >
            <Sliders size={18} />
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

      <div className="subtitle-panel__tabs" role="tablist" aria-label="Subtitle sections">
        {([
          { id: 'tracks', label: 'Tracks' },
          { id: 'sync', label: delay !== 0 ? `Sync (${delay > 0 ? '+' : ''}${Math.round(delay * 1000)}ms)` : 'Sync' },
          { id: 'position', label: 'Position' },
          { id: 'appearance', label: 'Appearance' },
        ] as const).map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={panelTab === t.id}
            className={`subtitle-panel__tab${panelTab === t.id ? ' subtitle-panel__tab--on' : ''}`}
            onClick={() => setPanelTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {panelTab === 'sync' && (
        <div className="subtitle-panel__section" role="tabpanel" aria-label="Subtitle timing synchronisation">
          <SubtitleSyncSlider
            delay={delay}
            onDelayChange={onDelayChange}
            currentTime={currentTime}
            activeCueStartTime={activeCueStartTime}
          />
        </div>
      )}

      {panelTab === 'position' && (
        <div className="subtitle-panel__section" role="tabpanel" aria-label="Subtitle positioning">
          {isBitmapTrack && (
            <div className="subtitle-panel__capability-note" role="status">
              <AlertTriangle size={14} aria-hidden />
              <span>Bitmap subtitle (PGS / VOBSUB): appearance &amp; free positioning are locked.</span>
            </div>
          )}
          {!isBitmapTrack && isAssTrack && (
            <div className="subtitle-panel__capability-note" role="status">
              <span>ASS/SSA track: embedded script coordinates may take precedence.</span>
            </div>
          )}

          <div className="subtitle-panel__config-row subtitle-panel__config-row-stacked">
            <div className="subtitle-panel__config-label-row">
              <span>Horizontal alignment</span>
              <span className="subtitle-panel__config-val">
                {(style.horizontalAlign ?? 'center').replace(/^./, (c) => c.toUpperCase())}
              </span>
            </div>
            <div className="sub-choices" role="group" aria-label="Horizontal alignment">
              {([
                { value: 'left', label: 'Left', Icon: AlignLeft },
                { value: 'center', label: 'Center', Icon: AlignCenter },
                { value: 'right', label: 'Right', Icon: AlignRight },
              ] as const).map(({ value, label, Icon }) => (
                <button
                  key={value}
                  type="button"
                  disabled={isBitmapTrack}
                  className={`sub-choice${(style.horizontalAlign ?? 'center') === value ? ' sub-choice--on' : ''}`}
                  aria-pressed={(style.horizontalAlign ?? 'center') === value}
                  onClick={() =>
                    updateStyle({
                      horizontalAlign: value as SubtitleHorizontalAlign,
                      positionX: value === 'left' ? 0.1 : value === 'right' ? 0.9 : 0.5,
                    })
                  }
                >
                  <Icon size={13} aria-hidden /> {label}
                </button>
              ))}
            </div>
          </div>

          <div className="subtitle-panel__config-row subtitle-panel__config-row-stacked">
            <div className="subtitle-panel__config-label-row">
              <span>Vertical lift</span>
              <span className="subtitle-panel__config-val">
                {style.position === 0 ? 'Bottom default (0%)' : `${style.position}% up`}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={90}
              step={2}
              disabled={isBitmapTrack}
              value={style.position}
              onChange={(e) => updateStyle({ position: Number(e.target.value) })}
              className="subtitle-panel__range"
              aria-label="Vertical subtitle position"
            />
          </div>

          <div className="subtitle-panel__drag-hint">
            <Move size={13} aria-hidden />
            <span>Tip: Hold on the subtitle text over the video for 2 seconds to drag it freely.</span>
          </div>

          <div className="subtitle-panel__config-footer">
            <button
              type="button"
              className="sub-choice"
              disabled={isBitmapTrack}
              onClick={() => updateStyle({ position: 0, horizontalAlign: 'center', positionX: 0.5 })}
            >
              Reset position
            </button>
          </div>
        </div>
      )}

      {panelTab === 'appearance' && (
        <div
          className="subtitle-panel__config-panel"
          role="tabpanel"
          aria-label="Subtitle appearance settings"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {isBitmapTrack && (
            <div className="subtitle-panel__capability-note" role="status">
              <AlertTriangle size={14} aria-hidden />
              <span>Bitmap subtitle (PGS / VOBSUB): styling overrides are disabled.</span>
            </div>
          )}

          {/* Presets */}
          <div className="subtitle-panel__config-row subtitle-panel__config-row-stacked">
            <div className="subtitle-panel__config-label-row">
              <span>Quick presets</span>
            </div>
            <div className="sub-presets">
              {SUBTITLE_PRESETS.map((preset) => {
                const active =
                  preset.patch.color?.toLowerCase() === style.color.toLowerCase() &&
                  preset.patch.background === style.background &&
                  (preset.patch.weight ?? style.weight) === style.weight;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    disabled={isBitmapTrack}
                    className={`sub-preset${active ? ' sub-preset--on' : ''}`}
                    title={preset.description}
                    onClick={() => updateStyle(preset.patch)}
                  >
                    <span className="sub-preset__name">{preset.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Live WYSIWYG Preview against split dark/light checkerboard */}
          <div
            className="sub-preview sub-preview--split"
            style={subtitleCssVariables(style) as React.CSSProperties}
          >
            <span className="sub-preview__cue">
              The quick brown fox jumps over the lazy dog.
              <br />
              Synchronized at 23.976 fps.
            </span>
          </div>

          {/* Font Scale */}
          <div className="subtitle-panel__config-row subtitle-panel__config-row-stacked">
            <div className="subtitle-panel__config-label-row">
              <span>Text size</span>
              <span className="subtitle-panel__config-val">{style.scale.toFixed(2).replace(/\.?0+$/, '')}x</span>
            </div>
            <input
              type="range"
              min={0.75}
              max={2.0}
              step={0.05}
              disabled={isBitmapTrack}
              value={style.scale}
              onChange={(e) => updateStyle({ scale: Number(e.target.value) })}
              className="subtitle-panel__range"
              aria-label="Subtitle size"
            />
            <div className="sub-choices--compact" role="group" aria-label="Quick size presets">
              {SUBTITLE_SCALES.map((scale) => (
                <button
                  key={scale}
                  type="button"
                  disabled={isBitmapTrack}
                  className={`sub-chip${Math.abs(style.scale - scale) < 0.01 ? ' sub-chip--on' : ''}`}
                  onClick={() => updateStyle({ scale })}
                >
                  {Math.round(scale * 100)}%
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            className="sub-sync__cal-toggle"
            aria-expanded={advancedAppearanceOpen}
            onClick={() => setAdvancedAppearanceOpen((v) => !v)}
          >
            {advancedAppearanceOpen ? <ChevronUp size={13} aria-hidden /> : <ChevronDown size={13} aria-hidden />}
            <span>Advanced appearance options</span>
          </button>

          {advancedAppearanceOpen && (
            <div className="sub-advanced">
              {/* Colour */}
              <div className="subtitle-panel__config-row subtitle-panel__config-row-stacked">
                <div className="subtitle-panel__config-label-row">
                  <span>Text colour</span>
                  <span className="subtitle-panel__config-val">
                    {SUBTITLE_COLORS.find((c) => c.value.toLowerCase() === style.color.toLowerCase())?.label ?? style.color}
                  </span>
                </div>
                <div className="sub-choices">
                  {SUBTITLE_COLORS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      disabled={isBitmapTrack}
                      className={`sub-swatch${style.color.toLowerCase() === option.value.toLowerCase() ? ' sub-swatch--on' : ''}`}
                      style={{ background: option.value }}
                      title={option.label}
                      aria-label={option.label}
                      aria-pressed={style.color.toLowerCase() === option.value.toLowerCase()}
                      onClick={() => updateStyle({ color: option.value })}
                    />
                  ))}
                  <input
                    type="color"
                    disabled={isBitmapTrack}
                    value={style.color}
                    onChange={(e) => updateStyle({ color: e.target.value })}
                    aria-label="Custom subtitle text colour"
                    className="sub-color-input"
                  />
                </div>
              </div>

              {/* Background */}
              <div className="subtitle-panel__config-row subtitle-panel__config-row-stacked">
                <div className="subtitle-panel__config-label-row">
                  <span>Background mode</span>
                  <span className="subtitle-panel__config-val">
                    {SUBTITLE_BACKGROUNDS.find((b) => b.value === style.background)?.label}
                  </span>
                </div>
                <div className="sub-choices">
                  {SUBTITLE_BACKGROUNDS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      disabled={isBitmapTrack}
                      className={`sub-choice${style.background === option.value ? ' sub-choice--on' : ''}`}
                      title={option.hint}
                      onClick={() => updateStyle({ background: option.value as SubtitleBackground })}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              {style.background === 'box' && (
                <div className="subtitle-panel__config-row subtitle-panel__config-row-stacked">
                  <div className="subtitle-panel__config-label-row">
                    <span>Box opacity</span>
                    <span className="subtitle-panel__config-val">{Math.round((style.boxOpacity ?? 0.75) * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    disabled={isBitmapTrack}
                    value={style.boxOpacity ?? 0.75}
                    onChange={(e) => updateStyle({ boxOpacity: Number(e.target.value) })}
                    className="subtitle-panel__range"
                    aria-label="Box background opacity"
                  />
                </div>
              )}

              {/* Line spacing */}
              <div className="subtitle-panel__config-row subtitle-panel__config-row-stacked">
                <div className="subtitle-panel__config-label-row">
                  <span>Line spacing</span>
                </div>
                <div className="sub-choices">
                  {SUBTITLE_LINE_HEIGHTS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={isBitmapTrack}
                      className={`sub-choice${Math.abs((style.lineHeight ?? 1.3) - opt.value) < 0.05 ? ' sub-choice--on' : ''}`}
                      onClick={() => updateStyle({ lineHeight: opt.value })}
                    >
                      {opt.label}
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
                    disabled={isBitmapTrack}
                    checked={style.weight === 'bold'}
                    onChange={(e) => updateStyle({ weight: e.target.checked ? 'bold' : 'normal' })}
                  />
                  <span>{style.weight === 'bold' ? 'On' : 'Off'}</span>
                </label>
              </div>
            </div>
          )}

          {/* Reset */}
          <div className="subtitle-panel__config-footer">
            <button
              type="button"
              className="sub-choice"
              disabled={isBitmapTrack}
              onClick={() => updateStyle(DEFAULT_SUBTITLE_STYLE)}
            >
              Reset appearance
            </button>
          </div>
        </div>
      )}

      {panelTab === 'tracks' && (
      <>

      {/* What this video already has — the choice made most often — before searching. */}
      <div className="player-panel__sub-heading subtitle-panel__current-heading">On this video</div>
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

        {embedded.map((sub) => {
          return (
            <li key={sub.url}>
              <button
                className={`player-panel__sub${activeUrl === sub.url ? ' player-panel__sub--current' : ''}`}
                onClick={() => {
                  onSelect(sub.url, sub.name, (sub as { detail?: string }).detail);
                  onClose();
                }}
              >
                {flagFor('', sub.name)}
                <span className="player-panel__sub-label">{sub.name}</span>
                {(sub as { detail?: string }).detail && (
                  <span className="player-panel__sub-tag">{(sub as { detail?: string }).detail}</span>
                )}
                {activeUrl === sub.url && <Check size={14} />}
              </button>
            </li>
          );
        })}
      </ul>


      <div className="player-panel__sub-heading subtitle-panel__current-heading">Find more</div>
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
            placeholder="Search by title or IMDb ID (tt…)"
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
        </div>
      </form>

      {/* Language filter row with flags, primary choices (All, English, Active), and collapsible dropdown */}
      <div className="subtitle-panel__languages" role="group" aria-label="Subtitle languages">
        <button
          type="button"
          className={`subtitle-panel__chip${languages.length === 0 ? ' subtitle-panel__chip--on' : ''}`}
          onClick={() => setLanguages([])}
        >
          <Globe size={14} aria-hidden className="subtitle-panel__flag" />
          All{results.length > 0 ? ` (${results.length})` : ''}
        </button>

        {inlineChips.map(({ code, name, count }) => {
          const on = languages.includes(code);
          return (
            <button
              key={code}
              type="button"
              className={`subtitle-panel__chip${on ? ' subtitle-panel__chip--on' : ''}`}
              onClick={() =>
                setLanguages((current) => (on ? current.filter((c) => c !== code) : [...current, code]))
              }
              aria-pressed={on}
            >
              {flagFor(code, name)}
              {name}
              {count > 0 ? ` (${count})` : ''}
            </button>
          );
        })}

        {/* Expand / Collapse toggle for remaining languages */}
        {dropdownChips.length > 0 && (
          <button
            type="button"
            className={`subtitle-panel__lang-toggle${langMenuOpen ? ' subtitle-panel__lang-toggle--open' : ''}`}
            onClick={() => setLangMenuOpen((v) => !v)}
            aria-expanded={langMenuOpen}
            aria-label="Show more subtitle languages"
          >
            <span>{langMenuOpen ? 'Fewer' : `More (${dropdownChips.length})`}</span>
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
                  {flagFor(code, name)}
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

      {delay !== 0 && (
        <div className="subtitle-panel__sync" aria-label="Subtitle timing">
          <span>Timing</span>
          <output>
            {delay > 0 ? '+' : ''}
            {Math.round(delay * 1000)} ms
          </output>
          <button
            type="button"
            className="subtitle-panel__sync-reset"
            onClick={() => setPanelTab('sync')}
          >
            Adjust
          </button>
          <button type="button" className="subtitle-panel__sync-reset" onClick={() => onDelayChange(0)}>
            Reset
          </button>
        </div>
      )}

      {saved.length > 0 && (
        <div className="player-panel__sub-group">
          <div className="player-panel__sub-heading">Saved on this computer</div>
          <ul className="player-panel__subs">
            {saved.map((entry) => {
              return (
                <li key={entry.id}>
                  <button
                    className="player-panel__sub"
                    onClick={() => void applySaved(entry)}
                    title={entry.filePath}
                  >
                    {flagFor(entry.lang, entry.langName)}
                    <span className="player-panel__sub-label">{entry.langName}</span>
                    <span className="player-panel__sub-tag">
                      saved · {entry.origin === 'opensubtitles' ? 'OpenSubtitles' : 'from source'}
                    </span>
                  </button>
                </li>
              );
            })}
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
        .map(([language, items]) => {
          return (
            <div key={language} className="player-panel__sub-group">
              <div className="player-panel__sub-heading">
                {flagFor(codeFor.get(language) || '', language)}
                <span>{language}</span>
              </div>
              <ul className="player-panel__subs">
                {items.map((item, index) => {
                  const state = downloads[item.id];
                  return (
                    <li key={item.id} className="subtitle-panel__row">
                      <button
                        className="player-panel__sub subtitle-panel__result"
                        onClick={() => applySubtitle(item)}
                        disabled={applying !== null}
                        aria-label={`${rowLabel(item, `${language}${items.length > 1 ? ` #${index + 1}` : ''}`)}${
                          item.best ? ', recommended for what is playing' : ''
                        }`}
                      >
                        {applying === item.id ? (
                          <Loader2 className="spin" size={13} />
                        ) : (
                          flagFor(item.lang, item.langName || item.fileName || item.releaseName || '')
                        )}
                        <span className="subtitle-panel__result-text">
                          <span className="player-panel__sub-label">
                            {rowLabel(item, `${language}${items.length > 1 ? ` #${index + 1}` : ''}`)}
                          </span>
                        </span>
                        {/* The few facts worth seeing at a glance; the rest is behind ⓘ (PRD §119.1). */}
                        {item.hearingImpaired && (
                          <span className="subtitle-panel__tag" title="Includes sound descriptions">
                            HI
                          </span>
                        )}
                        {/* A recommendation from release and episode matching — not a
                            promise that it is in sync, so it says no more than that. */}
                        {item.best && (
                          <span className="subtitle-panel__star" title="Recommended: the closest match to what is playing">
                            <Star size={12} fill="currentColor" aria-hidden="true" />
                          </span>
                        )}
                      </button>
                      <InfoHint label="Subtitle details">
                        <span className="subtitle-panel__details">
                          {(item.fileName || item.releaseName) && (
                            <span className="subtitle-panel__details-name">{item.fileName || item.releaseName}</span>
                          )}
                          {item.best && <span>Closest match to what is playing</span>}
                          {item.matchReasons?.length ? <span>{item.matchReasons.join(' · ')}</span> : null}
                          <span>From {originLabel(item)}</span>
                          {item.downloads || item.rating ? (
                            <span>
                              {[
                                item.downloads ? `${compactCount(item.downloads)} downloads` : '',
                                item.rating ? `rated ${item.rating.toFixed(1)}` : '',
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          ) : null}
                          {item.hearingImpaired && <span>Includes sound descriptions (HI)</span>}
                          {item.machineTranslated && <span>Machine translated</span>}
                        </span>
                      </InfoHint>
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
        );
      })}
      </>
      )}
    </aside>
  );
};
