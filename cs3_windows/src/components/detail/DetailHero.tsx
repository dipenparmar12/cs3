import React, { useEffect, useRef, useState } from 'react';
import {
  Bookmark as BookmarkIcon,
  BookmarkCheck,
  Calendar,
  Clock,
  Download,
  Layers,
  ListVideo,
  MoreHorizontal,
  Play,
  RefreshCw,
  Search,
  SearchCheck,
  Star,
  Loader2,
  Zap,
} from 'lucide-react';

/**
 * The detail page's masthead.
 *
 * ## What changed and why
 *
 * The page used to be a title, a plot, and then a wall of six equally-weighted
 * buttons: Play, Add to Library, Choose Source, Download, Find More Sources,
 * Search Title — plus Download Season on a series. Every one the same size and
 * the same colour, so the page read as a control panel rather than as a thing
 * you were about to watch, and the single action ninety per cent of visits want
 * had to be found among six.
 *
 * Three changes:
 *
 * 1. **Play lives on the artwork.** It is the reason the page exists, and the
 *    poster is the largest, most obviously clickable thing on it. The whole
 *    artwork is the target, not a small button on top of it.
 * 2. **One row of small secondary actions.** Save, library, download — the ones
 *    people reach for often enough to want visible.
 * 3. **The rest go in an overflow menu.** Choose source, find more sources,
 *    refresh, search title, download season. None is rare enough to remove and
 *    none is common enough to earn permanent space.
 *
 * Provenance is on the page rather than buried, because a title that will not
 * play is a question about *which* provider served it — and that was previously
 * unanswerable without opening the diagnostics panel.
 */

export interface DetailHeroProvenance {
  provider?: string;
  extensionName?: string;
  repositoryName?: string;
  metadataSource?: string;
  searchQuery?: string;
  imdbId?: string;
}

interface DetailHeroProps {
  title: string;
  year?: number;
  type: string;
  posterUrl?: string;
  plot?: string;
  rating?: number;
  duration?: string;
  tags?: string[];
  /** Shown above the meta line when details came from a fallback source. */
  fallbackNote?: string;
  isSeries: boolean;
  provenance: DetailHeroProvenance;
  saved: boolean;
  busy?: boolean;
  /**
   * How the background source search is getting on.
   *
   * Shown because the work is otherwise invisible, and invisible work is
   * indistinguishable from no work: someone who does not know sources are
   * already loading has no reason to expect Play to be instant, and someone
   * whose providers found nothing should learn it here rather than by pressing
   * Play and waiting for the same answer.
   */
  sourceReadiness?: {
    status: 'idle' | 'waiting' | 'searching' | 'ready' | 'empty' | 'failed' | 'disabled';
    count: number;
    fromCache: boolean;
    settled?: number;
    total?: number;
  } | null;

  onPlay: () => void;
  onToggleSave: () => void;
  onChooseSource: () => void;
  onDownload: () => void;
  onFindMoreSources: () => void;
  onRefreshSources: () => void;
  onSearchTitle?: () => void;
  onDownloadSeason?: () => void;
  /** Rendered inside the secondary row; the library bucket selector. */
  libraryControl?: React.ReactNode;
}

