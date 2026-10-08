import { useState } from 'react';
import { Clapperboard } from 'lucide-react';
import type { Franchise, FranchiseEntry } from '../../types/metadata';
import type { SearchResponse, TvType } from '../../types/api';
import type { TitleInteraction } from '../../types/interactions';
import { PosterCard } from '../PosterCard';
import { DetailSection } from './DetailSection';
import { CollectionDialog } from './CollectionDialog';

/**
 * The film series this title belongs to, in release order (franchise PRD).
 *
 * Drawn with the same poster cards as search and home, so the films of a
 * series look like what they are — titles you can open or play — rather than a
 * numbered text list beside the rest of the app's posters. Posters come from
 * the image service Cinemeta itself uses, addressed by IMDb id, so the rail
 * costs no lookups of its own. The card for the page in view is marked and
 * does not navigate.
 *
 * Each entry opens as an ordinary Cinemeta catalogue item, so its sources are
 * found by the viewer's providers the way any catalogue title's are — the rail
 * never carries a playable address of its own.
 */
export function franchiseItem(entry: FranchiseEntry, currentTitle: string): SearchResponse {
  return {
    name: entry.title || (entry.current ? currentTitle : entry.imdbId),
    url: `cs3meta://cinemeta/movie/${entry.imdbId}`,
    apiName: 'Cinemeta',
    type: 'Movie' as TvType,
    year: entry.year,
    imdbId: entry.imdbId,
    posterUrl: `https://images.metahub.space/poster/medium/${entry.imdbId}/img`,
  };
}

export function FranchiseRail({
  franchise,
  currentTitle,
  onSelectMedia,
  onPlayDirectly,
  interactionFor,
}: {
  franchise: Franchise;
  /** The page's own name, for a current entry the catalogue left unlabelled. */
  currentTitle: string;
  onSelectMedia: (item: SearchResponse) => void;
  onPlayDirectly?: (item: SearchResponse) => void;
  interactionFor?: (item: SearchResponse) => TitleInteraction | undefined;
}) {
  const [viewAll, setViewAll] = useState(false);
  const currentIndex = franchise.entries.findIndex((entry) => entry.current);

  const card = (entry: FranchiseEntry, index: number, close?: () => void) => {
    const item = franchiseItem(entry, currentTitle);
    const relation =
      currentIndex < 0 || entry.current ? null : index < currentIndex ? 'Earlier' : 'Later';
    return (
      <div
        key={entry.imdbId}
        className={`franchise-card${entry.current ? ' franchise-card--current' : ''}`}
        aria-current={entry.current ? 'page' : undefined}
      >
        <span className="franchise-card__index" aria-hidden>
          {entry.ordinal ?? index + 1}
        </span>
        <PosterCard
          item={item}
          onSelectMedia={
            entry.current
              ? () => close?.()
              : (chosen) => {
                  close?.();
                  onSelectMedia(chosen);
                }
          }
          onPlayDirectly={
            onPlayDirectly
              ? (chosen) => {
                  close?.();
                  onPlayDirectly(chosen);
                }
              : undefined
          }
          showBucketButton={false}
          interaction={interactionFor?.(item)}
        />
        <p className="franchise-card__relation">{entry.current ? 'Viewing now' : relation}</p>
      </div>
    );
  };

  return (
    <DetailSection
      id="franchise"
      title={franchise.name}
      icon={<Clapperboard size={16} />}
      count={franchise.entries.length}
      onViewAll={franchise.entries.length > 5 ? () => setViewAll(true) : undefined}
    >
      <div className="franchise-rail detail-facts__rail">
        {franchise.entries.map((entry, index) => card(entry, index))}
      </div>
      {viewAll && (
        <CollectionDialog
          title={franchise.name}
          count={franchise.entries.length}
          icon={<Clapperboard size={18} />}
          onClose={() => setViewAll(false)}
        >
          {franchise.entries.map((entry, index) => card(entry, index, () => setViewAll(false)))}
        </CollectionDialog>
      )}
    </DetailSection>
  );
}
