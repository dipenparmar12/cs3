import { useEffect, useState } from 'react';
import type { EntitySuggestion } from '../../types/api';
import type { Filmography } from '../../types/filmography';
import { foldName } from '../../utils/suggestionLayout';

/**
 * The credited work of the person or company a search query *is*, or null.
 *
 * Asks the suggestion service (`api:suggest`), which usually answers from the
 * cache the search box just filled, for an entity named exactly the query, then
 * that entity's filmography (cached per session in main). Nothing is asked of
 * a query that names nobody beyond the suggestion lookup itself, and a failure
 * leaves the results as they are.
 */
export function useCreditsForQuery(query: string | undefined): Filmography | null {
  const [entity, setEntity] = useState<EntitySuggestion | null>(null);
  const [credits, setCredits] = useState<Filmography | null>(null);
  const trimmed = query?.trim() ?? '';

  useEffect(() => {
    setEntity(null);
    if (!trimmed) return;
    const wanted = foldName(trimmed);
    let active = true;
    const take = (entities: EntitySuggestion[] | undefined) => {
      const named = entities?.find((candidate) => foldName(candidate.name) === wanted);
      // Kept by id: every push brings a fresh copy of the same entity.
      if (active && named) setEntity((current) => (current?.id === named.id ? current : named));
    };
    // The lookup can still be running when the search starts; its push says when it lands.
    const dispose = window.cloudstream?.onSuggestionUpdate?.((update) => {
      if (update.query === trimmed) take(update.entities);
    });
    void window.cloudstream?.suggestTitles(trimmed).then((response) => take(response?.entities)).catch(() => {});
    return () => {
      active = false;
      dispose?.();
    };
  }, [trimmed]);

  useEffect(() => {
    setCredits(null);
    if (!entity) return;
    let active = true;
    void window.cloudstream
      ?.getFilmography?.({
        kind: entity.kind === 'company' ? 'studio' : 'person',
        name: entity.name,
        profileUrl: entity.profileUrl,
      })
      .then((response) => {
        if (active && response?.ok && response.filmography?.works.length) setCredits(response.filmography);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [entity]);

  return credits;
}
