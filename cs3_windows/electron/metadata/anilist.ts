/**
 * AniList — characters, their voice actors, and staff, for anime.
 *
 * The richest of the four sources for the thing the brief asked about most
 * directly. Anime is the one category where "the cast" genuinely has two
 * layers — the character and the performer behind them — and AniList is the
 * only keyless database that models both, in both scripts, with artwork for
 * each. `雨宮天` beside `Sora Amamiya`, and `アクア` beside `Aqua`, are one
 * query rather than a transliteration guess.
 *
 * Keyless, public GraphQL. Already used by `metadataProvider.ts` and
 * `cs3/discovery.ts`, for the same reason given there: it is the only catalogue
 * that treats anime as a first-class thing rather than as IMDb's "Animation"
 * genre, which is mostly Western film.
 *
 * ## Two decisions worth knowing
 *
 * **Voice actors are not filtered to one language.** Asking only for Japanese
 * loses the English dub cast, which is precisely what a viewer watching a dub
 * wants to see; asking only for English loses the original performance. So every
 * language comes back and `voiceLanguage` carries which is which, leaving the
 * choice to the UI rather than to this module.
 *
 * **A character with no recorded voice actor is still listed.** AniList holds
 * plenty of these, and an anime cast list that silently drops half its
 * characters reads as a scraping failure rather than as a gap in the database.
 * Such a row names the character and shows its artwork; it does not claim
 * anybody performed it.
 */

import { rawFetch } from '../torrent/http.ts';
import { youTubeVideo } from './videoTitles.ts';
import {
  CreditRole,
  MetadataSource,
  TitleStatus,
  type CreditPerson,
  type Organisation,
  type ProductionNote,
  type TitleRating,
  TitleVideoKind,
  type TitleVideo,
} from '../../src/types/metadata.ts';
import { classifyJob } from './merge.ts';
import { normaliseStatus } from './cinemetaExtras.ts';
import { normaliseTitleForMatch, titleSimilarity } from '../torrent/releaseParser.ts';

const ENDPOINT = 'https://graphql.anilist.co';
const TIMEOUT_MS = 12_000;

/**
 * Above this, two titles name the same anime.
 *
 * `cs3/titleEnricher.ts` measured 0.86 against the release-name corpus and this
 * is the same comparison on cleaner input, so the same floor applies — with no
 * year-relaxed second threshold, because a title that needs a year to be
 * believable is not one worth replacing a page's credits over.
 */
const ANILIST_MATCH_FLOOR = 0.86;

/** Characters requested. AniList pages at 25 and one page is a full cast. */
const CHARACTER_PAGE = 25;
const STAFF_PAGE = 15;

const QUERY = `
query ($id: Int) {
  Media(id: $id, type: ANIME) {
    id
    title { romaji english native }
    synonyms
    countryOfOrigin
    source
    status
    episodes
    format
    genres
    description(asHtml: false)
    bannerImage
    coverImage { extraLarge large }
    averageScore
    meanScore
    popularity
    startDate { year month day }
    endDate { year month day }
    duration
    trailer { id site thumbnail }
    studios { edges { isMain node { name siteUrl } } }
    tags { name rank isGeneralSpoiler isMediaSpoiler }
    characters(sort: [ROLE, RELEVANCE], perPage: ${CHARACTER_PAGE}) {
      edges {
        role
        node { id name { full native } image { large medium } siteUrl }
        voiceActors { id name { full native } image { large medium } languageV2 siteUrl }
      }
    }
    staff(sort: [RELEVANCE], perPage: ${STAFF_PAGE}) {
      edges { role node { id name { full native } image { large medium } siteUrl } }
    }
  }
}`;

interface AniName {
  full?: string;
  native?: string;
}
interface AniImage {
  large?: string;
  medium?: string;
}
interface AniPerson {
  id?: number;
  name?: AniName;
  image?: AniImage;
  languageV2?: string;
  siteUrl?: string;
}
interface AniCharacterEdge {
  role?: string;
  node?: AniPerson;
  voiceActors?: AniPerson[];
}
interface AniStaffEdge {
  role?: string;
  node?: AniPerson;
}
interface AniDate {
  year?: number;
  month?: number;
  day?: number;
}

