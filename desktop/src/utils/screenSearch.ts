/**
 * "Find on this screen" — the filter behind the small search on Library and
 * History, as opposed to the navbar's media search.
 *
 * The two must never be confused, so this one is deliberately narrow: it
 * matches text the screen already holds, asks nothing of any provider and
 * fetches nothing. Every word of the query has to appear somewhere in the
 * row's fields, in any order, ignoring case and accents — `dune 2021` finds
 * *Dune (2021)* and `s1e2` finds the second episode however it was written.
 *
 * Pure, and imported by the main process too (`historyStore` filters with it),
 * so the History screen and its store cannot disagree about what matches.
 * Also holds the two pieces of module state the control needs — the query per
 * screen and whether a screen search is mounted — because both are read from
 * places (App's Ctrl+F handler, a remount after a details page) that have no
 * component in common with the control.
 */

/** Lower-case, accent-free, so `Amélie` and `amelie` are the same word. */
export function foldText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

type Field = string | number | null | undefined | false | readonly (string | number | null | undefined)[];

/**
 * The spellings an episode is searched by.
 *
 * Release names, providers and people write the same episode four ways, and a
 * viewer types whichever they think of: `S01E02`, `s1e2`, `1x02`, "episode 2".
 */
export function episodeTerms(season?: number | null, episode?: number | null): string[] {
  const pad = (n: number) => String(n).padStart(2, '0');
  const terms: string[] = [];
  const hasSeason = typeof season === 'number' && season >= 0;
  const hasEpisode = typeof episode === 'number' && episode >= 0;
  if (hasSeason) terms.push(`s${pad(season)}`, `s${season}`, `season ${season}`);
  if (hasEpisode) terms.push(`e${pad(episode)}`, `episode ${episode}`);
  if (hasSeason && hasEpisode) {
    terms.push(`s${pad(season)}e${pad(episode)}`, `s${season}e${episode}`, `${season}x${pad(episode)}`);
  }
  return terms;
}

/** The query as the words that must each be found. */
export function queryWords(query: string): string[] {
  return foldText(query).split(/\s+/).filter(Boolean);
}

/**
 * Whether every word of `query` appears in any of `fields`.
 *
 * Punctuation is matched both ways: `spider-man` finds `Spider-Man`, and so
 * does `spiderman`, because the haystack also carries a copy with the
 * punctuation removed. An empty query matches everything — nothing typed is
 * the ordinary screen.
 */
export function matchesScreenQuery(query: string, fields: readonly Field[]): boolean {
  const words = queryWords(query);
  if (words.length === 0) return true;
  const parts: string[] = [];
  for (const field of fields) {
    if (field === null || field === undefined || field === false) continue;
    if (Array.isArray(field)) {
      for (const value of field) if (value !== null && value !== undefined) parts.push(String(value));
    } else {
      parts.push(String(field));
    }
  }
  // Joined on a newline, which the compact copy keeps: removing punctuation
  // must not run the end of one field into the start of the next.
  const text = foldText(parts.join('\n'));
  const haystack = `${text}\n${text.replace(/[^\p{L}\p{N}\s]/gu, '')}`;
  return words.every((word) => haystack.includes(word));
}

/** The event App dispatches on Ctrl+F when a screen search is mounted. */
export const SCREEN_SEARCH_FOCUS_EVENT = 'cs3:focus-screen-search';

/*
 * The query per screen, outliving the component.
 *
 * Opening a title unmounts the screen it was opened from — the details page
 * replaces it in the same container — so a filter held in component state was
 * gone by the time the viewer pressed Back, the same reason `searchUiState`
 * is held by App. A sidebar tab change keeps it too: every screen comes back
 * as it was left (`tabNavigation.ts`), so a find that vanished on the round
 * trip would be the one exception. `forgetScreenQueries` resets the memory
 * between test cases.
 */
const remembered = new Map<string, string>();

export function rememberedScreenQuery(scope: string): string {
  return remembered.get(scope) ?? '';
}

export function rememberScreenQuery(scope: string, query: string): void {
  if (query) remembered.set(scope, query);
  else remembered.delete(scope);
}

export function forgetScreenQueries(): void {
  remembered.clear();
}

/*
 * Whether a screen search is on screen now, counted rather than flagged so a
 * remount (mount of the new one before unmount of the old) cannot clear it.
 * App asks this on Ctrl+F: with one, the shortcut finds on this screen; with
 * none, it goes to the media search as it always did.
 */
let mounted = 0;

export function claimScreenSearch(): () => void {
  mounted += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    mounted -= 1;
  };
}

export function screenSearchAvailable(): boolean {
  return mounted > 0;
}