export const DetailHero: React.FC<DetailHeroProps> = ({
  title,
  year,
  type,
  posterUrl,
  plot,
  rating,
  duration,
  tags,
  fallbackNote,
  isSeries,
  provenance,
  saved,
  busy = false,
  sourceReadiness,
  onPlay,
  onToggleSave,
  onChooseSource,
  onDownload,
  onFindMoreSources,
  onRefreshSources,
  onSearchTitle,
  onDownloadSeason,
  libraryControl,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuWrapper = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onOutside = (event: PointerEvent) => {
      if (menuWrapper.current && !menuWrapper.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onOutside, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const run = (action: () => void) => () => {
    setMenuOpen(false);
    action();
  };

  const chain = [provenance.repositoryName, provenance.extensionName, provenance.provider].filter(
    Boolean
  ) as string[];

  /**
   * One short phrase, or nothing.
   *
   * `waiting` and `idle` say nothing on purpose: the prefetcher holds off for a
   * moment to see whether the page is actually being read, and announcing that
   * pause would put a label on screen for every title someone merely glanced
   * at. A badge that appears and disappears as you scroll is worse than no
   * badge.
   */
  const readinessLabel = (() => {
    if (!sourceReadiness) return null;
    switch (sourceReadiness.status) {
      case 'ready':
        return sourceReadiness.fromCache
          ? 'Ready to play'
          : `${sourceReadiness.count} source${sourceReadiness.count === 1 ? '' : 's'} ready`;
      case 'searching':
        return sourceReadiness.count > 0
          ? `${sourceReadiness.count} found…`
          : 'Finding sources…';
      case 'empty':
        return 'No sources found';
      default:
        return null;
    }
  })();

  return (
    <header className="detail-hero detail-hero--v2">
      {/*
        The artwork is the play button.

        A `button` rather than a div with a handler: it has to be reachable by
        keyboard and announce itself, and this is the primary action on the page.
      */}
      <button
        type="button"
        className="detail-art"
        onClick={onPlay}
        disabled={busy}
        aria-label={isSeries ? `Play the first episode of ${title}` : `Play ${title}`}
        title={isSeries ? 'Play the first episode' : 'Play'}
      >
        {posterUrl ? (
          <img className="detail-art__image" src={posterUrl} alt="" loading="lazy" />
        ) : (
          <div className="detail-art__placeholder" aria-hidden />
        )}
        <span className="detail-art__scrim" aria-hidden />
        <span className="detail-art__play" aria-hidden>
          <Play size={26} fill="currentColor" />
        </span>
        <span className="detail-art__caption" aria-hidden>
          {isSeries ? 'Play first episode' : 'Play'}
        </span>

        {/*
          Sits on the artwork rather than beside the buttons, because it is
          about what the artwork does. Only ever a state, never a spinner
          blocking anything — the page is fully usable throughout and Play works
          at any point, joining whatever is already running.
        */}
        {readinessLabel && (
          <span
            className={`detail-art__ready detail-art__ready--${sourceReadiness!.status}`}
            aria-hidden
          >
            {sourceReadiness!.status === 'searching' && <Loader2 size={11} className="spin" />}
            {sourceReadiness!.status === 'ready' && <Zap size={11} />}
            {readinessLabel}
          </span>
        )}
      </button>

      <div className="detail-hero__body">
        <h1>{title}</h1>

        {fallbackNote && <p className="detail-hero__fallback">{fallbackNote}</p>}

        <div className="detail-hero__meta">
          {year && (
            <span>
              <Calendar size={14} /> {year}
            </span>
          )}
          {rating !== undefined && (
            <span>
              <Star size={14} /> {rating.toFixed(1)}
            </span>
          )}
          {duration && (
            <span>
              <Clock size={14} /> {duration}
            </span>
          )}
          <span className="badge badge--muted">{type}</span>
        </div>

        {tags && tags.length > 0 && (
          <div className="detail-hero__tags">
            {tags.slice(0, 6).map((tag) => (
              <span key={tag} className="badge badge--muted">
                {tag}
              </span>
            ))}
          </div>
        )}

        {plot && <p className="detail-hero__plot">{plot}</p>}

        {/*
          Where this page came from.

          Small and quiet, but present. Without it a title that returns no
          sources is a dead end with no name attached to it — the user cannot
          tell whether to disable a provider, a whole extension, or nothing.
        */}
        {(chain.length > 0 || provenance.metadataSource) && (
          <p className="detail-origin" title="Where these details came from">
            {chain.length > 0 && (
              <span className="detail-origin__chain">
                {chain.map((part, index) => (
                  <React.Fragment key={`${part}-${index}`}>
                    {index > 0 && <span className="detail-origin__sep">▸</span>}
                    <span>{part}</span>
                  </React.Fragment>
                ))}
              </span>
            )}
            {provenance.metadataSource && (
              <span className="detail-origin__meta">metadata: {provenance.metadataSource}</span>
            )}
            {provenance.imdbId && (
              <span className="detail-origin__meta">{provenance.imdbId}</span>
            )}
          </p>
        )}

        <div className="detail-actions">
          <button
            type="button"
            className={`detail-action${saved ? ' detail-action--on' : ''}`}
            onClick={onToggleSave}
            title={
              saved
                ? 'Remove this page from your saved list'
                : 'Save this page so you can come back to it without searching again'
            }
          >
            {saved ? <BookmarkCheck size={15} /> : <BookmarkIcon size={15} />}
            <span>{saved ? 'Saved' : 'Save'}</span>
          </button>

          {libraryControl}

          <button type="button" className="detail-action" onClick={onDownload}>
            <Download size={15} />
            <span>{isSeries ? 'Download episode' : 'Download'}</span>
          </button>

          <div className="detail-action__more" ref={menuWrapper}>
            <button
              type="button"
              className="detail-action"
              onClick={() => setMenuOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="More actions"
              title="More actions"
            >
              <MoreHorizontal size={15} />
            </button>

            {menuOpen && (
              <div className="detail-menu" role="menu">
                <button role="menuitem" onClick={run(onChooseSource)}>
                  <ListVideo size={14} />
                  <span>
                    <strong>Choose source</strong>
                    <em>Pick from what has already been found.</em>
                  </span>
                </button>
                <button role="menuitem" onClick={run(onFindMoreSources)}>
                  <SearchCheck size={14} />
                  <span>
                    <strong>Find more sources</strong>
                    <em>Ask every enabled provider again, ignoring the cache.</em>
                  </span>
                </button>
                <button role="menuitem" onClick={run(onRefreshSources)}>
                  <RefreshCw size={14} />
                  <span>
                    <strong>Refresh sources</strong>
                    <em>Replace expired links, keeping the ones that still work.</em>
                  </span>
                </button>
                {onSearchTitle && (
                  <button role="menuitem" onClick={run(onSearchTitle)}>
                    <Search size={14} />
                    <span>
                      <strong>Search this title</strong>
                      <em>Search “{title}” across every enabled source.</em>
                    </span>
                  </button>
                )}
                {isSeries && onDownloadSeason && (
                  <button role="menuitem" onClick={run(onDownloadSeason)}>
                    <Layers size={14} />
                    <span>
                      <strong>Download season</strong>
                      <em>Queue every episode in the current season.</em>
                    </span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
