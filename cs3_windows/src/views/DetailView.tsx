import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Play, Download, Star, ArrowLeft, Loader2, AlertTriangle, Calendar } from 'lucide-react';
import type { SearchResponse, Episode } from '../types/api';
import { TvType } from '../types/api';
import { DownloadState } from '../types/download';
import type { DownloadTask } from '../types/download';
import type { TorrentResult } from '../types/torrent';
import { SourcePicker, type SourcePickerData } from '../components/SourcePicker';

export interface PlaybackRequest {
  streamUrl: string;
  mimeType: string;
  title: string;
  episodeTitle?: string;
  infoHash: string;
  subtitles: Array<{ name: string; url: string }>;
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
  const [toast, setToast] = useState<string | null>(null);

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
        setPickerError(response.error ?? 'Could not start the stream.');
        return;
      }

      setPickerOpen(false);
      onPlay({
        streamUrl: response.handle.streamUrl,
        mimeType: response.handle.mimeType,
        title: detail.name,
        episodeTitle: pendingEpisode?.name,
        infoHash: response.handle.infoHash,
        subtitles: response.handle.subtitleUrls,
      });
    },
    [detail, pendingEpisode, onPlay]
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
              onClick={() => openSources(isSeries ? episodesInSeason[0] ?? null : null)}
              disabled={startingStream}
            >
              <Play size={16} /> {isSeries ? 'Play first episode' : 'Find sources'}
            </button>
            <button
              className="btn"
              onClick={() => openSources(isSeries ? episodesInSeason[0] ?? null : null)}
            >
              <Download size={16} /> Download
            </button>
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
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    setSelectedEpisode(episode);
                    openSources(episode);
                  }}
                >
                  <Play size={14} /> Play
                </button>
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

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
};
