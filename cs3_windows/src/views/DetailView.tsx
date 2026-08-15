import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Play, ArrowLeft, Loader2, AlertTriangle, ListVideo,
} from 'lucide-react';
import type { SearchResponse, Episode } from '../types/api';
import { TvType } from '../types/api';
import { DownloadState } from '../types/download';
import type { DownloadTask } from '../types/download';
import type { TorrentResult } from '../types/torrent';
import { SourcePicker, type SourcePickerData } from '../components/SourcePicker';
import {
  episodeKey,
  type EpisodeWatchState,
  type SeriesContext,
} from '../components/player/seriesContext';
import { SeasonDownloadDialog } from '../components/SeasonDownloadDialog';
import { LibraryBucketSelector } from '../components/LibraryBucketSelector';
import { CopyErrorButton } from '../components/CopyErrorButton';
import { DetailHero, type DetailHeroProvenance } from '../components/detail/DetailHero';
import type { PrefetchState } from '../../electron/cs3/sourcePrefetcher';

export interface PlaybackRequest {
  streamUrl: string;
  mimeType: string;
  title: string;
  episodeTitle?: string;
  infoHash: string;
  subtitles: Array<{ name: string; url: string }>;
  /** Series context, so the player can show episodes and offer next/previous. */
  series?: SeriesContext;
  /** Identity for recording watch progress, and where to resume from. */
  progress?: {
    mediaUrl: string;
    year?: number;
    posterUrl?: string;
    season?: number;
    episode?: number;
    resumeAt?: number;
  };
  /**
   * Switches episode without leaving the player.
   *
   * Supplied by this view because it owns source resolution. The player asks
   * for an episode; resolving a source for it and restarting the stream stays
   * here rather than being duplicated in the player.
   *
   * Rejects when no source could be started, so the shell can tell the viewer
   * instead of leaving the player on a frozen frame.
   */
  onRequestEpisode?: (episode: Episode) => Promise<void>;
  /**
   * The other sources for this item, so a manually chosen one keeps everything
   * a quick-played one gets.
   *
   * Choosing a source explicitly used to hand the player a bare stream URL: no
   * source list, no download button, and no way to move on when it would not
   * play. The instant-play path had all three, so the *more* deliberate action
   * produced the *less* capable player — which is exactly backwards.
   */
  sources?: {
    list: TorrentResult[];
    activeInfoHash: string;
    onSelect: (source: TorrentResult) => void;
    onDownload: (source: TorrentResult) => void;
    /** Called when the chosen source starts but cannot be decoded. */
    onUnplayable: (reason: string) => void;
  };
}

/**
 * Everything the shell needs to render a player for a session it has not
 * resolved yet.
 *
 * Distinct from {@link PlaybackRequest}, which describes a stream that already
 * exists. This is the instant-play path: the player opens on this, and the
 * stream details arrive later through session snapshots.
 */
export interface PlaybackSessionRequest {
  request: {
    mediaUrl: string;
    season?: number;
    episode?: number;
    titleOverride?: string;
  };
  title: string;
  episodeTitle?: string;
  series?: SeriesContext;
  progress?: {
    mediaUrl: string;
    year?: number;
    posterUrl?: string;
    season?: number;
    episode?: number;
    resumeAt?: number;
  };
  onRequestEpisode?: (episode: Episode) => Promise<void>;
  /** Fired once a source actually starts, so the choice can be remembered. */
  onStarted?: (source: TorrentResult) => void;
  /** Enqueues a download for a source picked from inside the player. */
  onDownloadSource?: (source: TorrentResult) => void;
  /** Identity for online subtitle search, which is keyed on the IMDb id. */
  subtitleContext?: { imdbId?: string; season?: number; episode?: number };
}

interface DetailViewProps {
  mediaItem: SearchResponse;
  onBack: () => void;
  onPlay: (request: PlaybackRequest) => void;
  /** Opens the player immediately and resolves a source into it. */
  onStartSession: (context: PlaybackSessionRequest) => void;
  onEnqueueDownload: (task: DownloadTask) => void;
  onSearch?: (query: string) => void;
  /** The query that produced this item, recorded on a bookmark so it can be re-run. */
  searchQuery?: string;
}

interface DetailData {
  name: string;
  url: string;
  type: TvType;
  posterUrl?: string;
  year?: number;
  plot?: string;
  rating?: number;
  tags?: string[];
  duration?: string;
  episodes?: Episode[];
  imdbId?: string;
}

