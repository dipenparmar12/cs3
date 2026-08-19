import type { SearchResponse } from '../types/api';

/**
 * Sorts a result set into what the viewer asked for, what is nearby, and noise.
 *
 * Extension providers do not all honour a query. Some scrape a search page;
 * others answer any request with a slice of their own catalogue, so a search for
 * "Rick and Morty" comes back carrying whatever that site happened to have on
 * its front page. Shown inline with the real matches, those rows are not merely
 * useless — they push the thing the user typed below the fold and make the whole
 * result set look wrong.
 *
 * Three groups, which is the distinction that actually exists:
 *
 *  1. **Chosen** — the viewer picked this work from the suggestion list, so its
 *     identity is known rather than guessed. There is nothing to rank here.
 *  2. **Matches** — the title contains what was typed. Expanded, because this is
 *     the answer to the question.
 *  3. **Also returned** — everything else. Collapsed, and kept rather than
 *     discarded: a provider that names a film differently ("Rick & Morty",
 *     a transliteration, a local release title) lands here, and throwing it away
 *     would lose real results to protect against noise.
 */

export type ResultGroupId = 'chosen' | 'matches' | 'other';

export interface ResultGroup {
  id: ResultGroupId;
  label: string;
  items: SearchResponse[];
  /** Whether the group starts open. Only `other` does not. */
  defaultOpen: boolean;
}

/** Lowercase, unpunctuated, single-spaced — the form both sides are compared in. */
function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[‘’“”]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Words worth requiring a match on.
 *
 * One- and two-letter tokens are dropped: "of", "a" and "the" appear in most
 * titles ever made, so requiring them classifies nothing, and requiring *all*
 * words including them would reject "Rick and Morty" for a row called
 * "Rick & Morty".
 */
function significantWords(query: string): string[] {
  return normalise(query)
    .split(' ')
    .filter((word) => word.length > 2);
}

/**
 * Does this row plausibly answer the query?
 *
 * Deliberately generous. The cost of a near-miss landing in "also returned" is
 * that someone has to open one collapsed group; the cost of a real match landing
 * there is that they conclude the app cannot find their film. So a row qualifies
 * on any of: the whole query appearing in the title, every significant word
 * appearing somewhere in it, or — for a multi-word query — most of them.
 */
export function isRelevant(item: SearchResponse, query: string): boolean {
  const haystack = normalise(item.name ?? '');
  if (!haystack) return false;

  const needle = normalise(query);
  if (!needle) return true;
  if (haystack.includes(needle)) return true;

  const words = significantWords(query);
  if (words.length === 0) {
    // Nothing substantial to match on — a query of only short words. Fall back
    // to the raw form rather than declaring everything irrelevant.
    return haystack.includes(needle);
  }

  const hits = words.filter((word) => haystack.includes(word)).length;
  if (hits === words.length) return true;
  // "Rick and Morty: The Anime" against "rick and morty" is 3/3; a two-word
  // query needs both, and only longer queries get to lose one word.
  return words.length >= 3 && hits >= words.length - 1;
}

export function groupResults(items: SearchResponse[], query: string): ResultGroup[] {
  const chosen: SearchResponse[] = [];
  const matches: SearchResponse[] = [];
  const other: SearchResponse[] = [];

  for (const item of items) {
    // `isExactMatch` is set by the main process when the row is the work the
    // viewer selected from suggestions. That is a statement about identity, not
    // about the text, so it outranks any title comparison.
    if (item?.isExactMatch) chosen.push(item);
    else if (isRelevant(item, query)) matches.push(item);
    else other.push(item);
  }

  return [
    { id: 'chosen', label: 'Your selection', items: chosen, defaultOpen: true },
    { id: 'matches', label: 'Matching results', items: matches, defaultOpen: true },
    { id: 'other', label: 'Also returned by these sources', items: other, defaultOpen: false },
  ].filter((group) => group.items.length > 0) as ResultGroup[];
}
