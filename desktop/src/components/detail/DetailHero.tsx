import React, { useEffect, useMemo, useState } from 'react';
import { useIsDeveloper } from '../../utils/ExperienceModeContext';
import { Poster } from '../Poster';
import {
  isAdultItemBlurred,
  useAdultMode,
  useRegisterAdultPresence,
} from '../../utils/useAdultMode';
import {
  Bookmark as BookmarkIcon,
  BookmarkCheck,
  Clock,
  Download,
  Film,
  Layers,
  ListVideo,
  MoreHorizontal,
  Play,
  Search,
  SearchCheck,
  Star,
  Loader2,
  Zap,
} from 'lucide-react';
import { MediaRatings } from './MediaRatings';
import { Menu } from '../ui';
import type { PlotChoice } from '../../utils/metadataDisplay';

/**
 * The detail page's masthead.
 *
 * ## Hierarchy, in the order the eye should take it
 *
 * 1. **The artwork.** The wide backdrop fills the masthead and is shaded only
 *    on the side the text sits — it used to be a 32%-opacity strip faded to
 *    nothing, so a film's best image read as a smudge behind the type. The
 *    poster stays beside it, smaller, as the thing you click to play.
 * 2. **The title**, with search as an icon at the end of its row: searching for
 *    this title is about the title, so it lives on it rather than in a menu.
 * 3. **What it is**: year, runtime, type, rating.
 * 4. **One primary action.** Play — labelled with what it will actually do
 *    ("Resume S2 · E4", "Resume · 43 min left").
 * 5. **Secondary actions as icons** with tooltips: trailer, save, library,
 *    download, share, sources. A row of six labelled buttons is what made the
 *    page read as a control panel.
 * 6. **One overflow item**, "Search again for sources" (and download season
 *    on a series). "Find more" and "Refresh" ran the same search and are one
 *    entry now; "Search this title" became the title's own icon.
 * 7. **The reading**: the plot (clamped, More for the rest), genres, ratings.
 *
 * ## Nothing that arrives late moves what is already there
 *
 * The page opens with what the provider answered; four catalogues and a
 * ratings lookup answer seconds later, one at a time. So the masthead is laid
 * out in the order things *arrive*: everything above Play is known when the
 * page opens, and everything that can come later — the other descriptions,
 * catalogue genres, ratings, a catalogue's original title — sits below it,
 * latest last. The play row used to come after the plot and genres, and every
 * catalogue that answered pushed it down; the text was aligned to the poster's
 * bottom, so the title rose with every row added above it; and the masthead
 * grew 76px taller when a backdrop arrived. Now the frame is the same with or
 * without a backdrop (the poster stands in, softened, until one has loaded),
 * the text is pinned to the top, and Play does not move.
 *
 * Provenance stays on the page, small, because a title that will not play is a
 * question about *which* provider served it.
 */

export interface DetailHeroProvenance {
  provider?: string;
  extensionName?: string;
  repositoryName?: string;
  /**
   * The repository's catalogue id, as distinct from the name shown on screen.
   *
   * Carried because a share link may name a repository and must name it by id:
   * an id is looked up in the shipped catalogue, a name is not resolvable and a
   * URL would make opening a link equivalent to installing whatever the sender
   * chose — the rule `ott:installSuggestion` already enforces.
   */
  repositoryId?: string;
  metadataSource?: string;
  searchQuery?: string;
  imdbId?: string;
}

