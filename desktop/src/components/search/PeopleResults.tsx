import React, { useMemo, useState } from 'react';
import { AlertTriangle, Building2, Loader2, SearchX, User } from 'lucide-react';
import type { EntitySuggestion, SearchCategory, SearchResponse } from '../../types/api';
import { Poster } from '../Poster';
import { PosterCard } from '../PosterCard';
import { EmptyState } from '../EmptyState';
import { useEntitySearch } from './useEntitySearch';
import { useFilmography } from './useCreditsForQuery';
import { categoryHeading, filmographyRoles, SEARCH_CATEGORIES } from '../../utils/searchCategories';
import { reasonFor, workAsItem } from '../../utils/matchReasons';
import { foldName } from '../../utils/suggestionLayout';

/**
 * A search for people or studios only (the chips without Titles): who is
 * named that and holds the selected credit, and their work in that credit.
 *
 * Never a title search in disguise. When nobody matches, it says so and
 * offers the title search as a button, rather than running it.
 */
export const PeopleResults: React.FC<{
  query: string;
  categories: SearchCategory[];
  onSelectMedia: (item: SearchResponse) => void;
  onPlayDirectly?: (item: SearchResponse) => void;
  /** A title search for the same text, when the viewer asks for one. */
  onSearchTitles: (query: string) => void;
}> = ({ query, categories, onSelectMedia, onPlayDirectly, onSearchTitles }) => {
  const [attempt, setAttempt] = useState(0);
  const { entities, done, failed } = useEntitySearch(query, categories, attempt);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const wanted = foldName(query);
  // The exact name first, else the best match; the viewer can pick another.
  const selected =
    entities.find((entity) => entity.id === pickedId) ??
    entities.find((entity) => foldName(entity.name) === wanted) ??
    entities[0] ??
    null;
  const { credits, failed: creditsFailed } = useFilmography(selected);
  const plural = SEARCH_CATEGORIES.filter((c) => categories.includes(c.id) && c.id !== 'title')
    .map((c) => c.plural)
    .join(' or ');

  const cards = useMemo(() => {
    if (!credits) return [];
    const allowed = filmographyRoles(categories);
    return credits.works
      .map((work) => ({ ...work, roles: allowed ? work.roles.filter((role) => allowed.includes(role)) : work.roles }))
      .filter((work) => work.roles.length > 0)
      .map((work) => {
        const reason = reasonFor(credits.name, work);
        return { item: workAsItem(work), reason: reason ? { ...reason, label: reason.role } : undefined };
      });
  }, [credits, categories]);

  // A work with no IMDb id has no page to open; searching its title is the next best thing.
  const open = (item: SearchResponse) => (item.url.startsWith('search://') ? onSearchTitles(item.name) : onSelectMedia(item));

  const heading = (
    <header className="people-results__head">
      <h2>{categoryHeading(categories, query)}</h2>
      <span className="search-group__note">Found by the credits Wikidata lists</span>
    </header>
  );

  if (!done && entities.length === 0) {
    return (
      <div className="people-results">
        {heading}
        <p className="people-results__loading" role="status">
          <Loader2 size={14} className="spin" /> Looking up {plural}…
        </p>
      </div>
    );
  }
  if (entities.length === 0) {
    return (
      <div className="people-results">
        {heading}
        {failed ? (
          <EmptyState
            icon={AlertTriangle}
            title="Wikidata didn’t answer just now"
            description="It asks apps to slow down after a burst of searches. Try again in half a minute."
            action={{ label: 'Try again', onClick: () => setAttempt((n) => n + 1) }}
          />
        ) : (
          <EmptyState
            icon={SearchX}
            title={`No ${plural} named “${query.trim()}”`}
            description="Check the spelling, or look for titles with this name instead."
            action={{ label: 'Search titles instead', onClick: () => onSearchTitles(query) }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="people-results">
      {heading}
      <div className="people-results__people" role="tablist" aria-label="Matching people and studios">
        {entities.map((entity: EntitySuggestion) => {
          const on = entity.id === selected?.id;
          const Icon = entity.kind === 'company' ? Building2 : User;
          return (
            <button
              key={entity.id}
              type="button"
              role="tab"
              aria-selected={on}
              className={`people-results__person${on ? ' people-results__person--on' : ''}`}
              onClick={() => setPickedId(entity.id)}
            >
              <Poster
                src={entity.imageUrl}
                title={entity.name}
                decorative
                itemKey={entity.id}
                fallback={
                  <div className="search-suggest__poster-empty">
                    <Icon size={16} />
                  </div>
                }
              />
              <span className="people-results__name">{entity.name}</span>
              {entity.description && <span className="people-results__about">{entity.description}</span>}
            </button>
          );
        })}
      </div>

      {creditsFailed ? (
        <EmptyState icon={AlertTriangle} title="Their credits could not be read just now" compact />
      ) : !credits ? (
        <p className="people-results__loading" role="status">
          <Loader2 size={14} className="spin" /> Reading {selected?.name}’s credits…
        </p>
      ) : cards.length === 0 ? (
        <EmptyState icon={SearchX} title={`No ${plural} credits with an IMDb page`} compact />
      ) : (
        <>
          <span className="search-group__note">
            {cards.length} film{cards.length === 1 ? '' : 's'} and series
          </span>
          <div className="people-results__grid">
            {cards.map(({ item, reason }, index) => (
              <PosterCard
                key={`${item.url}-${index}`}
                item={item}
                onSelectMedia={open}
                onPlayDirectly={item.url.startsWith('search://') ? undefined : onPlayDirectly}
                matchReason={reason}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
};