export interface AniListMediaCredits {
  id?: number;
  title?: { romaji?: string; english?: string; native?: string };
  synonyms?: string[];
  countryOfOrigin?: string;
  source?: string;
  status?: string;
  episodes?: number;
  format?: string;
  genres?: string[];
  description?: string;
  bannerImage?: string;
  coverImage?: { extraLarge?: string; large?: string };
  averageScore?: number;
  meanScore?: number;
  popularity?: number;
  startDate?: AniDate;
  endDate?: AniDate;
  duration?: number;
  trailer?: { id?: string; site?: string; thumbnail?: string } | null;
  studios?: { edges?: Array<{ isMain?: boolean; node?: { name?: string; siteUrl?: string } }> };
  tags?: Array<{ name?: string; rank?: number; isGeneralSpoiler?: boolean; isMediaSpoiler?: boolean }>;
  characters?: { edges?: AniCharacterEdge[] };
  staff?: { edges?: AniStaffEdge[] };
}

/**
 * An AniList date triple to ISO, only when it is actually complete.
 *
 * The three parts are independently nullable, so a partial answer is routine.
 * Composing `2024-null-null` into `2024-01-01` would invent a precise debut
 * date out of a year — and a precise wrong date is worse than an honest year,
 * because nothing downstream can tell it was a guess.
 */
export function aniListDate(date: AniDate | undefined): string | undefined {
  if (!date?.year) return undefined;
  if (!date.month) return String(date.year);
  const month = String(date.month).padStart(2, '0');
  if (!date.day) return `${date.year}-${month}`;
  return `${date.year}-${month}-${String(date.day).padStart(2, '0')}`;
}

/** AniList's `MAIN`/`SUPPORTING`/`BACKGROUND` to a billing order. */
function roleOrder(role: string | undefined, index: number): number {
  const base = role === 'MAIN' ? 0 : role === 'SUPPORTING' ? 1000 : 2000;
  return base + index;
}

/** `ORIGINAL`, `LIGHT_NOVEL` → prose a reader recognises. */
const SOURCE_LABELS: Record<string, string> = {
  ORIGINAL: 'an original work',
  MANGA: 'a manga',
  LIGHT_NOVEL: 'a light novel',
  VISUAL_NOVEL: 'a visual novel',
  VIDEO_GAME: 'a video game',
  NOVEL: 'a novel',
  DOUJINSHI: 'a doujinshi',
  ANIME: 'an anime',
  WEB_NOVEL: 'a web novel',
  LIVE_ACTION: 'a live-action work',
  GAME: 'a game',
  COMIC: 'a comic',
  MULTIMEDIA_PROJECT: 'a multimedia project',
  PICTURE_BOOK: 'a picture book',
};

export interface AniListCredits {
  people: CreditPerson[];
  ratings: TitleRating[];
  studios: Organisation[];
  keywords: string[];
  genres: string[];
  alternateTitles: string[];
  originalTitle?: string;
  releaseDate?: string;
  endDate?: string;
  status?: TitleStatus;
  /** Episodes in the whole run, where AniList knows the total. */
  episodeCount?: number;
  countries: string[];
  posterUrl?: string;
  backdropUrl?: string;
  plot?: string;
  videos: TitleVideo[];
  trivia: ProductionNote[];
}

/** `FINISHED`, `RELEASING`, … to this record's vocabulary. */
function aniListStatus(raw: string | undefined): TitleStatus | undefined {
  if (!raw) return undefined;
  if (raw === 'NOT_YET_RELEASED') return TitleStatus.Upcoming;
  return normaliseStatus(raw.replace(/_/g, ' '));
}

/**
 * AniList's `description` is HTML, and the page renders text.
 *
 * Kept as prose rather than dropped: it is frequently the only synopsis a
 * scraped anime page has, since a provider scraping a streaming site gets the
 * site's one-line blurb and nothing else.
 */
function stripHtml(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const text = value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text || undefined;
}

/**
 * A country code to the language spoken in it.
 *
 * Only the four AniList actually publishes. A lookup that guessed beyond them
 * would state a language on the page from nothing more than a flag, which is
 * the kind of confident wrongness a reader has no way to detect.
 */
const ORIGIN_COUNTRIES: Record<string, string> = {
  JP: 'Japan',
  KR: 'South Korea',
  CN: 'China',
  TW: 'Taiwan',
};

/**
 * The GraphQL payload to credits. Pure, so it can be tested without a network.
 *
 * Note the two independent pairs of names it preserves. The performer has
 * `full` and `native`, and so does the character, and they are *different
 * people* — collapsing either pair, or crossing them, produces a cast list that
 * looks right to a reader of one script and is nonsense to a reader of the
 * other.
 */