/**
 * Reads this title's whole watch history in one lookup.
 *
 * Looked up through the library entry rather than by URL, so a title the user
 * previously watched through a different provider still resumes. One call backs
 * both the resume position and the per-episode markers, which otherwise meant
 * two round trips for the same rows.
 */
async function loadWatchState(mediaUrl: string): Promise<Record<string, EpisodeWatchState>> {
  if (!window.cloudstream) return {};

  const entry = await window.cloudstream.getLibraryEntryForUrl(mediaUrl);
  if (!entry) return {};

  const rows = await window.cloudstream.getProgressForKey(entry.key);
  const state: Record<string, EpisodeWatchState> = {};
  for (const row of rows) {
    state[episodeKey(row.season, row.episode)] = {
      positionSeconds: row.positionSeconds,
      durationSeconds: row.durationSeconds,
      completed: row.completed,
    };
  }
  return state;
}

/** Where to resume an episode from, or undefined if it was finished or never started. */
function resumePositionFrom(
  watchState: Record<string, EpisodeWatchState>,
  episode: Episode | null
): number | undefined {
  const match = watchState[episodeKey(episode?.season, episode?.episode)];
  if (!match || match.completed) return undefined;
  return match.positionSeconds;
}

/** Groups episodes by season so a 200-episode series is navigable. */
function groupBySeason(episodes: Episode[]): Map<number, Episode[]> {
  const map = new Map<number, Episode[]>();
  for (const episode of episodes) {
    const season = episode.season ?? 1;
    const list = map.get(season) ?? [];
    list.push(episode);
    map.set(season, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0));
  }
  return map;
}

