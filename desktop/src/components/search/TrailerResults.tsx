import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Clapperboard,
  Copy,
  ExternalLink,
  Film,
  Loader2,
  Play,
  SearchX,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import type { SearchCategory, SearchResponse } from '../../types/api';
import type { TitleVideo } from '../../types/metadata';
import { TitleVideoKind } from '../../types/metadata';
import { Poster } from '../Poster';
import { EmptyState } from '../EmptyState';
import { formatVideoDuration } from '../../utils/videoGallery';
import { categoryHeading } from '../../utils/searchCategories';

export interface TrailerResultsProps {
  query: string;
  categories: SearchCategory[];
  onPlayTrailer: (videos: TitleVideo[], startId: string, titleName: string) => void;
  onSelectMedia?: (item: SearchResponse) => void;
  onSearchTitles: (query: string) => void;
}

type KindFilter = 'all' | 'trailer' | 'teaser' | 'clip' | 'bts';

type SortOption = 'relevance' | 'duration' | 'title';

/**
 * Strips promotional and formatting suffixes from a video title to infer
 * the underlying movie/show title for standard search navigation.
 */
function inferTitleFromVideo(title: string): string {
  // If separated by pipe or dash, usually the first segment is the movie title
  const parts = title.split(/\s*[|–—]\s*|\s+-\s+/);
  if (parts.length > 1 && parts[0].trim().length > 1) {
    return parts[0].trim();
  }
  return title
    .replace(/\b(official\s+)?(trailer|teaser|clip|featurette|behind the scenes|bts|tv spot|promo)\b.*$/i, '')
    .trim() || title.trim();
}

