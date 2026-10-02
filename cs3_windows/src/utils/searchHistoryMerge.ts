import type { SearchHistoryEntry } from '../types/api';
import type { SavedSearchSummary } from '../../electron/savedSearches';

/**
 * Merges search history and saved searches into a unified, chronologically ordered list.
 *
 * Instead of keeping saved searches pinned in a separate group at the top of the search bar,
 * saved searches are integrated directly into recent search history.
 *
 * Each item in the unified list that corresponds to a saved search is marked with
 * `isSaved: true`, its `savedId`, and `savedResultCount`, allowing the UI to highlight it
 * and distinguish it from un-saved queries while preserving natural chronological order.
 */
export function mergeHistoryAndSaved(
  history: SearchHistoryEntry[],
  saved: SavedSearchSummary[]
): SearchHistoryEntry[] {
  const savedMap = new Map<string, SavedSearchSummary>();
  for (const s of saved) {
    const key = s.query.trim().toLowerCase();
    const existing = savedMap.get(key);
    if (!existing || s.savedAt > existing.savedAt) {
      savedMap.set(key, s);
    }
  }

  const seenKeys = new Set<string>();
  const merged: SearchHistoryEntry[] = [];

  // 1. Process all history entries and attach saved metadata if present
  for (const entry of history) {
    const key = entry.query.trim().toLowerCase();
    if (!key || seenKeys.has(key)) continue;
    seenKeys.add(key);

    const savedMatch = savedMap.get(key);
    if (savedMatch) {
      merged.push({
        ...entry,
        isSaved: true,
        savedId: savedMatch.id,
        savedAt: savedMatch.savedAt,
        savedResultCount: savedMatch.resultCount,
        at: Math.max(entry.at, savedMatch.savedAt),
      });
    } else {
      merged.push(entry);
    }
  }

  // 2. Include any saved searches that weren't in history
  for (const s of saved) {
    const key = s.query.trim().toLowerCase();
    if (!key || seenKeys.has(key)) continue;
    seenKeys.add(key);

    merged.push({
      query: s.query,
      at: s.savedAt,
      resultCount: s.resultCount,
      isSaved: true,
      savedId: s.id,
      savedAt: s.savedAt,
      savedResultCount: s.resultCount,
    });
  }

  // 3. Sort chronologically by `at` descending so recent activity is at the top
  return merged.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
}