export const DetailView: React.FC<DetailViewProps> = ({
  mediaItem,
  onBack,
  onPlay,
  onStartSession,
  onEnqueueDownload,
  onSearch,
  searchQuery,
}) => {
  const [detail, setDetail] = useState<DetailData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  /** Whether this page is in the user's saved list, and where it came from. */
  const [saved, setSaved] = useState(false);
  const [provenance, setProvenance] = useState<DetailHeroProvenance>({});

  /** How the background source search for this page is getting on. */
  const [prefetch, setPrefetch] = useState<PrefetchState | null>(null);

  const [activeSeason, setActiveSeason] = useState<number>(1);
  const [selectedEpisode, setSelectedEpisode] = useState<Episode | null>(null);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerData, setPickerData] = useState<SourcePickerData | null>(null);
  const [pickerError, setPickerError] = useState<string | undefined>();

  /**
   * The running cross-provider search behind the picker.
   *
   * The picker used to `await` one blocking `getSources` call: a spinner for as
   * long as the slowest indexer took, no way to see what had already answered,
   * and no way to stop. The player, asking the identical question of the
   * identical providers, streamed its answers in — so the screen whose entire
   * purpose is comparing sources had the worse view of them.
   *
   * It now runs the same discovery session the player does and renders from its
   * snapshots, which is also why there is only one definition of how sources are
   * found rather than two that can disagree.
   */
  const [discovery, setDiscovery] = useState<{
    id: string;
    searched: number;
    total: number;
    done: boolean;
    cancelled: boolean;
  } | null>(null);
  const discoveryRef = useRef<string | null>(null);
  const [pendingEpisode, setPendingEpisode] = useState<Episode | null>(null);
  const [startingStream, setStartingStream] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [seasonDownloadOpen, setSeasonDownloadOpen] = useState(false);
  /**
   * Set when a fallback route answered rather than the row's own.
   *
   * Everything downstream keys off `detail.url`, which is whichever route
   * worked, so nothing else needs to know — but the viewer does, because the
   * episode list they are looking at came from a different site than the row
   * said it would.
   */
  const [fellBackTo, setFellBackTo] = useState<string | null>(null);
  /**
   * Sources ruled out on this page, by infoHash.
   *
   * The manual-play path has no playback session to hold this, so it lives
   * here. Same rule as the session's: keyed on infoHash, because two releases
   * of one film share a title and are not the same source.
   */
  const unplayableSources = useRef<Set<string>>(new Set());
  /**
   * Stable handles to the play and download actions.
   *
   * The player is handed these inside `handlePlaySource`, which is itself one
   * of them — a direct reference would be circular, and capturing the value
   * would freeze it at the first call.
   */
  const playSourceRef = useRef<(source: TorrentResult) => void>(() => {});
  const downloadSourceRef = useRef<(source: TorrentResult, episode: Episode | null) => void>(
    () => {}
  );

  // --- load detail ---------------------------------------------------------

  useEffect(() => {
    let cancelled = false;

    (async () => {
      /**
       * The previous title's data is cleared; this one's is not blanked.
       *
       * `loadMedia` answers from cache on a revisit, so the fetch is usually
       * instant — but setting `detail` to null first still flashed the loading
       * state on the way through, which is the exact wait the cache exists to
       * remove.
       */
      setIsLoading(true);
      setLoadError(null);
      setDetail(null);
      setFellBackTo(null);

      if (!window.cloudstream) {
        setLoadError('Desktop bridge unavailable.');
        setIsLoading(false);
        return;
      }

      /**
       * The winning row is not the only way in.
       *
       * A merged result carries `alternates` — the other providers and
       * catalogues that returned the same work — and the merge picked one to
       * show. When that one cannot open the title, the others are still there
       * and usually still work: a scraper whose page shape changed this morning
       * sits beside two that are fine. Giving up on the first failure threw all
       * of them away and reported "could not load details", which is why so
       * many titles looked dead when only their top route was.
       *
       * Tried in merge order, which puts the routes carrying the strongest
       * identity first.
       */
      const routes = [mediaItem.url, ...(mediaItem.alternates ?? []).map((a) => a.url)];
      const reasons: string[] = [];

      for (const [index, route] of routes.entries()) {
        const response = await window.cloudstream.loadMedia(route);
        if (cancelled) return;

        if (response.ok && response.detail) {
          const data = response.detail as DetailData;
          setDetail(data);
          window.cloudstream?.recordTitleOutcome?.(mediaItem.url, 'played');
          // Only worth saying when it is not the route the row advertised.
          setFellBackTo(
            index > 0 ? (mediaItem.alternates?.[index - 1]?.apiName ?? 'another source') : null
          );
          const seasons = groupBySeason(data.episodes ?? []);
          const first = [...seasons.keys()].sort((a, b) => a - b)[0];
          if (first !== undefined) setActiveSeason(first);
          setIsLoading(false);
          return;
        }

        if (response.error) reasons.push(response.error);
      }

      // Every route failed. Report what each one said rather than a summary:
      // "Voe returned no links" and "the catalogue is unreachable" call for
      // completely different responses from the user.
      const combined =
        reasons.length > 0 ? [...new Set(reasons)].join(' · ') : 'No source could open this title.';
      setLoadError(combined);

      /**
       * Remembered, and attributed.
       *
       * A message naming a Java or transport failure is our problem, not the
       * title's, and marking the row "unavailable" for it would blame the
       * content for our bug — which is precisely how one broken translation
       * pass came to look like a hundred broken providers.
       */
      const ours = /NoSuchMethodError|NoClassDefFoundError|IncompatibleClassChange|runtime|sidecar/i.test(
        combined
      );
      window.cloudstream?.recordTitleOutcome?.(
        mediaItem.url,
        ours ? 'app-error' : 'no-sources',
        combined.slice(0, 300)
      );
      setIsLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [mediaItem.url, mediaItem.alternates]);

  /**
   * A background refresh landing while this title is open.
   *
   * Matched on the URL that actually opened rather than the row's, because a
   * fallback route may have answered and that is the address the cache is
   * keyed by. Ignored when it is for something else the user is not looking at.
   */
  useEffect(() => {
    const dispose = window.cloudstream?.onDetailUpdate?.(({ url, detail: fresh }) => {
      setDetail((current) => (current && current.url === url ? (fresh as DetailData) : current));
    });
    return () => dispose?.();
  }, []);

  const seasons = useMemo(() => groupBySeason(detail?.episodes ?? []), [detail]);
  const seasonNumbers = useMemo(
    () => [...seasons.keys()].sort((a, b) => a - b),
    [seasons]
  );
  const isSeries = (detail?.episodes?.length ?? 0) > 0;

  // --- sources -------------------------------------------------------------

  /**
   * Ends the running discovery, if any.
   *
   * Closing the picker has to stop the search behind it, or a dozen scrapers
   * keep working for a list nobody is looking at — and the session would go on
   * pushing snapshots into a picker that has moved on to a different episode.
   */
  const stopDiscovery = useCallback(() => {
    const id = discoveryRef.current;
    if (!id) return;
    discoveryRef.current = null;
    void window.cloudstream?.stopPlayback(id, true);
  }, []);

  const openSources = useCallback(
    async (episode: Episode | null, options: { refresh?: boolean } = {}) => {
      if (!window.cloudstream || !detail) return;

      stopDiscovery();

      setPendingEpisode(episode);
      setPickerOpen(true);
      setPickerError(undefined);
      setPickerData(null);
      setDiscovery(null);

      const response = await window.cloudstream.startSourceDiscovery(
        {
          mediaUrl: episode?.url ?? detail.url,
          season: episode?.season,
          episode: episode?.episode,
        },
        detail.name,
        episode?.name,
        // A refresh is the viewer saying the cached answer is wrong; serving it
        // back is what makes the button look broken.
        { bypassCache: options.refresh }
      );

      if (!response.ok || !response.snapshot) {
        setPickerError(response.error ?? 'Could not start a source search.');
        return;
      }

      discoveryRef.current = response.snapshot.sessionId;
      setDiscovery({
        id: response.snapshot.sessionId,
        searched: 0,
        total: 0,
        done: false,
        cancelled: false,
      });
    },
    [detail, stopDiscovery]
  );

  /**
   * Feeds the picker from the running session.
   *
   * Snapshots are filtered by id because a session that has just been replaced —
   * the viewer switched episodes, or pressed refresh — can still emit once more
   * before it notices, and those results belong to a different question.
   */
  useEffect(() => {
    if (!discovery) return;

    const dispose = window.cloudstream?.onPlaybackUpdate((snapshot) => {
      if (snapshot.sessionId !== discoveryRef.current) return;

      setDiscovery((current) =>
        current && current.id === snapshot.sessionId
          ? {
              ...current,
              searched: snapshot.searched,
              total: snapshot.totalIndexers,
              done: snapshot.searchDone,
              cancelled: snapshot.searchCancelled,
            }
          : current
      );

      setPickerData({
        sources: snapshot.sources,
        // Neither is reported by the session: `filtered` and `indexerOutcomes`
        // are batch summaries produced after everything settles, and this list
        // is deliberately being shown before that point.
        filtered: [],
        indexerOutcomes: [],
        emptyReason: snapshot.searchDone ? snapshot.emptyReason : undefined,
        diagnosis: snapshot.searchDone ? snapshot.diagnosis : undefined,
        query: {
          title: snapshot.title,
          season: pendingEpisode?.season,
          episode: pendingEpisode?.episode,
        },
      });
    });

    return dispose;
  }, [discovery?.id, pendingEpisode]);

  // A picker left open when the view goes away would leave its session running.
  useEffect(() => stopDiscovery, [stopDiscovery]);

  const flash = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 5000);
  }, []);

  /**
   * Saved state and origin, resolved once per item.
   *
   * `apiName` is the provider that served this result and the only ancestry the
   * item itself carries; the extension and repository behind it live in the
   * main process, which is the only side holding that mapping.
   */
  useEffect(() => {
    let cancelled = false;
    const url = mediaItem.url;
    if (!url) return;

    void (async () => {
      const [bookmark, origin] = await Promise.all([
        window.cloudstream?.getBookmark?.(url),
        mediaItem.apiName
          ? window.cloudstream?.getProviderProvenance?.(mediaItem.apiName)
          : Promise.resolve(undefined),
      ]);
      if (cancelled) return;

      setSaved(Boolean(bookmark?.bookmark));
      setProvenance({
        provider: origin?.provenance?.provider ?? mediaItem.apiName,
        extensionName: origin?.provenance?.extensionName,
        repositoryName: origin?.provenance?.repositoryName,
        // A catalogue result has no extension behind it; naming the catalogue
        // is what stops the origin line reading as "unknown" for half the app.
        metadataSource: origin?.provenance?.extensionName ? undefined : mediaItem.apiName,
        searchQuery,
      });

      // Reopening from the saved list is what makes "most used" meaningful.
      if (bookmark?.bookmark) void window.cloudstream?.markBookmarkOpened?.(url);
    })();

    return () => {
      cancelled = true;
    };
  }, [mediaItem.url, mediaItem.apiName, searchQuery]);

  /**
   * Saves or unsaves this page.
   *
   * Everything needed to reopen it goes in — the exact address, the provider,
   * the extension, the repository and the query that found it — plus a display
   * copy of the metadata so the saved list can be drawn without asking thirty
   * providers. Resolved links deliberately do not: they expire, and a saved
   * page that opens and cannot play is worse than one that re-resolves.
   */
  const toggleSaved = useCallback(async () => {
    if (!detail) return;
    const response = await window.cloudstream?.toggleBookmark?.({
      mediaUrl: mediaItem.url,
      title: detail.name,
      year: detail.year,
      type: detail.type,
      posterUrl: detail.posterUrl,
      plot: detail.plot,
      genres: detail.tags,
      rating: detail.rating,
      duration: detail.duration,
      origin: {
        provider: provenance.provider,
        extensionName: provenance.extensionName,
        repositoryName: provenance.repositoryName,
        metadataSource: provenance.metadataSource,
        searchQuery,
        imdbId: detail.imdbId,
      },
    });
    if (!response?.ok) return;
    setSaved(response.saved);
    flash(
      response.saved
        ? 'Saved. You can reopen this page from your library without searching again.'
        : 'Removed from your saved pages.'
    );
  }, [detail, mediaItem.url, provenance, searchQuery, flash]);

  /**
   * What pressing Play on this page would ask for.
   *
   * Must match `playEpisodeDirectly` exactly — the same media URL, season and
   * episode — because the whole benefit comes from the cache being keyed on
   * that tuple. Prefetching the show's own URL while Play asks for episode 1
   * would warm an entry nothing ever reads and cost a scrape for nothing.
   */
  const playTarget = useMemo(() => {
    if (!detail) return null;
    if (!isSeries) return { mediaUrl: detail.url };
    const episode = selectedEpisode ?? (seasons.get(activeSeason) ?? [])[0];
    if (!episode) return { mediaUrl: detail.url };
    return { mediaUrl: episode.url, season: episode.season, episode: episode.episode };
  }, [detail, isSeries, selectedEpisode, seasons, activeSeason]);

  /**
   * Looks for sources while the viewer is still reading the page.
   *
   * The window between a detail page opening and Play being pressed is several
   * seconds of doing nothing, and discovery is the slowest thing in the app —
   * so it runs there instead. The main process holds the policy: it waits to
   * see whether the page is actually being read, skips entirely when the cache
   * can already answer, and runs one at a time. Nothing here waits on it.
   *
   * Cancelled on unmount, which is safe: the abort only reaches the underlying
   * run if nobody else has joined it, so leaving the page after pressing Play
   * cannot cancel the discovery the player is now waiting on.
   */
  /*
   * Depended on as primitives, not as the object.
   *
   * `playTarget` is rebuilt whenever any of its inputs change identity —
   * `setSelectedEpisode` on the episode already showing produces an equal but
   * new object — and an effect keyed on the object would then cancel and
   * re-schedule the prefetch for a target that had not actually changed.
   */
  const playMediaUrl = playTarget?.mediaUrl;
  const playSeason = playTarget?.season;
  const playEpisode = playTarget?.episode;

  useEffect(() => {
    if (!playMediaUrl) return;
    void window.cloudstream?.prefetchSources?.({
      mediaUrl: playMediaUrl,
      season: playSeason,
      episode: playEpisode,
    });
    return () => {
      void window.cloudstream?.cancelSourcePrefetch?.();
    };
  }, [playMediaUrl, playSeason, playEpisode]);

  useEffect(() => {
    setPrefetch(null);
    const dispose = window.cloudstream?.onSourcePrefetch?.((state) => {
      // Snapshots for a target this page is no longer showing would make the
      // badge describe something else — a different episode, or the title the
      // viewer just navigated away from.
      if (!playMediaUrl || state.mediaUrl !== playMediaUrl) return;
      if (state.season !== playSeason || state.episode !== playEpisode) return;
      setPrefetch(state);
    });
    return () => dispose?.();
  }, [playMediaUrl, playSeason, playEpisode]);

  /** Queues one release for download, from either the picker or the player. */
  const downloadSource = useCallback(
    (source: TorrentResult, episode: Episode | null) => {
      if (!detail) return;

      const url = source.directUrl || source.magnet || source.torrentUrl || source.infoHash;
      const task: DownloadTask = {
        id: `${source.infoHash}-${episode?.episode ?? 'movie'}`,
        parentId: detail.url,
        title: detail.name,
        episodeNumber: episode?.episode,
        seasonNumber: episode?.season,
        posterUrl: detail.posterUrl,
        targetFilePath: '',
        link: {
          source: source.indexerName,
          name: source.title,
          url,
          referer: source.directHeaders?.Referer || source.directHeaders?.referer || '',
          quality: source.parsed.resolution || 720,
        },
        headers: source.directHeaders || {},
        bytesDownloaded: 0,
        totalBytes: source.sizeBytes,
        downloadSpeed: 0,
        etaSeconds: 0,
        state: DownloadState.Queued,
        providerName: source.indexerName,
        createdTime: Date.now(),
        mediaUrl: episode?.url || detail.url,
        resolution: source.parsed.resolution,
      };

      onEnqueueDownload(task);
      flash(`Added “${detail.name}” to downloads.`);
    },
    [detail, onEnqueueDownload, flash]
  );

  /** Series context handed to the player, so it can browse without coming back. */
  const seriesContextFor = useCallback(
    (
      episode: Episode | null,
      watchState: Record<string, EpisodeWatchState>
    ): SeriesContext | undefined => {
      if (!detail || !isSeries) return undefined;
      return {
        title: detail.name,
        posterUrl: detail.posterUrl,
        plot: detail.plot,
        year: detail.year,
        rating: detail.rating,
        tags: detail.tags,
        duration: detail.duration,
        episodes: detail.episodes ?? [],
        currentEpisodeUrl: episode?.url,
        watchState,
      };
    },
    [detail, isSeries]
  );

  /** Records which release was played, so a later session can prefer it again. */
  const rememberChoice = useCallback(
    async (source: TorrentResult, episode: Episode | null) => {
      if (!window.cloudstream || !detail) return;
      const entry = await window.cloudstream.getLibraryEntryForUrl(detail.url);
      if (!entry) return;

      await window.cloudstream.rememberSource({
        key: entry.key,
        season: episode?.season,
        episode: episode?.episode,
        infoHash: source.infoHash,
        sourceTitle: source.title,
        indexerName: source.indexerName,
        resolution: source.parsed.resolution,
        magnet: source.magnet,
      });
    },
    [detail]
  );

  /**
   * Plays an episode straight from the player, picking a source automatically.
   *
   * Pressing "next episode" should behave like pressing next episode, not like
   * being returned to a source list. `autoPlay` searches, ranks, and then walks
   * the ranked list until one source actually delivers bytes — the top-ranked
   * release is frequently a stale index entry with no live swarm, and stopping
   * at it is what made "next episode" feel unreliable.
   *
   * It throws rather than silently opening the picker: the caller is the player,
   * which is better placed to decide what to show over a running video.
   */
  const playEpisodeDirectly = useCallback(
    async (episode: Episode | null) => {
      if (!window.cloudstream || !detail) return;

      if (episode) setSelectedEpisode(episode);

      // Fire-and-forget: recording the title in the library must not stand
      // between the click and the player appearing.
      window.cloudstream.upsertLibraryEntry({
        title: detail.name,
        year: detail.year,
        type: detail.type,
        posterUrl: detail.posterUrl,
        mediaUrl: detail.url,
      });

      // One local datastore read, needed before the player mounts so the
      // episode list and resume point are right from the first frame.
      const watchState = await loadWatchState(detail.url);

      onStartSession({
        request: {
          mediaUrl: episode?.url ?? detail.url,
          season: episode?.season,
          episode: episode?.episode,
        },
        title: detail.name,
        episodeTitle: episode?.name,
        series: seriesContextFor(episode, watchState),
        onRequestEpisode: (next) => playEpisodeDirectlyRef.current(next),
        onStarted: (source) => rememberChoice(source, episode),
        onDownloadSource: (source) => downloadSource(source, episode),
        subtitleContext: {
          imdbId: detail.imdbId,
          season: episode?.season,
          episode: episode?.episode,
        },
        progress: {
          mediaUrl: episode?.url ?? detail.url,
          year: detail.year,
          posterUrl: detail.posterUrl,
          season: episode?.season,
          episode: episode?.episode,
          resumeAt: resumePositionFrom(watchState, episode),
        },
      });
    },
    [detail, onStartSession, rememberChoice, seriesContextFor, downloadSource]
  );

  // The handler is embedded in the request it produces, so it needs a stable
  // reference to itself; a ref keeps that from becoming a circular dependency.
  const playEpisodeDirectlyRef = useRef(playEpisodeDirectly);
  useEffect(() => {
    playEpisodeDirectlyRef.current = playEpisodeDirectly;
  }, [playEpisodeDirectly]);

  /**
   * One-click play from the detail page.
   *
   * The session opens the player immediately and resolves a source into it, so
   * there is nothing to wait for here and no failure to catch: a search that
   * finds nothing surfaces inside the player, next to the source list and the
   * retry, rather than as a toast on a page the viewer has already left.
   */
  const playNow = playEpisodeDirectly;

  const handlePlaySource = useCallback(
    async (source: TorrentResult) => {
      if (!window.cloudstream || !detail) return;

      setStartingStream(true);
      const response = await window.cloudstream.startStream(
        source,
        pendingEpisode?.season,
        pendingEpisode?.episode
      );
      setStartingStream(false);

      if (!response.ok || !response.handle) {
        // The user picked this source deliberately, so it is not silently
        // swapped for another — but the picker is still open behind this
        // message, with the next-best entries one click away.
        setPickerError(
          `${response.error ?? 'Could not start the stream.'} Try another source from the list.`
        );
        return;
      }

      setPickerOpen(false);
      window.cloudstream.upsertLibraryEntry({
        title: detail.name,
        year: detail.year,
        type: detail.type,
        posterUrl: detail.posterUrl,
        mediaUrl: detail.url,
      });
      rememberChoice(source, pendingEpisode);

      const watchState = await loadWatchState(detail.url);

      const others = pickerData?.sources ?? [];

      onPlay({
        streamUrl: response.handle.streamUrl,
        mimeType: response.handle.mimeType,
        title: detail.name,
        episodeTitle: pendingEpisode?.name,
        infoHash: response.handle.infoHash,
        subtitles: response.handle.subtitleUrls,
        series: seriesContextFor(pendingEpisode, watchState),
        onRequestEpisode: (episode) => playEpisodeDirectlyRef.current(episode),
        sources: {
          list: others,
          activeInfoHash: response.handle.infoHash,
          onSelect: (next) => void playSourceRef.current(next),
          onDownload: (next) => downloadSourceRef.current(next, pendingEpisode),
          onUnplayable: () => {
            unplayableSources.current.add(source.infoHash);
            const next = others.find(
              (candidate) => !unplayableSources.current.has(candidate.infoHash)
            );
            if (next) void playSourceRef.current(next);
          },
        },
        progress: {
          mediaUrl: pendingEpisode?.url ?? detail.url,
          year: detail.year,
          posterUrl: detail.posterUrl,
          season: pendingEpisode?.season,
          episode: pendingEpisode?.episode,
          resumeAt: resumePositionFrom(watchState, pendingEpisode),
        },
      });
    },
    [detail, pendingEpisode, onPlay, rememberChoice, seriesContextFor, pickerData]
  );

  // Assigned after definition: `handlePlaySource` hands these to the player and
  // is itself one of them.
  useEffect(() => {
    playSourceRef.current = (source: TorrentResult) => void handlePlaySource(source);
  }, [handlePlaySource]);

  useEffect(() => {
    downloadSourceRef.current = downloadSource;
  }, [downloadSource]);

  const handleDownloadSource = useCallback(
    (source: TorrentResult) => {
      downloadSource(source, pendingEpisode);
      setPickerOpen(false);
    },
    [downloadSource, pendingEpisode]
  );

  // --- render --------------------------------------------------------------

  if (isLoading) {
    return (
      <div className="detail-view detail-view--state">
        <Loader2 className="spin" size={32} />
        <p>Loading {mediaItem.name}…</p>
      </div>
    );
  }

  if (loadError || !detail) {
    return (
      <div className="detail-view detail-view--state">
        <AlertTriangle size={32} />
        {/* Every route's own reason, not a summary of them. */}
        <p>{loadError ?? 'No details available.'}</p>
        {(mediaItem.alternates?.length ?? 0) > 0 && (
          <p className="detail-view__tried">
            Tried {(mediaItem.alternates?.length ?? 0) + 1} sources for “{mediaItem.name}”.
          </p>
        )}
        <div className="detail-view__actions">
          <button className="btn" onClick={onBack}>
            <ArrowLeft size={16} /> Back
          </button>
          <CopyErrorButton
            context={{
              title: mediaItem.name,
              url: mediaItem.url,
              source: mediaItem.apiName,
              message: loadError ?? undefined,
            }}
          />
        </div>
      </div>
    );
  }

  const episodesInSeason = seasons.get(activeSeason) ?? [];

  return (
    <div className="detail-view">
      <button className="btn btn-ghost detail-view__back" onClick={onBack}>
        <ArrowLeft size={16} /> Back
      </button>

      <DetailHero
        title={detail.name}
        year={detail.year}
        type={detail.type}
        posterUrl={detail.posterUrl}
        plot={detail.plot}
        rating={detail.rating}
        duration={detail.duration}
        tags={detail.tags}
        fallbackNote={
          fellBackTo
            ? `The listed source could not open this, so these details came from ${fellBackTo}.`
            : undefined
        }
        isSeries={isSeries}
        provenance={{ ...provenance, imdbId: detail.imdbId }}
        saved={saved}
        busy={startingStream}
        sourceReadiness={prefetch}
        onPlay={() => playNow(isSeries ? (episodesInSeason[0] ?? null) : null)}
        onToggleSave={() => void toggleSaved()}
        onChooseSource={() => openSources(isSeries ? (episodesInSeason[0] ?? null) : null)}
        onDownload={() => openSources(isSeries ? (episodesInSeason[0] ?? null) : null)}
        // "Find more" and "Refresh" are the same search with the cache bypassed,
        // and they stay two entries because they answer two questions people
        // actually ask: "is there anything else?" and "these links are dead".
        onFindMoreSources={() =>
          openSources(isSeries ? (episodesInSeason[0] ?? null) : null, { refresh: true })
        }
        onRefreshSources={() =>
          openSources(isSeries ? (episodesInSeason[0] ?? null) : null, { refresh: true })
        }
        onSearchTitle={
          onSearch
            ? // The *full* title, not whatever is still sitting in the search
              // box. Searching "Avengers" from the Age of Ultron page was the
              // reported behaviour, and it came from the box owning its own text.
              () => onSearch(`${detail.name}${detail.year ? ` ${detail.year}` : ''}`)
            : undefined
        }
        onDownloadSeason={isSeries ? () => setSeasonDownloadOpen(true) : undefined}
        libraryControl={
          // The selector keys off a search result; `detail` carries everything
          // except the provider name, which the originating item still has.
          <LibraryBucketSelector item={{ ...detail, apiName: mediaItem.apiName }} size="sm" />
        }
      />

      {isSeries && (
        <section className="episode-section">
          {seasonNumbers.length > 1 && (
            <div className="season-tabs" role="tablist">
              {seasonNumbers.map((season) => (
                <button
                  key={season}
                  role="tab"
                  aria-selected={season === activeSeason}
                  className={`season-tab${season === activeSeason ? ' season-tab--active' : ''}`}
                  onClick={() => setActiveSeason(season)}
                >
                  Season {season}
                </button>
              ))}
            </div>
          )}

          <ul className="episode-list">
            {episodesInSeason.map((episode) => (
              <li
                key={episode.url}
                className={`episode-row${selectedEpisode?.url === episode.url ? ' episode-row--active' : ''}`}
              >
                {episode.posterUrl && (
                  <img className="episode-row__thumb" src={episode.posterUrl} alt="" loading="lazy" />
                )}
                <div className="episode-row__body">
                  <p className="episode-row__title">{episode.name}</p>
                  {episode.date && <span className="muted">{episode.date}</span>}
                  {episode.description && (
                    <p className="episode-row__desc">{episode.description}</p>
                  )}
                </div>
                <div className="episode-row__actions">
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => playNow(episode)}
                  >
                    <Play size={14} />
                    Play
                  </button>
                  <button
                    className="btn btn-sm"
                    onClick={() => {
                      setSelectedEpisode(episode);
                      openSources(episode);
                    }}
                    title="Pick a source by hand"
                  >
                    <ListVideo size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <SourcePicker
        isOpen={pickerOpen}
        // Only a stream actually starting is a blocking wait; discovery is not,
        // and conflating them is what hid the results until the search was over.
        isLoading={startingStream}
        data={pickerData}
        error={pickerError}
        contextLabel={
          pendingEpisode
            ? `${detail.name} — ${pendingEpisode.name}`
            : `${detail.name}${detail.year ? ` (${detail.year})` : ''}`
        }
        searching={Boolean(discovery && !discovery.done)}
        searched={discovery?.searched ?? 0}
        totalSources={discovery?.total ?? 0}
        cancelled={discovery?.cancelled ?? false}
        onClose={() => {
          stopDiscovery();
          setPickerOpen(false);
        }}
        onPlay={handlePlaySource}
        onDownload={handleDownloadSource}
        onRetry={() => openSources(pendingEpisode, { refresh: true })}
        onCancelSearch={() => {
          if (discoveryRef.current) {
            void window.cloudstream?.playbackCancelSourceSearch(discoveryRef.current);
          }
        }}
      />

      {isSeries && (
        <SeasonDownloadDialog
          open={seasonDownloadOpen}
          title={detail.name}
          parentUrl={detail.url}
          posterUrl={detail.posterUrl}
          episodes={detail.episodes ?? []}
          activeSeason={activeSeason}
          onClose={() => setSeasonDownloadOpen(false)}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
};
