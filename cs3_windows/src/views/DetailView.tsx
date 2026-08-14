import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Play, Download, Star, ArrowLeft, Loader2, AlertTriangle, Calendar, Layers, ListVideo,
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
}) => {
  const [detail, setDetail] = useState<DetailData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [activeSeason, setActiveSeason] = useState<number>(1);
  const [selectedEpisode, setSelectedEpisode] = useState<Episode | null>(null);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerData, setPickerData] = useState<SourcePickerData | null>(null);
  const [pickerError, setPickerError] = useState<string | undefined>();
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

  // --- load detail ---------------------------------------------------------

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setIsLoading(true);
      setLoadError(null);
      setDetail(null);

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

  const seasons = useMemo(() => groupBySeason(detail?.episodes ?? []), [detail]);
  const seasonNumbers = useMemo(
    () => [...seasons.keys()].sort((a, b) => a - b),
    [seasons]
  );
  const isSeries = (detail?.episodes?.length ?? 0) > 0;

  // --- sources -------------------------------------------------------------

  const openSources = useCallback(
    async (episode: Episode | null) => {
      if (!window.cloudstream || !detail) return;

      setPendingEpisode(episode);
      setPickerOpen(true);
      setPickerLoading(true);
      setPickerError(undefined);
      setPickerData(null);

      const response = await window.cloudstream.getSources({
        mediaUrl: episode?.url ?? detail.url,
        season: episode?.season,
        episode: episode?.episode,
      });

      setPickerLoading(false);
      if (!response.ok && response.error) {
        setPickerError(response.error);
        return;
      }
      setPickerData({
        sources: response.sources,
        filtered: response.filtered,
        indexerOutcomes: response.indexerOutcomes,
        emptyReason: response.emptyReason,
        query: response.query,
      });
    },
    [detail]
  );

  const flash = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 5000);
  }, []);

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

      onPlay({
        streamUrl: response.handle.streamUrl,
        mimeType: response.handle.mimeType,
        title: detail.name,
        episodeTitle: pendingEpisode?.name,
        infoHash: response.handle.infoHash,
        subtitles: response.handle.subtitleUrls,
        series: seriesContextFor(pendingEpisode, watchState),
        onRequestEpisode: (episode) => playEpisodeDirectlyRef.current(episode),
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
    [detail, pendingEpisode, onPlay, rememberChoice, seriesContextFor]
  );

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

      <header className="detail-hero">
        {detail.posterUrl && (
          <img className="detail-hero__poster" src={detail.posterUrl} alt="" loading="lazy" />
        )}
        <div className="detail-hero__body">
          <h1>{detail.name}</h1>
          {fellBackTo && (
            <p className="detail-hero__fallback">
              The listed source could not open this, so these details came from {fellBackTo}.
            </p>
          )}

          <div className="detail-hero__meta">
            {detail.year && (
              <span><Calendar size={14} /> {detail.year}</span>
            )}
            {detail.rating !== undefined && (
              <span><Star size={14} /> {detail.rating.toFixed(1)}</span>
            )}
            {detail.duration && <span>{detail.duration}</span>}
            <span className="badge badge--muted">{detail.type}</span>
          </div>

          {detail.tags && detail.tags.length > 0 && (
            <div className="detail-hero__tags">
              {detail.tags.slice(0, 6).map((tag) => (
                <span key={tag} className="badge badge--muted">{tag}</span>
              ))}
            </div>
          )}

          {detail.plot && <p className="detail-hero__plot">{detail.plot}</p>}

          <div className="detail-hero__actions">
            <button
              className="btn btn-primary"
              onClick={() => playNow(isSeries ? episodesInSeason[0] ?? null : null)}
              disabled={startingStream}
            >
              <Play size={16} />
              {isSeries ? 'Play first episode' : 'Play'}
            </button>
            {/* The selector keys off a search result; `detail` carries everything
                except the provider name, which the originating item still has. */}
            <LibraryBucketSelector
              item={{ ...detail, apiName: mediaItem.apiName }}
              size="md"
            />
            <button
              className="btn"
              onClick={() => openSources(isSeries ? episodesInSeason[0] ?? null : null)}
            >
              <ListVideo size={16} /> Choose source
            </button>
            <button
              className="btn"
              onClick={() => openSources(isSeries ? episodesInSeason[0] ?? null : null)}
            >
              <Download size={16} /> {isSeries ? 'Download episode' : 'Download'}
            </button>
            {isSeries && (
              <button className="btn" onClick={() => setSeasonDownloadOpen(true)}>
                <Layers size={16} /> Download season
              </button>
            )}
          </div>
        </div>
      </header>

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
        isLoading={pickerLoading || startingStream}
        data={pickerData}
        error={pickerError}
        contextLabel={
          pendingEpisode
            ? `${detail.name} — ${pendingEpisode.name}`
            : `${detail.name}${detail.year ? ` (${detail.year})` : ''}`
        }
        onClose={() => setPickerOpen(false)}
        onPlay={handlePlaySource}
        onDownload={handleDownloadSource}
        onRetry={() => openSources(pendingEpisode)}
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
