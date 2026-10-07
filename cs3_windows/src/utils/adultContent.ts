/**
 * Telling adult content apart inside providers that are not only adult.
 *
 * Upstream has exactly one signal: a provider may declare the `NSFW` `TvType`.
 * That is a property of the whole provider, and some providers declare it
 * beside ordinary types — measured on this install, 5 of 22 NSFW providers:
 * 9kMovies (`Movie, TvSeries, NSFW`) and Mp4Moviez publish Bollywood, Tamil,
 * Hollywood and Web Series rows next to an "18+ Movies" or "ULLU Web series"
 * row. Treating the whole provider as adult hid all of that from everyone with
 * adult content off.
 *
 * Nothing finer is published: `MainPageData` has a name and a handle, and
 * every item in those 18+ rows is typed plain `Movie` `[measured]`. So rows and
 * titles are classified from their own text. That is a heuristic, kept narrow
 * on purpose — the costs are not symmetric. A general row wrongly hidden is a
 * row someone can turn adult content on to see; an adult row wrongly shown to
 * someone who turned it off is the failure this exists to prevent. Patterns are
 * pinned by `adultContent.test.mts` against the measured row names.
 */

export type AdultKind = 'none' | 'mixed' | 'adult';

/** Types that say nothing about what a provider carries. */
const NON_CONTENT_TYPES = new Set(['NSFW', 'OTHERS', 'CUSTOMMEDIA']);

/**
 * `adult`: declares NSFW and nothing that is general content.
 * `mixed`: declares NSFW beside general types — its other rows are for everyone.
 */
export function providerAdultKind(types: readonly string[] | undefined): AdultKind {
  const upper = (types ?? []).map((type) => String(type).toUpperCase());
  if (!upper.includes('NSFW')) return 'none';
  return upper.some((type) => !NON_CONTENT_TYPES.has(type)) ? 'mixed' : 'adult';
}

/**
 * Strong signals, safe to test against any text including a film's title:
 * an explicit 18+ mark, explicit words, and platforms that publish only adult
 * web series. `＋` is the full-width plus some sites use (`(18＋) Sabado`).
 */
const STRONG = [
  /(^|[^0-9])18\s*[+＋]/,
  /\(\s*18\s*[+＋]?\s*\)/,
  /\b(xxx|porn\w*|nsfw|hentai|erotic\w*|onlyfans|brazzers)\b/i,
  /\b(ullu|kooku|vivamax|primeshots|hotx|moodx|neonx|besharams|nuefliks|hunters\s*app)\b/i,
];

/**
 * Weaker words that only mean adult in a *row name* — "Hot Web Series",
 * "Tagalog Hot Movies". As a title they are ordinary ("Hot Fuzz", "Adult
 * Swim"), so they are never applied to titles. `\bhot\b` cannot match Hotstar.
 */
const ROW_ONLY = [/\bhot\b/i, /\b(adult|sexy|sensual)\b/i, /\b18[-_ ]?(plus|movies?|adult)\b/i];

export function isSensitiveTitle(text: string | undefined): boolean {
  if (!text) return false;
  return STRONG.some((pattern) => pattern.test(text));
}

/** A row's name, or its handle (often a category path like `/category/18-movie-hd/`). */
export function isSensitiveRowLabel(text: string | undefined): boolean {
  if (!text) return false;
  const spaced = text.replace(/[-_/]+/g, ' ');
  return [...STRONG, ...ROW_ONLY].some((pattern) => pattern.test(text) || pattern.test(spaced));
}

/**
 * A catalogue's rows as a mixed provider's should be seen: flagged `sensitive`
 * when adult content is allowed, removed (and counted) when it is not. Any
 * other kind of provider passes through untouched — an adult-only provider is
 * gated whole before it gets here, and a general one has nothing to mark.
 */
export function screenSections<S extends { name: string; data: string }>(
  sections: S[],
  kind: AdultKind,
  adultAllowed: boolean
): { sections: Array<S & { sensitive?: boolean }>; hidden: number } {
  if (kind !== 'mixed') return { sections, hidden: 0 };
  const marked = sections.map((section) => ({ ...section, sensitive: isSensitiveRow(section) }));
  if (adultAllowed) return { sections: marked, hidden: 0 };
  const kept = marked.filter((section) => !section.sensitive);
  return { sections: kept, hidden: marked.length - kept.length };
}

/**
 * The same for one fetched page: whole 18+ lists flagged or removed, and with
 * adult content off, explicit 18+ titles dropped from the lists that remain
 * ("18+ Isla" sitting in 9kMovies' "Latest Movies").
 */
export function screenLists<I extends { name: string }, L extends { name: string; items: I[] }>(
  lists: L[],
  kind: AdultKind,
  adultAllowed: boolean,
  rowIsSensitive = false
): { lists: Array<L & { sensitive?: boolean }>; hidden: number } {
  if (kind !== 'mixed') return { lists, hidden: 0 };
  const marked = lists.map((list) => ({
    ...list,
    sensitive: rowIsSensitive || isSensitiveRow({ name: list.name, items: list.items }),
  }));
  if (adultAllowed) return { lists: marked, hidden: 0 };
  const kept = marked
    .filter((list) => !list.sensitive)
    .map((list) => ({ ...list, items: list.items.filter((item) => !isSensitiveTitle(item.name)) }));
  return { lists: kept, hidden: marked.length - kept.length };
}

/** Share of titles that must be explicitly adult before a row counts as adult. */
const TITLE_SHARE = 0.3;
const TITLE_MIN = 3;

export function isSensitiveRow(row: {
  name?: string;
  data?: string;
  items?: ReadonlyArray<{ name?: string }>;
}): boolean {
  if (isSensitiveRowLabel(row.name) || isSensitiveRowLabel(row.data)) return true;
  const items = row.items ?? [];
  if (items.length === 0) return false;
  const hits = items.filter((item) => isSensitiveTitle(item.name)).length;
  return hits >= TITLE_MIN && hits / items.length >= TITLE_SHARE;
}
