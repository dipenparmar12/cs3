import { useEffect, useMemo, useState } from 'react';
import type { EntitySuggestion } from '../../types/api';
import type { Filmography } from '../../types/filmography';
import { foldName } from '../../utils/suggestionLayout';
import { useEntitySearch } from './useEntitySearch';

const ALL: [] = [];

/** One entity's filmography (cached per session in main), or null while unknown. */
export function useFilmography(entity: EntitySuggestion | null): { credits: Filmography | null; failed: boolean } {
  const [state, setState] = useState<{ credits: Filmography | null; failed: boolean }>({ credits: null, failed: false });
  useEffect(() => {
    setState({ credits: null, failed: false });
    if (!entity) return;
    let active = true;
    void window.cloudstream
      ?.getFilmography?.({
        kind: entity.kind === 'company' ? 'studio' : 'person',
        name: entity.name,
        profileUrl: entity.profileUrl,
      })
      .then((response) => {
        if (!active) return;
        if (response?.ok) setState({ credits: response.filmography?.works.length ? response.filmography : null, failed: false });
        else setState({ credits: null, failed: true });
      })
      .catch(() => active && setState({ credits: null, failed: true }));
    return () => {
      active = false;
    };
    // Keyed on the id: each push brings a fresh copy of the same entity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity?.id]);
  return state;
}

/**
 * The credited work of the person or company a search query *is*, or null.
 *
 * Only an entity named exactly the query: "John Cena" is John Cena's work,
 * "John" is nobody's. Nothing is asked of a query that names nobody beyond
 * the lookup itself, and a failure leaves the results as they are.
 */
export function useCreditsForQuery(query: string | undefined): { entity: EntitySuggestion; credits: Filmography } | null {
  const { entities } = useEntitySearch(query, ALL);
  const wanted = foldName(query ?? '');
  const entity = useMemo(
    () => (wanted ? entities.find((candidate) => foldName(candidate.name) === wanted) ?? null : null),
    [entities, wanted]
  );
  const { credits } = useFilmography(entity);
  return entity && credits ? { entity, credits } : null;
}