interface DetailHeroProps {
  title: string;
  originalTitle?: string;
  /**
   * An original title only a catalogue knew, so it arrived after the page drew.
   * Shown at the foot rather than under the title, where it would push Play.
   */
  lateOriginalTitle?: string;
  year?: number;
  type: string;
  posterUrl?: string;
  /** Wide artwork behind the masthead; decorative, so a background. */
  backdropUrl?: string;
  /** Whether this title is classified as adult/NSFW content. */
  sensitive?: boolean;
  /** Stable key for individual item unblur tracking. */
  itemKey?: string;
  plot?: string;
  /**
   * Other descriptions of the title, provider's first (`plotChoices`). With
   * two or more, a quiet switch under the plot says who wrote each.
   */
  plotChoices?: PlotChoice[];
  rating?: number;
  /** Already formatted ("2 h 16 min"). */
  duration?: string;
  tmdbId?: number;
  /** Genres merged from the provider and the catalogues, provider first. */
  tags?: string[];
  /** Series: "3 seasons · 30 episodes". */
  seriesSummary?: string;
  /** Shown above the meta line when details came from a fallback source. */
  fallbackNote?: string;
  isSeries: boolean;
  provenance: DetailHeroProvenance;
  saved: boolean;
  busy?: boolean;
  /** What Play will do: "Resume S2 · E4", "Resume · 43 min left", "Play". */
  playLabel?: string;
  /** Background source search progress, shown on the artwork. */
  sourceReadiness?: {
    status: 'idle' | 'waiting' | 'searching' | 'ready' | 'empty' | 'failed' | 'disabled';
    count: number;
    fromCache: boolean;
    settled?: number;
    total?: number;
  } | null;

  onPlay: () => void;
  onToggleSave: () => void;
  /** Opens the list of sources for this title. */
  onChooseSource: () => void;
  onDownload: () => void;
  /** Searches every provider again, past the cache. */
  onFindMoreSources: () => void;
  /** Kept for callers; the menu offers one combined entry. */
  onRefreshSources?: () => void;
  onSearchTitle?: () => void;
  onWatchTrailer?: () => void;
  shareControl?: React.ReactNode;
  onDownloadSeason?: () => void;
  /** The library bucket selector, rendered as an icon. */
  libraryControl?: React.ReactNode;
}

const PLOT_CLAMP = 280;

