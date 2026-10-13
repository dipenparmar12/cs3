import { useCallback, useState } from 'react';
import { rememberScreenQuery, rememberedScreenQuery } from './screenSearch';

/**
 * The query for one screen, kept across the details-page round trip.
 *
 * `scope` names the screen; App forgets every scope when the viewer moves to
 * another sidebar tab, so a filter never greets them on a later visit.
 */
export function useScreenSearch(scope: string): [string, (query: string) => void] {
  const [query, setQuery] = useState(() => rememberedScreenQuery(scope));
  const update = useCallback(
    (next: string) => {
      rememberScreenQuery(scope, next);
      setQuery(next);
    },
    [scope]
  );
  return [query, update];
}