export function parseAniList(media: AniListMediaCredits | null | undefined): AniListCredits {
  const empty: AniListCredits = {
    people: [],
    ratings: [],
    studios: [],
    keywords: [],
    genres: [],
    countries: [],
    alternateTitles: [],
    videos: [],
    trivia: [],
  };
  if (!media) return empty;

  const people: CreditPerson[] = [];

  (media.characters?.edges ?? []).forEach((edge, index) => {
    const character = edge.node?.name?.full;
    const characterNative = edge.node?.name?.native;
    const characterImage = edge.node?.image?.large || edge.node?.image?.medium;
    const order = roleOrder(edge.role, index);

    const actors = edge.voiceActors ?? [];
    if (actors.length === 0) {
      // No performer recorded. The character is still worth listing — and this
      // row credits nobody with playing it.
      if (!character) return;
      people.push({
        name: character,
        originalName: characterNative,
        role: CreditRole.Cast,
        order,
        imageUrl: characterImage,
        characterImageUrl: characterImage,
        profileUrl: edge.node?.siteUrl,
        sources: [MetadataSource.AniList],
      });
      return;
    }

    for (const actor of actors) {
      const name = actor.name?.full || actor.name?.native;
      if (!name) continue;
      people.push({
        name,
        originalName: actor.name?.native,
        role: CreditRole.Voice,
        character,
        characterOriginalName: characterNative,
        order,
        imageUrl: actor.image?.large || actor.image?.medium,
        characterImageUrl: characterImage,
        profileUrl: actor.siteUrl,
        voiceLanguage: actor.languageV2,
        sources: [MetadataSource.AniList],
      });
    }
  });

  for (const edge of media.staff?.edges ?? []) {
    const name = edge.node?.name?.full || edge.node?.name?.native;
    if (!name) continue;
    people.push({
      name,
      originalName: edge.node?.name?.native,
      role: CreditRole.Crew,
      job: edge.role || undefined,
      department: classifyJob(edge.role),
      imageUrl: edge.node?.image?.large || edge.node?.image?.medium,
      profileUrl: edge.node?.siteUrl,
      sources: [MetadataSource.AniList],
    });
  }

  const ratings: TitleRating[] = [];
  // AniList publishes 0–100 and is stored that way. `normalisedRating` scales
  // it at read time, and answers null for the 0 that means "unrated" — which
  // is the value AniList actually sends for a title nobody has scored.
  if (typeof media.averageScore === 'number') {
    ratings.push({
      source: MetadataSource.AniList,
      kind: 'user',
      value: media.averageScore,
      scaleMin: 0,
      scaleMax: 100,
      votes: media.popularity,
      url: media.id ? `https://anilist.co/anime/${media.id}` : undefined,
    });
  }

  const videos: TitleVideo[] = [];
  if (media.trailer?.id && media.trailer.site) {
    const site = media.trailer.site.toLowerCase();
    if (site === 'youtube') {
      // Through the shared builder so an AniList trailer dedupes against the
      // same video arriving from Cinemeta — they are one card, not two.
      videos.push(
        youTubeVideo(media.trailer.id, {
          source: MetadataSource.AniList,
          fallbackTitle: 'Trailer',
        })
      );
    } else if (site === 'dailymotion') {
      videos.push({
        id: `dailymotion:${media.trailer.id}`,
        title: 'Trailer',
        label: 'Trailer',
        url: `https://www.dailymotion.com/video/${media.trailer.id}`,
        kind: TitleVideoKind.Trailer,
        host: 'web',
        thumbnailUrl: media.trailer.thumbnail,
        sources: [MetadataSource.AniList],
      });
    }
  }

  const trivia: ProductionNote[] = [];
  const sourceLabel = media.source ? SOURCE_LABELS[media.source] : undefined;
  if (sourceLabel && media.id) {
    trivia.push({
      heading: 'Source material',
      text: `Adapted from ${sourceLabel}.`,
      attribution: {
        source: MetadataSource.AniList,
        url: `https://anilist.co/anime/${media.id}`,
        licence: 'AniList',
      },
    });
  }

  return {
    people,
    ratings,
    studios: (media.studios?.edges ?? [])
      // Licensors and distributors ride in the same list as the animation
      // studio; only the main one is the studio a viewer means.
      .filter((edge) => edge.isMain !== false && edge.node?.name)
      .map<Organisation>((edge) => ({ name: edge.node!.name as string, url: edge.node?.siteUrl })),
    keywords: (media.tags ?? [])
      // A spoiler tag on a detail page is the one piece of metadata that can
      // actively ruin the thing the viewer came to watch.
      .filter((tag) => tag.name && !tag.isGeneralSpoiler && !tag.isMediaSpoiler)
      .sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0))
      .slice(0, 12)
      .map((tag) => tag.name as string),
    alternateTitles: [
      media.title?.romaji,
      media.title?.english,
      media.title?.native,
      ...(media.synonyms ?? []),
    ].filter((title): title is string => Boolean(title)),
    genres: media.genres ?? [],
    originalTitle: media.title?.native || media.title?.romaji,
    releaseDate: aniListDate(media.startDate),
    endDate: aniListDate(media.endDate),
    status: aniListStatus(media.status),
    episodeCount: media.episodes && media.episodes > 0 ? media.episodes : undefined,
    countries: media.countryOfOrigin && ORIGIN_COUNTRIES[media.countryOfOrigin]
      ? [ORIGIN_COUNTRIES[media.countryOfOrigin]]
      : [],
    posterUrl: media.coverImage?.extraLarge || media.coverImage?.large,
    backdropUrl: media.bannerImage,
    plot: stripHtml(media.description),
    videos,
    trivia,
  };
}