export const DetailHero: React.FC<DetailHeroProps> = ({
  title,
  originalTitle,
  lateOriginalTitle,
  year,
  type,
  posterUrl,
  backdropUrl,
  sensitive = false,
  itemKey,
  plot: providedPlot,
  plotChoices,
  rating,
  duration,
  tmdbId,
  tags,
  seriesSummary,
  fallbackNote,
  isSeries,
  provenance,
  saved,
  busy = false,
  playLabel,
  sourceReadiness,
  onPlay,
  onToggleSave,
  onChooseSource,
  onDownload,
  onFindMoreSources,
  onSearchTitle,
  onWatchTrailer,
  shareControl,
  onDownloadSeason,
  libraryControl,
}) => {
  const isDeveloper = useIsDeveloper();
  const adult = useAdultMode();
  useRegisterAdultPresence(sensitive);
  const resolvedItemKey = itemKey || provenance.imdbId || title;
  const backdropBlurred = sensitive && isAdultItemBlurred(adult, resolvedItemKey);
  const [plotOpen, setPlotOpen] = useState(false);
  const [plotChoiceId, setPlotChoiceId] = useState<string | null>(null);
  const choices = plotChoices ?? [];
  const chosenPlot = choices.find((choice) => choice.id === plotChoiceId) ?? choices[0];
  const plot = chosenPlot?.text ?? providedPlot;

  const shownBackdrop = useLoadedImage(backdropUrl);
  const ratingsIdentity = useMemo(
    () => ({
      title,
      originalTitle,
      imdbId: provenance.imdbId,
      tmdbId,
      year,
      type: (isSeries ? 'series' : 'movie') as 'series' | 'movie',
    }),
    [title, originalTitle, provenance.imdbId, tmdbId, year, isSeries]
  );

  const chain = [provenance.repositoryName, provenance.extensionName, provenance.provider].filter(
    Boolean
  ) as string[];

  /** One short phrase on the artwork, or nothing — see `sourceReadiness`. */
  const readinessLabel = (() => {
    if (!sourceReadiness) return null;
    switch (sourceReadiness.status) {
      case 'ready':
        return sourceReadiness.fromCache
          ? 'Ready to play'
          : `${sourceReadiness.count} source${sourceReadiness.count === 1 ? '' : 's'} ready`;
      case 'searching':
        return sourceReadiness.count > 0 ? `${sourceReadiness.count} found…` : 'Finding sources…';
      case 'empty':
        return 'No sources found';
      default:
        return null;
    }
  })();

  const shownTags = useMemo(() => (tags ?? []).slice(0, 6), [tags]);
  const hiddenTags = (tags?.length ?? 0) - shownTags.length;
  const longPlot = Boolean(plot && plot.length > PLOT_CLAMP);
  const label = playLabel ?? (isSeries ? 'Play first episode' : 'Play');
  const showOriginal =
    originalTitle && originalTitle.toLowerCase().trim() !== title.toLowerCase().trim();
  const sourceCount = sourceReadiness && sourceReadiness.count > 0 ? sourceReadiness.count : 0;

  return (
    <header className="detail-hero detail-hero--cinema">
      <HeroArtwork posterUrl={posterUrl} backdropUrl={shownBackdrop} blurred={backdropBlurred} />

      <div className="detail-hero__inner">
        <button
          type="button"
          className="detail-art"
          onClick={onPlay}
          disabled={busy}
          aria-label={`${label}: ${title}`}
          title={label}
        >
          <Poster
            src={posterUrl}
            title={title}
            decorative
            sensitive={sensitive}
            itemKey={resolvedItemKey}
            className="detail-art__image"
            fallback={<div className="detail-art__placeholder" aria-hidden />}
          />
          <span className="detail-art__scrim" aria-hidden />
          <span className="detail-art__play" aria-hidden>
            <Play size={24} fill="currentColor" />
          </span>
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
          <div className="detail-hero__title-row">
            <h1>{title}</h1>
            {onSearchTitle && (
              <button
                type="button"
                className="detail-hero__title-search"
                onClick={onSearchTitle}
                aria-label={`Search for ${title}`}
                title={`Search every source for “${title}”`}
              >
                <Search size={18} />
              </button>
            )}
          </div>

          {showOriginal && <p className="detail-hero__original">{originalTitle}</p>}

          <div className="detail-hero__meta">
            {year && <span>{year}</span>}
            {duration && (
              <span title="Running time">
                <Clock size={13} aria-hidden /> {duration}
              </span>
            )}
            {seriesSummary && <span>{seriesSummary}</span>}
            <span className="detail-hero__type">{type}</span>
            {rating !== undefined && (
              <span title="Provider rating">
                <Star size={13} aria-hidden /> {rating.toFixed(1)}
              </span>
            )}
          </div>

          <div className="detail-hero__cta">
            <button type="button" className="detail-play" onClick={onPlay} disabled={busy}>
              {busy ? <Loader2 size={18} className="spin" /> : <Play size={18} fill="currentColor" />}
              <span>{label}</span>
            </button>

            {onWatchTrailer && (
              <button type="button" className="detail-cta" onClick={onWatchTrailer} title="Watch the trailer">
                <Film size={16} />
                <span>Trailer</span>
              </button>
            )}

            <div className="detail-hero__icons">
              <button
                type="button"
                className={`detail-icon${saved ? ' detail-icon--on' : ''}`}
                onClick={onToggleSave}
                aria-pressed={saved}
                aria-label={saved ? 'Saved — remove from saved pages' : 'Save this page'}
                title={saved ? 'Saved — click to remove from your saved pages' : 'Save this page to come back to'}
              >
                {saved ? <BookmarkCheck size={17} /> : <BookmarkIcon size={17} />}
              </button>

              {libraryControl}

              <button
                type="button"
                className="detail-icon"
                onClick={onDownload}
                aria-label={isSeries ? 'Download an episode' : 'Download'}
                title={isSeries ? 'Download this episode' : 'Download'}
              >
                <Download size={17} />
              </button>

              {shareControl}

              <button
                type="button"
                className="detail-icon detail-icon--sources"
                onClick={onChooseSource}
                aria-label={sourceCount ? `View ${sourceCount} sources` : 'View sources'}
                title={sourceCount ? `${sourceCount} sources found — choose one` : 'Choose a source by hand'}
              >
                <ListVideo size={17} />
                {sourceCount > 0 && <span className="detail-icon__badge">{sourceCount > 99 ? '99+' : sourceCount}</span>}
              </button>

              <Menu
                label="More actions"
                align="end"
                className="detail-action__more"
                trigger={(props) => (
                  <button {...props} type="button" className="detail-icon" aria-label="More actions" title="More">
                    <MoreHorizontal size={17} />
                  </button>
                )}
                items={[
                  {
                    label: 'Search again for sources',
                    description: isDeveloper
                      ? 'Every enabled provider again, past the cache'
                      : 'Finds more, and replaces links that stopped working',
                    icon: SearchCheck,
                    onSelect: onFindMoreSources,
                  },
                  ...(isSeries && onDownloadSeason
                    ? [
                        {
                          label: 'Download season',
                          description: 'Every episode in this season',
                          icon: Layers,
                          onSelect: onDownloadSeason,
                        },
                      ]
                    : []),
                ]}
              />
            </div>
          </div>

          {/* Below the play row, latest-arriving last — see the header comment. */}
          {plot && (
            <p className={`detail-hero__plot${longPlot && !plotOpen ? ' detail-hero__plot--clamped' : ''}`}>
              {plot}
            </p>
          )}
          {(longPlot || choices.length > 1) && (
            <div className="detail-hero__plot-foot">
              {longPlot && (
                <button
                  type="button"
                  className="detail-hero__plot-toggle"
                  onClick={() => setPlotOpen((open) => !open)}
                  aria-expanded={plotOpen}
                >
                  {plotOpen ? 'Less' : 'More'}
                </button>
              )}
              {choices.length > 1 && (
                <div className="detail-hero__plot-sources" role="group" aria-label="Description from">
                  <span className="detail-hero__plot-sources-label">Description:</span>
                  {choices.map((choice) => (
                    <button
                      key={choice.id}
                      type="button"
                      className={`detail-hero__plot-source${choice === chosenPlot ? ' detail-hero__plot-source--on' : ''}`}
                      aria-pressed={choice === chosenPlot}
                      onClick={() => {
                        setPlotChoiceId(choice.id);
                        setPlotOpen(false);
                      }}
                    >
                      {choice.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {shownTags.length > 0 && (
            <div className="detail-hero__tags">
              {shownTags.map((tag) => (
                <span key={tag} className="detail-hero__tag">
                  {tag}
                </span>
              ))}
              {hiddenTags > 0 && (
                <span className="detail-hero__tag detail-hero__tag--more" title={(tags ?? []).slice(6).join(', ')}>
                  +{hiddenTags}
                </span>
              )}
            </div>
          )}

          <MediaRatings identity={ratingsIdentity} />

          {fallbackNote && <p className="detail-hero__fallback">{fallbackNote}</p>}
          {!showOriginal &&
            lateOriginalTitle &&
            lateOriginalTitle.toLowerCase().trim() !== title.toLowerCase().trim() && (
              <p className="detail-hero__original detail-hero__original--late">Original title: {lateOriginalTitle}</p>
            )}

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
              {isDeveloper && provenance.imdbId && (
                <span className="detail-origin__meta">{provenance.imdbId}</span>
              )}
            </p>
          )}
        </div>
      </div>
    </header>
  );
};

/**
 * An image URL once its bytes are in, so artwork fades in whole rather than
 * painting down the screen. A later empty value keeps the image already shown:
 * a catalogue record refreshed without a backdrop must not blank the masthead.
 */
function useLoadedImage(url: string | undefined): string | undefined {
  const [loaded, setLoaded] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!url || url === loaded) return;
    let live = true;
    const image = new Image();
    image.onload = () => {
      if (live) setLoaded(url);
    };
    image.src = url;
    return () => {
      live = false;
    };
  }, [url, loaded]);
  return loaded;
}

/**
 * The masthead's background: the poster, softened, until a backdrop has
 * loaded, then the backdrop faded in over it. Both layers are always there, so
 * the masthead's frame never depends on whether a catalogue had a backdrop.
 *
 * A style rather than a CSS custom property holding `url()`: a scraped artwork
 * URL can contain quotes and parentheses, and `encodeURI` keeps it a URL
 * rather than syntax.
 */
const HeroArtwork: React.FC<{ posterUrl?: string; backdropUrl?: string; blurred: boolean }> = ({
  posterUrl,
  backdropUrl,
  blurred,
}) => {
  const privacy = blurred ? ' cs-poster--blurred' : '';
  return (
    <>
      {posterUrl && (
        <span
          className={`detail-hero__backdrop detail-hero__backdrop--poster${privacy}`}
          aria-hidden="true"
          style={{ backgroundImage: `url("${encodeURI(posterUrl)}")` }}
        />
      )}
      <span
        className={`detail-hero__backdrop${backdropUrl ? ' detail-hero__backdrop--shown' : ''}${privacy}`}
        aria-hidden="true"
        style={backdropUrl ? { backgroundImage: `url("${encodeURI(backdropUrl)}")` } : undefined}
      />
      <span className="detail-hero__shade" aria-hidden="true" />
    </>
  );
};

/**
 * The masthead while the provider is still being asked: the same frame, with
 * what the card already said (title, poster, year) and placeholders shaped
 * like the rows that will replace them — so the page that arrives lands in
 * place instead of replacing a spinner.
 */
export const DetailHeroSkeleton: React.FC<{
  title: string;
  posterUrl?: string;
  year?: number;
  type?: string;
  sensitive?: boolean;
  itemKey?: string;
  /** One line saying what is happening, when it is more than loading. */
  status?: string;
}> = ({ title, posterUrl, year, type, sensitive = false, itemKey, status }) => {
  const adult = useAdultMode();
  useRegisterAdultPresence(sensitive);
  const blurred = sensitive && isAdultItemBlurred(adult, itemKey || title);
  return (
    <header className="detail-hero detail-hero--cinema" aria-busy="true">
      <HeroArtwork posterUrl={posterUrl} blurred={blurred} />
      <div className="detail-hero__inner">
        <div className="detail-art" aria-hidden>
          <Poster
            src={posterUrl}
            title={title}
            decorative
            sensitive={sensitive}
            itemKey={itemKey}
            className="detail-art__image"
            fallback={<div className="detail-art__placeholder" />}
          />
        </div>
        <div className="detail-hero__body">
          <div className="detail-hero__title-row">
            <h1>{title}</h1>
          </div>
          <div className="detail-hero__meta">
            {year && <span>{year}</span>}
            {type && <span className="detail-hero__type">{type}</span>}
            <span className="detail-skeleton detail-skeleton--meta" aria-hidden />
          </div>
          <div className="detail-hero__cta" aria-hidden>
            <span className="detail-skeleton detail-skeleton--play" />
            <span className="detail-hero__icons">
              {[0, 1, 2, 3].map((index) => (
                <span key={index} className="detail-skeleton detail-skeleton--icon" />
              ))}
            </span>
          </div>
          <div className="detail-skeleton__lines" aria-hidden>
            <span className="detail-skeleton detail-skeleton--line" />
            <span className="detail-skeleton detail-skeleton--line" />
            <span className="detail-skeleton detail-skeleton--line detail-skeleton--short" />
          </div>
          <p className="detail-hero__status" role="status">
            {status ?? `Loading ${title}…`}
          </p>
        </div>
      </div>
    </header>
  );
};
