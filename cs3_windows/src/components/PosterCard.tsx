import React, { useRef, useState } from 'react';
import { Poster } from './Poster';
import {
  AlertTriangle,
  Check,
  Download,
  DownloadCloud,
  Play,
  RotateCcw,
  Target,
  Zap,
} from 'lucide-react';
import type { SearchResponse } from '../types/api';
import type { TitleInteraction } from '../types/interactions';
import { CardBadge, badgeLabel, badgeTooltip, cardStateFor, primaryBadge } from '../utils/cardState';
import { ContentHoverCard } from './ContentHoverCard';
import { LibraryBucketSelector } from './LibraryBucketSelector';

interface PosterCardProps {
  item: SearchResponse;
  onSelectMedia: (item: SearchResponse) => void;
  onPlayDirectly?: (item: SearchResponse) => void;
  progressPercent?: number;
  watchedText?: string | null;
  showBucketButton?: boolean;
  /**
   * Everything the app already knows about this title.
   *
   * One record rather than a flag per state, because the states are not
   * independent — a downloaded film that is half-watched and failed from a
   * different provider last week is three true things competing for one corner,
   * and that precedence is a decision, made once, in `cardState.ts`.
   *
   * Optional throughout: a surface that has not been wired to
   * `useTitleInteractions` draws exactly the card it drew before, which is what
   * makes this safe to adopt one screen at a time.
   */
  interaction?: TitleInteraction;
  /**
   * The old single-outcome prop, still honoured.
   *
   * Search passed this before the interaction record existed. Kept so the two
   * cannot disagree during the changeover — `interaction` wins where both are
   * present, since it is the one assembled from every store rather than from
   * one.
   */
  outcome?: { kind: 'played' | 'no-sources' | 'app-error'; reason?: string };
}

/** The glyph for each state. Small, monochrome, and never a colour on its own. */
const BADGE_ICONS: Record<CardBadge, React.ReactNode> = {
  [CardBadge.Downloading]: <DownloadCloud size={11} aria-hidden />,
  [CardBadge.Downloaded]: <Download size={11} aria-hidden />,
  [CardBadge.Failed]: <AlertTriangle size={11} aria-hidden />,
  [CardBadge.NoSources]: <AlertTriangle size={11} aria-hidden />,
  [CardBadge.Continue]: <RotateCcw size={11} aria-hidden />,
  [CardBadge.Ready]: <Zap size={11} aria-hidden />,
  [CardBadge.Watched]: <Check size={11} aria-hidden />,
};

/** Feature flag to control hover preview popups on cards. Set to true to enable. */
const ENABLE_HOVER_CARD_PREVIEW = false;

export const PosterCard: React.FC<PosterCardProps> = ({
  item,
  onSelectMedia,
  onPlayDirectly,
  progressPercent,
  watchedText,
  showBucketButton = true,
  interaction,
  outcome,
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

  /**
   * The old `outcome` prop folded in, so one code path draws both.
   *
   * During the changeover some screens pass `interaction` and some still pass
   * `outcome`; running two rendering paths would be how the same title comes to
   * look different on two screens, which is the whole thing this record exists
   * to stop.
   */
  const state = cardStateFor(
    interaction ??
      (outcome
        ? { url: item?.url ?? '', key: '', outcome: { ...outcome, at: Date.now() } }
        : null)
  );
  const badge = primaryBadge(state);
  // The bar is the caller's where one was given — Continue Watching rows know
  // their own position — and the record's otherwise.
  const bar = progressPercent ?? state.progressPercent;

  return (
    <div
      ref={cardRef}
      className={`poster-card${
        state.visited ? ' poster-card--visited' : ''
      }${ENABLE_HOVER_CARD_PREVIEW && hoverCardOpen ? ' poster-card--active-hover' : ''}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* A `div` with an `onClick` opened every title in the app and could not
          be reached from the keyboard at all — while `.poster-card:focus-visible`
          had been styled in `index.css` the whole time, which says someone meant
          this to be focusable. It is a link, not a command: it navigates. */}
      <div
        className="poster-container"
        onClick={handleCardClick}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handleCardClick(event as unknown as React.MouseEvent);
          }
        }}
        role="link"
        tabIndex={0}
        aria-label={`Open ${titleText}`}
      >
        <Poster src={item?.posterUrl} title={titleText} />
        {item?.isExactMatch ? (
          <span className="poster-badge poster-badge--match">
            <Target size={11} aria-hidden /> Best match
          </span>
        ) : (
          <span className="poster-badge">{item?.type || 'Movie'}</span>
        )}

        {/*
          One badge, in one corner.

          States coexist — downloaded and half-watched and failed elsewhere last
          week are all true at once — and a card with three markers on it is a
          debug overlay rather than a poster. `primaryBadge` ranks them by what
          the viewer would do about each, and the tooltip carries the detail so
          nothing is lost to the shortening.
        */}
        {badge && (
          <span
            className={`poster-state poster-state--${badge}`}
            title={badgeTooltip(badge, interaction)}
          >
            {BADGE_ICONS[badge]}
            <span className="poster-state__label">{badgeLabel(badge)}</span>
          </span>
        )}

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

        {bar != null && bar > 0 && (
          <div className="poster-progress">
            <div style={{ width: `${Math.min(100, bar)}%` }} />
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
            <LibraryBucketSelector
              item={item}
              size="sm"
              showLabel={false}
              known={interaction ? (interaction.library ?? null) : undefined}
              deferFetch
            />
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
