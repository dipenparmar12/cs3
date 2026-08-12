import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Play, Star, Calendar, Clock } from 'lucide-react';
import type { Episode } from '../../types/api';

/**
 * In-player series browser.
 *
 * On Android, the player carries the show's context with it — what you are
 * watching, where it sits in the season, and what comes next. Desktop had none
 * of that: leaving the player was the only way to find episode 5.
 *
 * The panel slides over the video rather than resizing it, so opening it never
 * reflows the picture mid-scene.
 */

export interface SeriesContext {
  title: string;
  posterUrl?: string;
  plot?: string;
  year?: number;
  rating?: number;
  tags?: string[];
  duration?: string;
  episodes: Episode[];
  /** URL of the episode currently playing, used to highlight and to seed next/prev. */
  currentEpisodeUrl?: string;
}

interface EpisodePanelProps {
  series: SeriesContext;
  open: boolean;
  onClose: () => void;
  onSelectEpisode: (episode: Episode) => void;
}

export const EpisodePanel: React.FC<EpisodePanelProps> = ({
  series,
  open,
  onClose,
  onSelectEpisode,
}) => {
  const seasons = useMemo(() => {
    const map = new Map<number, Episode[]>();
    for (const episode of series.episodes) {
      const season = episode.season ?? 1;
      const list = map.get(season) ?? [];
      list.push(episode);
      map.set(season, list);
    }
    for (const list of map.values()) list.sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0));
    return map;
  }, [series.episodes]);

  const currentSeason = useMemo(() => {
    const current = series.episodes.find((e) => e.url === series.currentEpisodeUrl);
    return current?.season ?? [...seasons.keys()].sort((a, b) => a - b)[0] ?? 1;
  }, [series.episodes, series.currentEpisodeUrl, seasons]);

  const [activeSeason, setActiveSeason] = useState(currentSeason);
  useEffect(() => setActiveSeason(currentSeason), [currentSeason]);

  const activeRef = useRef<HTMLButtonElement | null>(null);

  // Bring the playing episode into view when the panel opens. In a 200-episode
  // season, opening at the top of the list is not useful.
  useEffect(() => {
    if (open) activeRef.current?.scrollIntoView({ block: 'center' });
  }, [open, activeSeason]);

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

  if (!open) return null;

  const seasonNumbers = [...seasons.keys()].sort((a, b) => a - b);
  const episodes = seasons.get(activeSeason) ?? [];

  return (
    <aside className="player-panel" aria-label={`${series.title} episodes`}>
      <header className="player-panel__head">
        <div className="player-panel__meta">
          {series.posterUrl && (
            <img src={series.posterUrl} alt="" className="player-panel__poster" loading="lazy" />
          )}
          <div>
            <h3>{series.title}</h3>
            <div className="player-panel__facts">
              {series.year && (
                <span>
                  <Calendar size={12} /> {series.year}
                </span>
              )}
              {typeof series.rating === 'number' && (
                <span>
                  <Star size={12} /> {series.rating.toFixed(1)}
                </span>
              )}
              {series.duration && (
                <span>
                  <Clock size={12} /> {series.duration}
                </span>
              )}
            </div>
            {series.tags && series.tags.length > 0 && (
              <div className="player-panel__tags">
                {series.tags.slice(0, 4).map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
            )}
          </div>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close episode list">
          <X size={18} />
        </button>
      </header>

      {series.plot && <p className="player-panel__plot">{series.plot}</p>}

      {seasonNumbers.length > 1 && (
        <div className="player-panel__seasons" role="tablist" aria-label="Seasons">
          {seasonNumbers.map((season) => (
            <button
              key={season}
              role="tab"
              aria-selected={season === activeSeason}
              className={`player-panel__season${
                season === activeSeason ? ' player-panel__season--active' : ''
              }`}
              onClick={() => setActiveSeason(season)}
            >
              S{season}
            </button>
          ))}
        </div>
      )}

      <ul className="player-panel__episodes">
        {episodes.map((episode) => {
          const isCurrent = episode.url === series.currentEpisodeUrl;
          return (
            <li key={episode.url}>
              <button
                ref={isCurrent ? activeRef : undefined}
                className={`player-panel__episode${
                  isCurrent ? ' player-panel__episode--current' : ''
                }`}
                onClick={() => onSelectEpisode(episode)}
                aria-current={isCurrent || undefined}
              >
                {episode.posterUrl ? (
                  <img src={episode.posterUrl} alt="" loading="lazy" />
                ) : (
                  <div className="player-panel__episode-fallback">
                    {episode.episode ?? '?'}
                  </div>
                )}
                <div className="player-panel__episode-text">
                  <strong>
                    {episode.episode != null && `${episode.episode}. `}
                    {episode.name || `Episode ${episode.episode ?? ''}`}
                  </strong>
                  {episode.description && <span>{episode.description}</span>}
                  {episode.date && <em>{episode.date}</em>}
                </div>
                {isCurrent ? (
                  <span className="player-panel__now">Now playing</span>
                ) : (
                  <Play size={15} className="player-panel__episode-play" />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
};
