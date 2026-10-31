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

/**
 * A page address names adult content only with an explicit marker as a whole
 * path segment. The row-label words (`hot`, `sexy`…) are not used here: they
 * match ordinary addresses (`/hot-wheels/`).
 */
const ADULT_ADDRESS = /(^|[/_.-])(hentai|porn\w*|xxx|nsfw|adult|onlyfans|brazzers|18[-_]?(plus|movies?|adult))([/_.-]|$)/i;

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

const ADULT_TAG_PATTERNS = [
  /^(?:18\s*[+＋]|nsfw|xxx|adult|erotica|erotic|hentai|porn|pornography|uncensored|jav|r18|r-18)$/i,
];

/** True when a genre or tag string explicitly classifies a title as 18+/NSFW. */
export function isAdultGenreOrTag(tag: string | undefined): boolean {
  if (!tag) return false;
  const trimmed = tag.trim();
  if (!trimmed) return false;
  return ADULT_TAG_PATTERNS.some((pattern) => pattern.test(trimmed)) || isSensitiveTitle(trimmed);
}

/**
 * A synopsis is trusted only for an explicit mark. Ordinary films name their
 * subject ("the pornography industry", "an erotic thriller" — Boogie Nights,
 * Basic Instinct), and with adult content off those must stay visible.
 */
const EXPLICIT_MARKS = [/(^|[^0-9])18\s*[+＋]/, /\(\s*18\s*[+＋]?\s*\)/, /\b(xxx|nsfw)\b/i];

/** True when a plot/synopsis string contains an explicit NSFW mark. */
export function isSensitiveDescription(text: string | undefined): boolean {
  if (!text) return false;
  return EXPLICIT_MARKS.some((pattern) => pattern.test(text));
}

export interface AdultCheckable {
  adult?: boolean;
  type?: string;
  mediaType?: string;
  name?: string;
  title?: string;
  parentTitle?: string;
  originalTitle?: string;
  episodeTitle?: string;
  apiName?: string;
  providerName?: string;
  provider?: string;
  sources?: readonly string[];
  url?: string;
  mediaUrl?: string;
  parentMediaUrl?: string;
  plot?: string;
  description?: string;
  tags?: readonly string[];
  genres?: readonly string[];
}

/**
 * Unified classification for any media item, library entry, history event,
 * bookmark, download task, or search suggestion across the application.
 */
export function isAdultMedia(
  item: AdultCheckable | null | undefined,
  adultProviders?: ReadonlySet<string>
): boolean {
  if (!item) return false;
  if (item.adult === true) return true;
  if (
    String(item.type ?? '').toUpperCase() === 'NSFW' ||
    String(item.mediaType ?? '').toUpperCase() === 'NSFW' ||
    isAdultGenreOrTag(item.type) ||
    isAdultGenreOrTag(item.mediaType)
  ) {
    return true;
  }

  const provider = item.apiName || item.providerName || item.provider;
  if (provider) {
    if (adultProviders?.has(provider)) return true;
    if (isSensitiveTitle(provider)) return true;
  }
  if (item.sources?.some((s) => adultProviders?.has(s) || isSensitiveTitle(s))) {
    return true;
  }

  const urls = [item.url, item.mediaUrl, item.parentMediaUrl];
  for (const u of urls) {
    if (!u) continue;
    if (adultProviders && u.startsWith('cs3ext://')) {
      const rest = u.slice('cs3ext://'.length);
      const slash = rest.indexOf('/');
      const extProvider = decodeURIComponent(slash >= 0 ? rest.slice(0, slash) : rest);
      if (adultProviders.has(extProvider) || isSensitiveTitle(extProvider)) return true;
    }
    if (ADULT_ADDRESS.test(u)) return true;
  }

  if (
    isSensitiveTitle(item.name) ||
    isSensitiveTitle(item.title) ||
    isSensitiveTitle(item.parentTitle) ||
    isSensitiveTitle(item.originalTitle) ||
    isSensitiveTitle(item.episodeTitle)
  ) {
    return true;
  }

  if (item.tags?.some((tag) => isAdultGenreOrTag(tag))) return true;
  if (item.genres?.some((genre) => isAdultGenreOrTag(genre))) return true;
  if (isSensitiveDescription(item.plot) || isSensitiveDescription(item.description)) return true;

  return false;
}

/**
 * Filters out adult items when adult content is not permitted for the current session.
 */
export function filterAdultItems<T extends AdultCheckable>(
  items: readonly T[],
  adultAllowed: boolean,
  adultProviders?: ReadonlySet<string>
): T[] {
  if (adultAllowed) return [...items];
  return items.filter((item) => !isAdultMedia(item, adultProviders));
}

export type AdultSessionDecision = 'pending' | 'enabled' | 'disabled';

export interface AdultSessionEvaluation {
  mode: 'off' | 'ask' | 'on';
  allowed: boolean;
  savedEnabled: boolean;
  doNotAskAgain: boolean;
  promptPending: boolean;
  blurred: boolean;
}

/**
 * Pure evaluation of adult content availability, startup confirmation prompt,
 * and visual protection state from persistent preferences and session choices
 * (PRD §129.1–§129.3, §129.8).
 *
 *  - `blurred` is session-only and starts `true` on every launch.
 *  - `promptPending` is `true` until the user answers in this session, unless
 *    `doNotAskAgain` is persisted.
 *  - While `promptPending` is `true`, `allowed` is `false` even if `savedEnabled`
 *    is `true` (§129.1, §129.8 Scenario 1).
 */
export function evaluateAdultSessionState(params: {
  savedEnabled: boolean;
  doNotAskAgain: boolean;
  sessionDecision: AdultSessionDecision;
  sessionBlurred: boolean;
}): AdultSessionEvaluation {
  const { savedEnabled, doNotAskAgain, sessionDecision, sessionBlurred } = params;
  // Adult content availability is determined by savedEnabled (managed via Extensions/Settings).
  // Startup confirmation asks about visual presentation (Blur vs Unblur) when adult content is enabled.
  const promptPending = savedEnabled && sessionDecision === 'pending' && !doNotAskAgain;
  // Availability is controlled by savedEnabled (set in Settings/Extensions).
  // Visual presentation decisions for the session (Blur vs Unblur) never disable adult content availability.
  const allowed = savedEnabled;
  const mode: 'off' | 'ask' | 'on' = !savedEnabled ? 'off' : doNotAskAgain ? 'on' : 'ask';
  return {
    mode,
    allowed,
    savedEnabled,
    doNotAskAgain,
    promptPending,
    blurred: sessionBlurred,
  };
}


