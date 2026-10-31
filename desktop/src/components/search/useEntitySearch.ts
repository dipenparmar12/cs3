import { useEffect, useState } from 'react';
import type { EntitySuggestion, SearchCategory } from '../../types/api';
import { categoryScope } from '../../utils/searchCategories';

export interface EntitySearchState {
  entities: EntitySuggestion[];
  /** Every source has answered. */
  done: boolean;
  /** Wikidata refused or failed: an empty list is not "nobody". */
  failed: boolean;
}

const IDLE: EntitySearchState = { entities: [], done: true, failed: false };

/**
 * The people and studios a query names, within `categories`, through the
 * suggestion service (`api:suggest`), which usually answers from the cache
 * the search box just filled. `attempt` re-asks after a failure.
 */
export function useEntitySearch(query: string | undefined, categories: readonly SearchCategory[], attempt = 0): EntitySearchState {
  const trimmed = query?.trim() ?? '';
  const scope = categoryScope(categories);
  const [state, setState] = useState<EntitySearchState>(IDLE);

  useEffect(() => {
    if (!trimmed) {
      setState(IDLE);
      return;
    }
    setState({ entities: [], done: false, failed: false });
    let active = true;
    const asked = scope ? (scope.split(',') as SearchCategory[]) : [];
    // The lookup can still be running when the screen opens; its push says when it lands.
    const dispose = window.cloudstream?.onSuggestionUpdate?.((update) => {
      if (!active || update.query !== trimmed || (update.scope ?? '') !== scope) return;
      setState({ entities: update.entities ?? [], done: update.done, failed: Boolean(update.entitiesFailed) });
    });
    void window.cloudstream
      ?.suggestTitles(trimmed, asked)
      .then((response) => {
        if (!active) return;
        // The instant answer only fills a screen no push has reached yet.
        setState((current) => (current.done || current.entities.length ? current : { entities: response?.entities ?? [], done: Boolean(response?.done), failed: false }));
      })
      .catch(() => active && setState({ entities: [], done: true, failed: true }));
    return () => {
      active = false;
      dispose?.();
    };
  }, [trimmed, scope, attempt]);

  return state;
}