export const TrailerResults: React.FC<TrailerResultsProps> = ({
  query,
  categories,
  onPlayTrailer,
  onSearchTitles,
}) => {
  const [videos, setVideos] = useState<TitleVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Filters & sorting
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [officialOnly, setOfficialOnly] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>('relevance');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const trimmed = query.trim();
    if (!trimmed) {
      setVideos([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const run = async () => {
      try {
        if (!window.cloudstream?.searchTrailers) {
          // Fallback if searchTrailers not yet mounted
          const res = await window.cloudstream?.findTrailers?.(trimmed);
          if (active) {
            setVideos(res?.videos ?? []);
            setLoading(false);
          }
          return;
        }

        const res = await window.cloudstream.searchTrailers(trimmed, { maxResults: 30 });
        if (active) {
          if (res.ok) {
            setVideos(res.videos ?? []);
          } else {
            setError(res.error ?? 'Failed to discover trailers');
          }
          setLoading(false);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    };

    void run();

    return () => {
      active = false;
    };
  }, [query, attempt]);

  const counts = useMemo(() => {
    let trailers = 0;
    let teasers = 0;
    let clips = 0;
    let bts = 0;
    let official = 0;

    for (const v of videos) {
      if (v.official) official++;
      if (v.kind === TitleVideoKind.Trailer) trailers++;
      else if (v.kind === TitleVideoKind.Teaser) teasers++;
      else if (v.kind === TitleVideoKind.Clip) clips++;
      else if (
        v.kind === TitleVideoKind.BehindTheScenes ||
        v.kind === TitleVideoKind.Featurette ||
        v.kind === TitleVideoKind.Interview
      ) {
        bts++;
      }
    }

    return { total: videos.length, trailers, teasers, clips, bts, official };
  }, [videos]);

  const filteredVideos = useMemo(() => {
    let list = videos;

    if (officialOnly) {
      list = list.filter((v) => v.official === true);
    }

    if (kindFilter !== 'all') {
      list = list.filter((v) => {
        if (kindFilter === 'trailer') return v.kind === TitleVideoKind.Trailer;
        if (kindFilter === 'teaser') return v.kind === TitleVideoKind.Teaser;
        if (kindFilter === 'clip') return v.kind === TitleVideoKind.Clip;
        if (kindFilter === 'bts') {
          return (
            v.kind === TitleVideoKind.BehindTheScenes ||
            v.kind === TitleVideoKind.Featurette ||
            v.kind === TitleVideoKind.Interview
          );
        }
        return true;
      });
    }

    if (sortBy === 'duration') {
      list = [...list].sort((a, b) => (b.durationSeconds ?? 0) - (a.durationSeconds ?? 0));
    } else if (sortBy === 'title') {
      list = [...list].sort((a, b) => a.title.localeCompare(b.title));
    }

    return list;
  }, [videos, officialOnly, kindFilter, sortBy]);

  const handleCopyLink = useCallback((e: React.MouseEvent, v: TitleVideo) => {
    e.stopPropagation();
    if (navigator?.clipboard?.writeText) {
      void navigator.clipboard.writeText(v.url);
      setCopiedId(v.id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  }, []);

  const handleSearchWork = useCallback(
    (e: React.MouseEvent, v: TitleVideo) => {
      e.stopPropagation();
      const targetTitle = inferTitleFromVideo(v.title);
      onSearchTitles(targetTitle);
    },
    [onSearchTitles]
  );

  const heading = (
    <header className="trailer-results__head">
      <div className="trailer-results__title-row">
        <h2>{categoryHeading(categories, query)}</h2>
        <span className="search-group__note">
          {loading
            ? 'Discovering public trailers and clips…'
            : `${videos.length} promotional video${videos.length === 1 ? '' : 's'} found`}
        </span>
      </div>

      {!loading && videos.length > 0 && (
        <div className="trailer-results__controls">
          <div className="trailer-results__filters" role="tablist" aria-label="Filter promotional media by type">
            <button
              type="button"
              className={`trailer-results__chip${kindFilter === 'all' ? ' trailer-results__chip--on' : ''}`}
              onClick={() => setKindFilter('all')}
            >
              All ({counts.total})
            </button>
            {counts.trailers > 0 && (
              <button
                type="button"
                className={`trailer-results__chip${kindFilter === 'trailer' ? ' trailer-results__chip--on' : ''}`}
                onClick={() => setKindFilter('trailer')}
              >
                Trailers ({counts.trailers})
              </button>
            )}
            {counts.teasers > 0 && (
              <button
                type="button"
                className={`trailer-results__chip${kindFilter === 'teaser' ? ' trailer-results__chip--on' : ''}`}
                onClick={() => setKindFilter('teaser')}
              >
                Teasers ({counts.teasers})
              </button>
            )}
            {counts.clips > 0 && (
              <button
                type="button"
                className={`trailer-results__chip${kindFilter === 'clip' ? ' trailer-results__chip--on' : ''}`}
                onClick={() => setKindFilter('clip')}
              >
                Clips ({counts.clips})
              </button>
            )}
            {counts.bts > 0 && (
              <button
                type="button"
                className={`trailer-results__chip${kindFilter === 'bts' ? ' trailer-results__chip--on' : ''}`}
                onClick={() => setKindFilter('bts')}
              >
                BTS & Featurettes ({counts.bts})
              </button>
            )}
          </div>

          <div className="trailer-results__actions">
            <button
              type="button"
              className={`trailer-results__toggle${officialOnly ? ' trailer-results__toggle--on' : ''}`}
              onClick={() => setOfficialOnly((prev) => !prev)}
              aria-pressed={officialOnly}
              title="Show only videos uploaded by official studios and networks"
            >
              <ShieldCheck size={14} />
              <span>Official Channels Only</span>
            </button>

            <select
              className="trailer-results__sort"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              aria-label="Sort videos"
            >
              <option value="relevance">Sort: Relevance</option>
              <option value="duration">Sort: Duration</option>
              <option value="title">Sort: Title</option>
            </select>
          </div>
        </div>
      )}
    </header>
  );

  if (loading) {
    return (
      <div className="trailer-results">
        {heading}
        <p className="trailer-results__loading" role="status">
          <Loader2 size={16} className="spin" /> Searching YouTube and public video platforms for “{query.trim()}”…
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="trailer-results">
        {heading}
        <EmptyState
          icon={AlertTriangle}
          title="Could not find trailers right now"
          description={error}
          action={{ label: 'Try again', onClick: () => setAttempt((n) => n + 1) }}
        />
      </div>
    );
  }

  if (videos.length === 0) {
    return (
      <div className="trailer-results">
        {heading}
        <EmptyState
          icon={SearchX}
          title={`No trailers found for “${query.trim()}”`}
          description="Check the spelling, or search for titles and stream providers directly."
          action={{ label: 'Search titles instead', onClick: () => onSearchTitles(query) }}
        />
      </div>
    );
  }

  if (filteredVideos.length === 0) {
    return (
      <div className="trailer-results">
        {heading}
        <EmptyState
          icon={Film}
          title="No promotional videos match the active filters"
          description="Try resetting the type filter or disabling the official channels restriction."
          action={{
            label: 'Reset filters',
            onClick: () => {
              setKindFilter('all');
              setOfficialOnly(false);
            },
          }}
        />
      </div>
    );
  }

  return (
    <div className="trailer-results">
      {heading}

      <div className="trailer-results__grid">
        {filteredVideos.map((video) => {
          const duration = formatVideoDuration(video.durationSeconds);
          const isCopied = copiedId === video.id;

          return (
            <article
              key={video.id}
              className="trailer-card"
              onClick={() => onPlayTrailer(filteredVideos, video.id, video.title)}
            >
              <div className="trailer-card__frame">
                <Poster
                  src={video.thumbnailUrl}
                  title={video.title}
                  decorative
                  className="trailer-card__image"
                  fallback={
                    <span className="trailer-card__placeholder" aria-hidden>
                      <Film size={28} />
                    </span>
                  }
                />

                <span className="trailer-card__play" aria-hidden>
                  <Play size={22} fill="currentColor" />
                </span>

                <span className="trailer-card__badge-kind">
                  {video.kind === TitleVideoKind.Trailer && <Clapperboard size={11} />}
                  {video.kind === TitleVideoKind.Teaser && <Sparkles size={11} />}
                  <span>{video.label || 'Video'}</span>
                </span>

                {duration && <span className="trailer-card__badge-duration">{duration}</span>}
              </div>

              <div className="trailer-card__content">
                <h3 className="trailer-card__title" title={video.title}>
                  {video.title}
                </h3>

                <div className="trailer-card__meta">
                  {video.publisher && <span className="trailer-card__publisher">{video.publisher}</span>}
                  {video.official && (
                    <span className="trailer-card__badge-official" title="Verified official channel upload">
                      <ShieldCheck size={12} /> Official
                    </span>
                  )}
                </div>

                <div className="trailer-card__actions">
                  <button
                    type="button"
                    className="trailer-card__btn-play"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPlayTrailer(filteredVideos, video.id, video.title);
                    }}
                    title="Play trailer now"
                  >
                    <Play size={13} fill="currentColor" /> Play
                  </button>

                  <button
                    type="button"
                    className="trailer-card__btn-action"
                    onClick={(e) => handleSearchWork(e, video)}
                    title="Search for this title in CS3"
                  >
                    <ExternalLink size={13} /> Find Title
                  </button>

                  <button
                    type="button"
                    className="trailer-card__btn-action"
                    onClick={(e) => handleCopyLink(e, video)}
                    title="Copy video link"
                  >
                    {isCopied ? <Check size={13} className="text-green" /> : <Copy size={13} />}
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
};
