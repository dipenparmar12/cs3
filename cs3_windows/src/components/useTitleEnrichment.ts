import { useEffect, useRef, useState } from 'react';
import type { SearchResponse } from '../types/api';

/**
 * Replaces provider release names with the titles they are about.
 *
 * Providers name results after the file, so one film arrives as
 * `Avengers End Game 720p Hindi Dubbed`, `Avengers.Endgame.2019.1080p.BluRay`
 * and `Avengers Endgame (2019) [Dual Audio]`. The grid is then unreadable and
 * unsortable, and no amount of client-side tidying can supply the plot, genre
 * or poster that were never in the name to begin with.
 *
 * ## Why this lives in the renderer
 *
 * Enriching inside the search itself would put a catalogue round trip in front
 * of results the app already has. Search is push-shaped precisely so the first
 * provider's answers appear while the slowest is still scraping; spending that
 * advantage on metadata would be a poor trade. So results render immediately
 * under their original names and are rewritten a moment later.
 *
 * ## Why the cache is keyed on the original name
 *
 * Snapshots are replaced wholesale as each provider answers, so anything
 * written into the results array is overwritten by the next update. Holding the
 * enrichment separately and applying it as a display transform survives that —
 * and means a title resolved during one search is still resolved when the same
 * release turns up in the next one.
 */

/** Resolved titles live for the session; a film's canonical name does not move. */
const cache = new Map<string, SearchResponse>();

/** How many rows are enriched. Beyond this the user is scrolling, not reading. */
const ENRICH_LIMIT = 60;

export function useTitleEnrichment(results: SearchResponse[], enabled = true): SearchResponse[] {
  const [, bump] = useState(0);
  const pending = useRef(new Set<string>());

  useEffect(() => {
    if (!enabled || results.length === 0) return;
    if (!window.cloudstream?.enrichResults) return;

    // Only rows nothing is known about yet, and only ones a provider produced —
    // a catalogue result is already canonical and re-resolving it would spend a
    // request to learn what it already says.
    const unknown = results
      .slice(0, ENRICH_LIMIT)
      .filter(
        (item) =>
          item.apiName !== 'Catalogue' &&
          !cache.has(item.name) &&
          !pending.current.has(item.name)
      );
    if (unknown.length === 0) return;

    let cancelled = false;
    for (const item of unknown) pending.current.add(item.name);

    void (async () => {
      try {
        const response = await window.cloudstream!.enrichResults!(unknown, ENRICH_LIMIT);
        if (cancelled || !response?.ok) return;
        for (let index = 0; index < unknown.length; index++) {
          const enriched = response.results[index];
          if (enriched) cache.set(unknown[index].name, enriched);
        }
        // One re-render for the batch rather than one per row.
        bump((value) => value + 1);
      } catch {
        // Enrichment is an improvement, never a requirement.
      } finally {
        for (const item of unknown) pending.current.delete(item.name);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [results, enabled]);

  if (!enabled) return results;

  return results.map((item) => {
    const enriched = cache.get(item.name);
    if (!enriched) return item;
    return {
      ...item,
      // The address is never touched: the provider's own handle is the only
      // thing that can play this, and the catalogue does not have one.
      name: enriched.name,
      year: enriched.year ?? item.year,
      posterUrl: enriched.posterUrl ?? item.posterUrl,
    };
  });
}
