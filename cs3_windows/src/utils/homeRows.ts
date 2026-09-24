import type { SearchResponse } from '../types/api';

/**
 * Which home rows a person wants, and how "Show all" grows a row.
 *
 * Pure, and kept apart from the component so the two rules that fail silently
 * can be tested: a stored preference that stops being read (the row comes
 * back every launch and the switch looks broken), and a page that repeats what
 * is already on screen (the grid fills with the same forty posters and looks
 * endless while showing nothing new).
 */

/**
 * How many posters a rail draws before "Show all".
 *
 * A rail used to draw everything its catalogue returned — up to a hundred per
 * row, 834 posters across one real home screen — when a viewer scanning rows
 * sees the first eight. The rest is one click away and paged properly there.
 */
export const RAIL_LIMIT = 20;

const HIDDEN_KEY = 'home_hidden_rows';
/** The single toggle this replaced, read once so nobody's choice is lost. */
const LEGACY_ANIME_KEY = 'home_include_anime';
const ANIME_ROW = 'trending-anime';

type ReadableStorage = Pick<Storage, 'getItem'>;
type WritableStorage = Pick<Storage, 'setItem'>;

/**
 * The rows switched off, from `localStorage`.
 *
 * Held there rather than in the datastore for the reason the settings level is:
 * it describes how one person likes their front page, not how the app behaves,
 * and has no business travelling in a backup to somebody else's machine.
 */
export function readHiddenRows(storage: ReadableStorage | null | undefined): string[] {
  try {
    const raw = storage?.getItem(HIDDEN_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter((id): id is string => typeof id === 'string');
    }
    // Before the picker there was one switch, for anime. Honour it.
    return storage?.getItem(LEGACY_ANIME_KEY) === 'false' ? [ANIME_ROW] : [];
  } catch {
    // Storage refused, or the value is not ours to read: show everything.
    return [];
  }
}

export function writeHiddenRows(storage: WritableStorage | null | undefined, hidden: readonly string[]): void {
  try {
    storage?.setItem(HIDDEN_KEY, JSON.stringify([...new Set(hidden)]));
  } catch {
    // A refused write still applies for this session; nothing to report.
  }
}

export function setRowVisible(hidden: readonly string[], id: string, visible: boolean): string[] {
  const next = new Set(hidden);
  if (visible) next.delete(id);
  else next.add(id);
  return [...next];
}

/**
 * Appends one page to what a row already shows.
 *
 * Catalogues shift between requests — a title climbs from page two to page
 * one while someone scrolls — so a page overlapping the last is ordinary and
 * is de-duplicated by address. `added` is what says whether the row grew: a
 * page of nothing but repeats is treated as the end, or the grid would keep
 * asking for ever and show nothing new.
 */
export function mergePage(
  shown: readonly SearchResponse[],
  page: readonly SearchResponse[]
): { items: SearchResponse[]; added: number } {
  const seen = new Set(shown.map((item) => item.url));
  const items = [...shown];
  for (const item of page) {
    if (!item?.url || seen.has(item.url)) continue;
    seen.add(item.url);
    items.push(item);
  }
  return { items, added: items.length - shown.length };
}
