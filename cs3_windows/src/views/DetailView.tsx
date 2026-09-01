import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Play, ArrowLeft, Loader2, AlertTriangle, ListVideo, Search,
} from 'lucide-react';
import type { SearchResponse, Episode } from '../types/api';
import { TvType } from '../types/api';
import type { DownloadRequestResult, DownloadTask } from '../types/download';
import { buildDownloadTask } from '../utils/downloadIdentity';
import { useFlash } from '../utils/useFlash';
import type { TorrentResult } from '../types/torrent';
import type { PlaybackSnapshot } from '../../electron/playbackSession';
import { SourcePicker, type SourcePickerData } from '../components/SourcePicker';
import {
  episodeKey,
  type EpisodeWatchState,
  type SeriesContext,
} from '../components/player/seriesContext';
import { SeasonDownloadDialog } from '../components/SeasonDownloadDialog';
import { LibraryBucketSelector } from '../components/LibraryBucketSelector';
import { PosterCard } from '../components/PosterCard';
import { Poster } from '../components/Poster';
import { CopyErrorButton } from '../components/CopyErrorButton';
import { ProviderRecoveryPanel } from '../components/ProviderRecoveryPanel';
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
  originalTitle?: string;
  providerProvenance?: {
    provider?: string;
    repositoryName?: string;
    extensionName?: string;
    indexerName?: string;
  };
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
  /** Resolves with what the press actually did — see `DownloadRequestResult`. */
  onEnqueueDownload: (task: DownloadTask) => Promise<DownloadRequestResult>;
  onSearch?: (query: string) => void;
  /** Opens another title — a related one from this page's recommendations. */
  onSelectMedia?: (item: SearchResponse) => void;
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
  /** A live channel: no duration to seek within and no position worth keeping. */
  isLive?: boolean;
  /**
   * Cast and related titles, both of which the provider already sent.
   *
   * `ProviderBridge` has encoded these since the link-surface work and every
   * layer between it and here carried them; this screen was simply the one that
   * never read them. Scraping them again would have been the expensive way to
   * fix a field that was already arriving.
   */
  actors?: string[];
  recommendations?: SearchResponse[];
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

/**
 * Where to resume an episode from, or undefined if it was finished or never
 * started — or if it is live.
 *
 * A live channel has no fixed timeline, so a stored position does not address
 * anything: yesterday's 20 minutes in is not a point in today's broadcast. The
 * seek either lands somewhere arbitrary or is refused, and both read as the
 * channel being broken.
 */
