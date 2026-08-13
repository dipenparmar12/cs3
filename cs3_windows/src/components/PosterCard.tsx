import React, { useRef, useState } from 'react';
import { Play } from 'lucide-react';
import type { SearchResponse } from '../types/api';
import { ContentHoverCard } from './ContentHoverCard';
import { LibraryBucketSelector } from './LibraryBucketSelector';

interface PosterCardProps {
  item: SearchResponse;
  onSelectMedia: (item: SearchResponse) => void;
  onPlayDirectly?: (item: SearchResponse) => void;
  progressPercent?: number;
  watchedText?: string | null;
  showBucketButton?: boolean;
}

export const PosterCard: React.FC<PosterCardProps> = ({
  item,
  onSelectMedia,
  onPlayDirectly,
  progressPercent,
  watchedText,
  showBucketButton = true,
}) => {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [hoverCardOpen, setHoverCardOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const hoverTimer = useRef<number | null>(null);

  const handleMouseEnter = () => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => {
      if (cardRef.current) {
        const rect = cardRef.current.getBoundingClientRect();
        setAlignRight(rect.right + 140 > window.innerWidth);
        setHoverCardOpen(true);
      }
    }, 600);
  };

  const handleMouseLeave = () => {
    if (hoverTimer.current) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    setHoverCardOpen(false);
  };

  const titleText = item?.name || 'Untitled';

  return (
    <div
      ref={cardRef}
      className={`poster-card${hoverCardOpen ? ' poster-card--active-hover' : ''}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="poster-container" onClick={() => onSelectMedia(item)}>
        {item?.posterUrl ? (
          <img src={item.posterUrl} alt={titleText} loading="lazy" />
        ) : (
          <div className="poster-image--empty">{titleText.slice(0, 1)}</div>
        )}
        <span className="poster-badge">{item?.type || 'Movie'}</span>

        <div className="poster-overlay">
          <button className="play-button-overlay">
            <Play size={20} fill="#fff" />
          </button>
        </div>

        {progressPercent != null && progressPercent > 0 && (
          <div className="poster-progress">
            <div style={{ width: `${Math.min(100, progressPercent)}%` }} />
          </div>
        )}
      </div>

      <div className="poster-info">
        <h4 className="poster-title" title={titleText} onClick={() => onSelectMedia(item)}>
          {titleText}
        </h4>
        <div className="poster-meta">
          {item?.year && <span>{item.year}</span>}
          {item?.apiName && (
            <span style={{ color: 'var(--accent-light)', fontSize: '0.72rem' }}>{item.apiName}</span>
          )}
        </div>

        {showBucketButton && item?.url && (
          <div style={{ marginTop: '0.4rem' }}>
            <LibraryBucketSelector item={item} size="sm" showLabel={false} />
          </div>
        )}
      </div>

      {hoverCardOpen && (
        <ContentHoverCard
          item={item}
          alignRight={alignRight}
          onSelectMedia={onSelectMedia}
          onPlayDirectly={onPlayDirectly}
          onClose={() => setHoverCardOpen(false)}
        />
      )}
    </div>
  );
};