/**
 * One AniList media's credits.
 *
 * `rawFetch` rather than `fetchJson`, and rather than global `fetch`. The
 * helper's retry is wrong here — this is a POST of a GraphQL document, and a
 * 429 is the one answer that must not be replayed — but going straight to
 * `fetch` would bypass the injected transport, and with it the DNS-over-HTTPS
 * setting and the system proxy. `metadataProvider.ts` still calls global
 * `fetch` for AniList and quietly ignores the DNS setting as a result; that is
 * a pre-existing bug, not a convention to copy.
 */
export async function fetchAniListCredits(
  id: number | string,
  signal?: AbortSignal
): Promise<AniListCredits> {
  const response = await rawFetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: QUERY, variables: { id: Number(id) } }),
    signal: signal ?? AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`AniList HTTP ${response.status}`);

  const json = (await response.json()) as { data?: { Media?: AniListMediaCredits } };
  return parseAniList(json.data?.Media);
}

/**
 * The AniList id for a title, when nothing carried one.
 *
 * An anime detail page that reaches enrichment with no AniList id gets no
 * characters, no voice actors and no native names — which is the whole of what
 * this source is here for. Most of this app's anime arrives exactly that way,
 * from a `.cs3` provider that scraped a streaming site and knows only what the
 * page printed.
 *
 * **Conservative in the same way `cs3/titleEnricher.ts` is, and for the same
 * reason.** Returning the wrong anime does not degrade the page, it replaces it:
 * a cast list from a different series under this one's name reads as data
 * corruption, and nothing on screen would mark it as a guess. So a disagreeing
 * year disqualifies outright, and a match must either be exact once normalised
 * or clear a high similarity bar against one of the four names AniList carries.
 *
 * `null` is the ordinary answer and costs nothing — the page keeps the credits
 * the other catalogues found.
 */
export async function searchAniListId(
  title: string,
  year: number | undefined,
  signal?: AbortSignal
): Promise<number | null> {
  const trimmed = title.trim();
  if (trimmed.length < 2) return null;

  const response = await rawFetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      query: `query ($search: String) {
        Page(perPage: 8) {
          media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
            id
            title { romaji english native }
            synonyms
            startDate { year }
          }
        }
      }`,
      variables: { search: trimmed },
    }),
    signal: signal ?? AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`AniList HTTP ${response.status}`);

  const json = (await response.json()) as {
    errors?: unknown[];
    data?: {
      Page?: {
        media?: Array<{
          id?: number;
          title?: { romaji?: string; english?: string; native?: string };
          synonyms?: string[];
          startDate?: { year?: number };
        }>;
      };
    };
  };
  // A GraphQL 200 can be a failure: AniList reports a bad query and a rate
  // limit as HTTP 200 with `errors` and a null `data`, so `response.ok` says
  // nothing on its own.
  if (json.errors?.length) throw new Error('AniList rejected the search');

  const wanted = normaliseTitleForMatch(trimmed);
  if (!wanted) return null;

  for (const media of json.data?.Page?.media ?? []) {
    if (!media.id) continue;
    const candidateYear = media.startDate?.year;
    // The single strongest signal that two same-named works are different ones.
    if (year && candidateYear && Math.abs(candidateYear - year) > 1) continue;

    const names = [
      media.title?.romaji,
      media.title?.english,
      media.title?.native,
      ...(media.synonyms ?? []),
    ].filter((name): name is string => Boolean(name?.trim()));

    for (const name of names) {
      const normalised = normaliseTitleForMatch(name);
      if (!normalised) continue;
      if (normalised === wanted) return media.id;
      if (titleSimilarity(trimmed, name) >= ANILIST_MATCH_FLOOR) return media.id;
    }
  }

  return null;
}