function resumePositionFrom(
  watchState: Record<string, EpisodeWatchState>,
  episode: Episode | null,
  isLive?: boolean
): number | undefined {
  if (isLive) return undefined;
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
  onSelectMedia,
  searchQuery,
}) => {
  const [detail, setDetail] = useState<DetailData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [disabledProvider, setDisabledProvider] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

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
    /** Whether asking every provider and indexer would reach anything new. */
    canWiden: boolean;
  } | null>(null);
  const discoveryRef = useRef<string | null>(null);
  const [pendingEpisode, setPendingEpisode] = useState<Episode | null>(null);
  const [startingStream, setStartingStream] = useState(false);
  /** A confirmation that clears itself; `useFlash` explains what it replaced. */
  const { message: toast, flash } = useFlash<string>(5000);
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
      setDisabledProvider(null);
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
          setDisabledProvider(null);
          window.cloudstream?.recordTitleOutcome?.(mediaItem.url, 'played');

          // Record detail opened event in history (Unchecked until user plays/downloads)
          window.cloudstream?.recordHistoryEvent?.({
            title: data.name,
            year: data.year,
            type: data.type,
            posterUrl: data.posterUrl,
            mediaUrl: route,
            action: 'detail_opened',
            status: 'Unchecked',
            metadata: { imdbId: data.imdbId, provider: mediaItem.apiName },
          });

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

      /*
       * Whether this failure is one the recovery panel can act on.
       *
       * The previous test matched a single sentence — `extension provider "X"
       * is currently disabled` — and `explainMissingProvider` does not say
       * that. It says "switched off", "is no longer installed", "did not
       * load". So the branch that names the provider explicitly almost never
       * fired, and the broad `/disabled/` fallback beside it fired on messages
       * that have nothing to do with a provider at all.
       *
       * The vocabulary below is `explainMissingProvider`'s own, which is the
       * only thing that produces these. Getting this wrong is cheap in one
       * direction and not the other: too narrow and the panel does not appear
       * for a case it could fix, too broad and it offers to "fix" a dead host.
       * The panel itself plans first and says plainly when there is nothing to
       * do, so a false positive degrades to an explanation rather than to
       * another button that does nothing.
       */
      const recoverable =
        /switched off|currently disabled|no longer installed|did not load|not loaded|no longer registers|turned off in settings|reinstall it/i.test(
          combined
        );
      if (recoverable) {
        const named = combined.match(/extension provider "([^"]+)" is currently disabled/i);
        const fromAddress = mediaItem.url.match(/^cs3ext:\/\/([^/]+)/);
        const provider =
          named?.[1] ??
          (fromAddress?.[1] ? decodeURIComponent(fromAddress[1]) : undefined) ??
          (mediaItem.apiName &&
          mediaItem.apiName !== 'Cinemeta' &&
          mediaItem.apiName !== 'Indexer'
            ? mediaItem.apiName
            : undefined);
        if (provider) setDisabledProvider(provider);
      }

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
  }, [mediaItem.url, mediaItem.alternates, reloadToken]);

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

  /**
   * Feeds the picker from the running session.
   *
   * Subscribed for the life of the page, and buffered by session id, because a
   * cache hit answers faster than React can render. `startSourceDiscovery`
   * returns after the session has already emitted its opening snapshot, its
   * cached results and its `searchDone` — all within a millisecond — so a
   * listener attached in an effect keyed on the resulting state misses the
   * entire life of the session and leaves the picker searching forever with
   * nothing in it. That is invisible while every search is slow, and it is the
   * *normal* case for "View sources", which exists to serve what is already
   * found.
   *
   * Snapshots are still matched by id: a session that has just been replaced —
   * the viewer switched episodes, or pressed refresh — can emit once more
   * before it notices, and those results belong to a different question.
   */
  const snapshotsById = useRef(new Map<string, PlaybackSnapshot>());
  const pendingEpisodeRef = useRef<Episode | null>(null);
  pendingEpisodeRef.current = pendingEpisode;

  const applySnapshot = useCallback((snapshot: PlaybackSnapshot) => {
    setDiscovery((current) =>
      current && current.id === snapshot.sessionId
        ? {
            ...current,
            searched: snapshot.searched,
            total: snapshot.totalIndexers,
            done: snapshot.searchDone,
            cancelled: snapshot.searchCancelled,
            // Only meaningful once the scoped search has finished and come up
            // short; offering it mid-search invites widening a run that was
            // about to answer.
            canWiden: snapshot.canWiden,
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
        season: pendingEpisodeRef.current?.season,
        episode: pendingEpisodeRef.current?.episode,
      },
    });
  }, []);


  /**
   * Asks every provider and indexer, not just the ones this title came from.
   *
   * Driven through the *running* session rather than by starting a new one:
   * `refreshSources(widen)` replaces the retained query's scope, so the widened
   * answer is also what a later refresh from this picker asks for. Starting a
   * fresh discovery here would go back to `origin` on the next press and make
   * the button look like it had done nothing.
   */
  const widenSources = useCallback(() => {
    const id = discoveryRef.current;
    if (!id) return;
    setDiscovery((current) => (current ? { ...current, done: false, cancelled: false } : current));
    void window.cloudstream?.playbackRefreshSources?.(id, true);
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

      const sessionId = response.snapshot.sessionId;
      discoveryRef.current = sessionId;
      setDiscovery({
        id: sessionId,
        searched: response.snapshot.searched,
        total: response.snapshot.totalIndexers,
        done: response.snapshot.searchDone,
        cancelled: response.snapshot.searchCancelled,
        canWiden: response.snapshot.canWiden,
      });

      // Anything this session emitted while the invoke was in flight. For a
      // cache hit that is the whole answer, already complete.
      const buffered = snapshotsById.current.get(sessionId);
      if (buffered) applySnapshot(buffered);
    },
    [applySnapshot, detail, stopDiscovery]
  );

  useEffect(() => {
    const buffered = snapshotsById.current;
    const dispose = window.cloudstream?.onPlaybackUpdate((snapshot) => {
      /*
       * Kept even when it is not ours yet. The id of the session we started is
       * only known once the invoke resolves, and by then its snapshots have
       * been and gone; one entry per session is enough, because each supersedes
       * the last.
       */
      buffered.set(snapshot.sessionId, snapshot);
      if (buffered.size > 8) buffered.delete(buffered.keys().next().value as string);
      if (snapshot.sessionId === discoveryRef.current) applySnapshot(snapshot);
    });
    return () => {
      dispose?.();
      buffered.clear();
    };
  }, [applySnapshot]);

  // A picker left open when the view goes away would leave its session running.
  useEffect(() => stopDiscovery, [stopDiscovery]);


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

      const task = buildDownloadTask(source, {
        title: detail.name,
        parentTitle: detail.name,
        episodeTitle: episode
          ? (episode.name ? episode.name : `Episode ${episode.episode ?? ''}`)
          : undefined,
        mediaUrl: episode?.url || detail.url,
        parentMediaUrl: detail.url,
        providerName:
          mediaItem.apiName || (detail as any).apiName || source.providerName || source.indexerName,
        posterUrl: episode?.posterUrl || detail.posterUrl,
        season: episode?.season,
        episode: episode?.episode,
        mediaType: detail.type,
        year: detail.year,
        originalTitle: mediaItem.originalTitle || (detail as any).originalTitle,
        // A source with no address at all is not downloadable; `infoHash` was
        // used here and is not a URL, so it produced a task that could only
        // fail once it reached an engine.
        fallbackUrl: undefined,
      });
      if (!task) {
        flash('That source carries no address to download from.');
        return;
      }

      /**
       * The answer says what the press did. Every one of these was previously
       * `Added to downloads`, including the presses that added nothing because
       * a different release of the same film was already in the list.
       */
      void onEnqueueDownload(task).then((result) => {
        flash(result?.message ?? `Added “${detail.name}” to downloads.`);
      });
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
        originalTitle: mediaItem.originalTitle || (detail as any)?.originalTitle || searchQuery,
        providerProvenance: {
          provider: provenance.provider,
          repositoryName: provenance.repositoryName,
          extensionName: provenance.extensionName,
        },
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
          /**
           * The **page**, not the episode's playback handle.
           *
           * These two are different addresses and only one of them can be
           * reopened. `episode.url` carries the opaque blob `loadLinks` wants —
           * for a large part of the corpus that is JSON, e.g. VegaMovies'
           * `[{"source":"https://vcloud.fit/…"}]`. Storing it here put it into
           * the library, Continue Watching and any page saved from one of those
           * rows; clicking the row later called `load()` on it, which fetches
           * what it is given, and the detail page came up empty. The user-facing
           * shape was "a title I saved and watched now opens blank", which reads
           * as data rot rather than as the wrong address having been written.
           *
           * Nothing is lost by using the page: watch progress is keyed on
           * title + year + season + episode (`libraryStore.recordProgress`), and
           * the season and episode travel in their own fields right below. The
           * handle that actually plays is still `request.mediaUrl` above.
           */
          mediaUrl: detail.url,
          year: detail.year,
          posterUrl: detail.posterUrl,
          season: episode?.season,
          episode: episode?.episode,
          resumeAt: resumePositionFrom(watchState, episode, detail.isLive),
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
          resumeAt: resumePositionFrom(watchState, pendingEpisode, detail.isLive),
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
    if (disabledProvider) {
      return (
        <div className="detail-view detail-view--state">
          <ProviderRecoveryPanel
            provider={disabledProvider}
            title={mediaItem.originalTitle || mediaItem.name}
            reason={loadError}
            onBack={onBack}
            onSearch={onSearch}
            onRecovered={() => {
              setIsLoading(true);
              setLoadError(null);
              setDisabledProvider(null);
              setReloadToken((t) => t + 1);
            }}
          />
        </div>
      );
    }

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
          {/*
            The way back for a page that can no longer be opened.

            Saved pages, library entries and Continue Watching rows written
            before the address fix carry a playback handle rather than a page,
            and no amount of retrying will make `load()` accept one — the page
            address is not recoverable from it. What *is* recoverable is the
            title, which is stored right alongside, so searching for it again
            produces a fresh, working page. Without this every such row is a
            permanent dead end with a Back button.
          */}
          {onSearch && (
            <button
              className="btn btn-primary"
              onClick={() => onSearch(mediaItem.originalTitle || mediaItem.name)}
            >
              <Search size={16} /> Find “{mediaItem.name}” again
            </button>
          )}
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
        originalTitle={mediaItem.originalTitle || (detail as any)?.originalTitle}
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
        // Deliberately not a cache bypass: the badge beside it says these were
        // already found, so re-asking every provider would contradict it. An
        // empty answer is not a dead end either — the picker explains it and
        // offers the bypassing search from there.
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
          <LibraryBucketSelector
            item={{ ...detail, apiName: mediaItem.apiName }}
            sources={pickerData?.sources || undefined}
            size="sm"
          />
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
                  <Poster
                    src={episode.posterUrl}
                    title={episode.name ?? ''}
                    decorative
                    className="episode-row__thumb"
                    fallback={null}
                  />
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

      {/*
        Cast and related titles, from data the provider already sent.

        Both fields cross the bridge on every `load` and were dropped at this
        last step, so the page showed less than the scrape had already paid for.
        Rendered only when non-empty: most providers send neither, and an empty
        "Cast" heading reads as a failed lookup rather than an absent field.
      */}
      {(detail.actors?.length ?? 0) > 0 && (
        <section className="detail-facts">
          <h2 className="detail-facts__heading">Cast</h2>
          <ul className="detail-facts__people">
            {detail.actors!.map((actor) => (
              <li key={actor} className="detail-facts__person">
                {actor}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(detail.recommendations?.length ?? 0) > 0 && onSelectMedia && (
        <section className="detail-facts">
          <h2 className="detail-facts__heading">More like this</h2>
          <div className="detail-facts__rail">
            {detail.recommendations!.map((item) => (
              <PosterCard
                key={`${item.apiName}:${item.url}`}
                item={item}
                onSelectMedia={onSelectMedia}
                // The bucket control needs a library identity this row does not
                // reliably have — a recommendation is a pointer, not a result
                // the user searched for.
                showBucketButton={false}
              />
            ))}
          </div>
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
        onWiden={widenSources}
        canWiden={discovery?.canWiden ?? false}
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
          providerName={mediaItem.apiName || (detail as any).apiName}
          mediaType={detail.type}
          year={detail.year}
          episodes={detail.episodes ?? []}
          activeSeason={activeSeason}
          onClose={() => setSeasonDownloadOpen(false)}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
};
