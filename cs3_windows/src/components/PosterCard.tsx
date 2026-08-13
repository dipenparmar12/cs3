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

/** Feature flag to control hover preview popups on cards. Set to true to enable. */
const ENABLE_HOVER_CARD_PREVIEW = false;

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
    if (!ENABLE_HOVER_CARD_PREVIEW) return;
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

  const releaseCardFocus = (e: React.MouseEvent) => {
    handleMouseLeave();
    (e.currentTarget as HTMLElement)?.blur();
    (document.activeElement as HTMLElement)?.blur();
  };

  const handleCardClick = (e: React.MouseEvent) => {
    releaseCardFocus(e);
    onSelectMedia(item);
  };

  const handlePlayClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    releaseCardFocus(e);
    if (onPlayDirectly) onPlayDirectly(item);
    else onSelectMedia(item);
  };

  const titleText = item?.name || 'Untitled';

  return (
    <div
      ref={cardRef}
      className={`poster-card${ENABLE_HOVER_CARD_PREVIEW && hoverCardOpen ? ' poster-card--active-hover' : ''}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="poster-container" onClick={handleCardClick}>
        {item?.posterUrl ? (
          <img src={item.posterUrl} alt={titleText} loading="lazy" />
        ) : (
          <div className="poster-image--empty">{titleText.slice(0, 1)}</div>
        )}
        <span className="poster-badge">{item?.type || 'Movie'}</span>

        {/* Two intents on one card: the poster opens details, this opens the
            player. Without it, watching something meant four clicks through
            details and a source list, which is the friction this removes.
            The click must not bubble — the container behind it navigates. */}
        <div className="poster-overlay">
          <button
            className="play-button-overlay"
            aria-label={`Play ${titleText}`}
            title="Play now"
            onClick={handlePlayClick}
          >
            <Play size={17} fill="#fff" />
          </button>
        </div>

        {progressPercent != null && progressPercent > 0 && (
          <div className="poster-progress">
            <div style={{ width: `${Math.min(100, progressPercent)}%` }} />
          </div>
        )}
      </div>

      <div className="poster-info">
        <h4 className="poster-title" title={titleText} onClick={handleCardClick}>
          {titleText}
        </h4>
        <div className="poster-meta">
          {item?.year && <span>{item.year}</span>}
          {item?.apiName && (
            <span style={{ color: 'var(--accent-light)', fontSize: '0.72rem' }}>{item.apiName}</span>
          )}
        </div>

        {/* Where the viewer left off. Supplied by the library and continue-watching
            rows, which is the only place a resume point is meaningful. */}
        {watchedText && <p className="poster-watched">{watchedText}</p>}

        {showBucketButton && item?.url && (
          <div style={{ marginTop: '0.4rem' }}>
            <LibraryBucketSelector item={item} size="sm" showLabel={false} />
          </div>
        )}
      </div>

      {ENABLE_HOVER_CARD_PREVIEW && hoverCardOpen && (
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
