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

interface DetailViewProps {
  mediaItem: SearchResponse;
  onBack: () => void;
  onPlay: (request: PlaybackRequest) => void;
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
  /** URL of the episode currently being auto-resolved, or 'movie' for a film. */
  const [autoPlaying, setAutoPlaying] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [seasonDownloadOpen, setSeasonDownloadOpen] = useState(false);

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

      const response = await window.cloudstream.loadMedia(mediaItem.url);
      if (cancelled) return;

      if (!response.ok || !response.detail) {
        setLoadError(response.error ?? 'Could not load details for this title.');
      } else {
        const data = response.detail as DetailData;
        setDetail(data);
        const seasons = groupBySeason(data.episodes ?? []);
        const first = [...seasons.keys()].sort((a, b) => a - b)[0];
        if (first !== undefined) setActiveSeason(first);
      }
      setIsLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [mediaItem.url]);

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
    async (episode: Episode) => {
      if (!window.cloudstream || !detail) return;

      setSelectedEpisode(episode);

      const response = await window.cloudstream.autoPlay({
        mediaUrl: episode.url,
        season: episode.season,
        episode: episode.episode,
      });

      if (!response.ok || !response.handle || !response.source) {
        throw new Error(response.error ?? 'No working source was found for this episode.');
      }

      window.cloudstream.upsertLibraryEntry({
        title: detail.name,
        year: detail.year,
        type: detail.type,
        posterUrl: detail.posterUrl,
        mediaUrl: detail.url,
      });
      rememberChoice(response.source, episode);

      const watchState = await loadWatchState(detail.url);

      onPlay({
        streamUrl: response.handle.streamUrl,
        mimeType: response.handle.mimeType,
        title: detail.name,
        episodeTitle: episode.name,
        infoHash: response.handle.infoHash,
        subtitles: response.handle.subtitleUrls,
        series: seriesContextFor(episode, watchState),
        onRequestEpisode: (next) => playEpisodeDirectlyRef.current(next),
        progress: {
          mediaUrl: episode.url,
          year: detail.year,
          posterUrl: detail.posterUrl,
          season: episode.season,
          episode: episode.episode,
          resumeAt: resumePositionFrom(watchState, episode),
        },
      });
    },
    [detail, onPlay, rememberChoice, seriesContextFor]
  );

  // The handler is embedded in the request it produces, so it needs a stable
  // reference to itself; a ref keeps that from becoming a circular dependency.
  const playEpisodeDirectlyRef = useRef(playEpisodeDirectly);
  useEffect(() => {
    playEpisodeDirectlyRef.current = playEpisodeDirectly;
  }, [playEpisodeDirectly]);

  const flash = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 5000);
  }, []);

  /**
   * One-click play from the detail page.
   *
   * Choosing a source by hand is a power-user action, not the common path, and
   * requiring it for every episode is the main reason watching something took
   * four clicks. When automatic resolution fails the picker opens with the real
   * reason, so the escape hatch is still one click away.
   */
  const playNow = useCallback(
    async (episode: Episode | null) => {
      if (!window.cloudstream || !detail) return;

      setAutoPlaying(episode?.url ?? 'movie');
      try {
        if (episode) {
          await playEpisodeDirectly(episode);
          return;
        }

        const response = await window.cloudstream.autoPlay({ mediaUrl: detail.url });
        if (!response.ok || !response.handle || !response.source) {
          throw new Error(response.error ?? 'No working source was found.');
        }

        window.cloudstream.upsertLibraryEntry({
          title: detail.name,
          year: detail.year,
          type: detail.type,
          posterUrl: detail.posterUrl,
          mediaUrl: detail.url,
        });
        rememberChoice(response.source, null);

        const watchState = await loadWatchState(detail.url);
        onPlay({
          streamUrl: response.handle.streamUrl,
          mimeType: response.handle.mimeType,
          title: detail.name,
          infoHash: response.handle.infoHash,
          subtitles: response.handle.subtitleUrls,
          progress: {
            mediaUrl: detail.url,
            year: detail.year,
            posterUrl: detail.posterUrl,
            resumeAt: resumePositionFrom(watchState, null),
          },
        });
      } catch (error) {
        flash(error instanceof Error ? error.message : 'Could not start playback.');
        openSources(episode);
      } finally {
        setAutoPlaying(null);
      }
    },
    [detail, onPlay, playEpisodeDirectly, rememberChoice, openSources, flash]
  );

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
      if (!detail) return;

      const task: DownloadTask = {
        id: `${source.infoHash}-${pendingEpisode?.episode ?? 'movie'}`,
        parentId: detail.url,
        title: detail.name,
        episodeNumber: pendingEpisode?.episode,
        seasonNumber: pendingEpisode?.season,
        posterUrl: detail.posterUrl,
        targetFilePath: '',
        link: {
          source: source.indexerName,
          name: source.title,
          url: source.magnet || source.torrentUrl || source.infoHash,
          referer: '',
          quality: source.parsed.resolution || 720,
        },
        headers: {},
        bytesDownloaded: 0,
        totalBytes: source.sizeBytes,
        downloadSpeed: 0,
        etaSeconds: 0,
        state: DownloadState.Queued,
        providerName: source.indexerName,
        createdTime: Date.now(),
      };

      onEnqueueDownload(task);
      setPickerOpen(false);
      setToast(`Added “${detail.name}” to downloads.`);
      setTimeout(() => setToast(null), 4000);
    },
    [detail, pendingEpisode, onEnqueueDownload]
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
        <p>{loadError ?? 'No details available.'}</p>
        <button className="btn" onClick={onBack}>
          <ArrowLeft size={16} /> Back
        </button>
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
              disabled={startingStream || autoPlaying !== null}
            >
              {autoPlaying !== null ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
              {autoPlaying !== null
                ? 'Finding a source…'
                : isSeries
                  ? 'Play first episode'
                  : 'Play'}
            </button>
            <LibraryBucketSelector item={detail} size="md" />
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
                    disabled={autoPlaying !== null}
                  >
                    {autoPlaying === episode.url ? (
                      <Loader2 className="spin" size={14} />
                    ) : (
                      <Play size={14} />
                    )}
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
