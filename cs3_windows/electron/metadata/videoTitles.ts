/**
 * What a promotional video is, read out of its own title.
 *
 * ## Why this has to be inferred at all
 *
 * Measured against the live catalogues on 2026-09-18, the keyless sources
 * publish a YouTube id and almost nothing else:
 *
 * | Source | Videos per title | Type published |
 * |---|---|---|
 * | Cinemeta `trailers[]` | 2–5 (Spider-Verse 5, Dune: Part Two 3) | literally `"Trailer"`, on every entry |
 * | Cinemeta `trailerStreams[]` | the same ids again | a `title` that is the *film's* name repeated |
 * | AniList `trailer` | 1 | the site, not the type |
 *
 * So "Official Trailer" versus "Teaser" versus "Behind the Scenes" is not a
 * field anybody gives us. What *is* available, keylessly and in about 190 ms,
 * is the video's real title from YouTube's oEmbed endpoint — and that carries
 * the answer plainly:
 *
 *     "Dune: Part Two | Official Trailer 3"                  trailer,  3
 *     "Stranger Things | Official Final Trailer | Netflix"    trailer,  final
 *     "Stranger Things Season 1 Trailer 1 | Rotten Tomatoes"  trailer,  season 1
 *     "SPIDER-MAN: ACROSS THE SPIDER-VERSE – First Look"      promo
 *
 * This module is that reading, and it is pure and tested for the reason
 * `ottPlatforms.ts` is: a matcher one word too loose files a making-of under
 * "Trailers" and nothing anywhere says so. The viewer clicks what they were
 * told is the trailer and gets eleven minutes of interviews.
 *
 * ## Two rules that shape every pattern below
 *
 * **Order is specificity, not frequency.** "Behind the scenes of the trailer"
 * contains the word "trailer"; a `trailer` rule tested first would claim it. So
 * the narrow kinds are tested before the broad ones, always.
 *
 * **An unrecognised title is a trailer, not an error.** These videos come from
 * a *trailer* field on a catalogue; the publisher simply titled it something
 * this file has never seen. Filing it under `other` would hide it in Related
 * Videos, which is the one outcome worse than a slightly wrong label — the
 * viewer asked for the trailer and it would not be in the trailers.
 */

import { MetadataSource, TitleVideoKind, type TitleVideo } from '../../src/types/metadata.ts';

/** What a title says about itself, before a `TitleVideo` is built from it. */
export interface VideoClassification {
  kind: TitleVideoKind;
  label: string;
  season?: number;
  ordinal?: number;
}

/**
 * The publishers whose uploads are the studio's own.
 *
 * Deliberately a *shape* rather than a list of channel names: the list would be
 * hundreds of studios long, wrong for every country this corpus serves, and out
 * of date within a year. What is stable is that the official channel is the one
 * whose name contains the distributor's own words — Pictures, Studios, Films,
 * Entertainment — or is one of the streaming services that publishes its own
 * trailers. Measured against what Cinemeta actually returns: Warner Bros.,
 * Sony Pictures Entertainment, Sony Pictures Releasing UK and Netflix match;
 * "Rotten Tomatoes TV" and a personal account do not.
 *
 * Wrong in the shy direction costs an ordering nudge. Wrong in the eager
 * direction would put a fan re-upload at the front of the rail, so the test is
 * tight and the flag is only ever used to sort.
 */
const OFFICIAL_PUBLISHER =
  /\b(pictures|studios?|films?|entertainment|movies|releasing|distribution|animation|television|tv network|netflix|prime video|max|hbo|disney|hulu|paramount|universal|warner|sony|lionsgate|a24|mubi|crunchyroll|apple tv)\b/i;

/**
 * Kind patterns, narrowest first.
 *
 * Each entry is [pattern, kind]. The first match wins, so moving a row changes
 * behaviour — see the specificity rule in the header.
 */
const KINDS: ReadonlyArray<[RegExp, TitleVideoKind]> = [
  // Narrow, and all of them contain words the broad rules would also match.
  [/\b(behind[- ]the[- ]scenes|bts|making[- ]of|on[- ]set|b[- ]roll)\b/i, TitleVideoKind.BehindTheScenes],
  [/\b(interview|q\s*&\s*a|cast chat|in conversation|roundtable)\b/i, TitleVideoKind.Interview],
  [/\b(featurette|inside look|the story of|anatomy of a scene|vfx breakdown)\b/i, TitleVideoKind.Featurette],
  [/\b(clip|scene|opening (scene|sequence)|deleted scene|exclusive clip)\b/i, TitleVideoKind.Clip],
  // Teaser before trailer: "Teaser Trailer" is a teaser.
  [/\b(teaser|sneak peek|first look|announcement)\b/i, TitleVideoKind.Teaser],
  [
    // "In Theaters June 2" and "Only In Cinemas June 2" are release
    // announcements, measured on Spider-Verse where Sony publishes both.
    /\b(tv spot|promo|spot|sizzle|date announce|now streaming|in (cinemas|theat(er|re)s))\b/i,
    TitleVideoKind.Promo,
  ],
  [/\btrailer\b/i, TitleVideoKind.Trailer],
];

/** How each kind is named on a card when the title gives nothing better. */
const KIND_LABELS: Record<TitleVideoKind, string> = {
  [TitleVideoKind.Trailer]: 'Trailer',
  [TitleVideoKind.Teaser]: 'Teaser',
  [TitleVideoKind.Promo]: 'Promo',
  [TitleVideoKind.Clip]: 'Clip',
  [TitleVideoKind.Featurette]: 'Featurette',
  [TitleVideoKind.BehindTheScenes]: 'Behind the scenes',
  [TitleVideoKind.Interview]: 'Interview',
  [TitleVideoKind.Other]: 'Video',
};

/**
 * The segment of a title that describes the video.
 *
 * Publishers separate the film's name from the video's description with a pipe
 * or a dash — "Dune: Part Two | Official Trailer 3", "SPIDER-MAN … - First
 * Look" — and the descriptive half is the one worth putting on a chip. Taking
 * the whole title would print the film's name on every card in a gallery that
 * is already under the film's name.
 *
 * Falls back to the whole title when there is no separator, because a single
 * clause is the description.
 */
function descriptiveSegment(title: string): string {
  const parts = title
    .split(/\s*[|–—]\s*|\s+-\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return title.trim();

  /**
   * The **first** segment that describes the video, not the last.
   *
   * Measured on Sony's `Spider-Man: Across the Spider-Verse - Trailer #3 -
   * Only In Cinemas June 2`: two segments describe it, and the release
   * announcement is the one that comes last. Taking the last labelled that card
   * "Only In Cinemas June 2" and classified a numbered trailer as a promo,
   * losing both the kind and the ordinal. The first describing segment is the
   * one the publisher led with, which is the one worth showing.
   *
   * The last segment remains the fallback, because the channel's sign-off
   * ("| Netflix") is only ever reached when nothing describes the video at all.
   */
  const described = parts.find((part) => KINDS.some(([pattern]) => pattern.test(part)));
  return described ?? parts[parts.length - 1];
}

/**
 * Format decoration publishers append, which is not part of the name.
 *
 * "(HD)", "(4K)", "[Official Video]" - measured on Sony's uploads, where every
 * trailer carries one. They cost a third of a chip's width and say nothing a
 * viewer is choosing between.
 */
function stripDecoration(text: string): string {
  return text
    .replace(/[([]\s*(hd|4k|uhd|1080p?|720p?|official(\s+video)?)\s*[)\]]/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** `Official Trailer 3` → 3, `Trailer #2` → 2. */
function readOrdinal(text: string): number | undefined {
  const match = text.match(/\b(?:trailer|teaser|promo|spot|clip)\s*#?\s*(\d{1,2})\b/i);
  if (match) {
    const value = Number.parseInt(match[1], 10);
    if (Number.isFinite(value) && value > 0 && value < 50) return value;
  }
  return undefined;
}

/**
 * Which season a video promotes.
 *
 * Bounded at 1–99 and required to be adjacent to the word "season": release
 * titles are full of bare numbers — resolutions, years, part numbers — and a
 * looser pattern would file "Trailer 2" under season 2 and hide the series
 * trailer behind a heading for a season that may not exist.
 */
export function readSeason(title: string): number | undefined {
  const match = title.match(/\bs(?:eason)?\s*\.?\s*(\d{1,2})\b/i);
  if (!match) return undefined;
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) && value > 0 && value < 100 ? value : undefined;
}

export function classifyVideoTitle(rawTitle: string): VideoClassification {
  const title = (rawTitle ?? '').trim();
  const segment = descriptiveSegment(title);

  /**
   * The descriptive segment decides the kind; the whole title is only a
   * fallback.
   *
   * Testing both together lets a *different* segment win, and the rules are
   * ordered by specificity so the loser is whichever kind sits lower in the
   * table. Measured on `Spider-Man: Across the Spider-Verse - Trailer #3 -
   * Only In Cinemas June 2`: the label correctly read "Trailer #3" while the
   * kind came back `promo`, because "In Cinemas" elsewhere in the string
   * matched a rule listed above `trailer`. A card that says "Trailer #3" and is
   * filed under Related Videos is the worst of both readings.
   */
  let kind: TitleVideoKind | null = null;
  for (const [pattern, candidate] of KINDS) {
    if (pattern.test(segment)) {
      kind = candidate;
      break;
    }
  }
  if (kind === null) {
    for (const [pattern, candidate] of KINDS) {
      if (pattern.test(title)) {
        kind = candidate;
        break;
      }
    }
  }
  // See the header: an unrecognised promotional video is a trailer, because
  // these arrive from a trailer field and hiding one is worse than mislabelling
  // it.
  kind ??= TitleVideoKind.Trailer;

  const season = readSeason(title);
  const ordinal = readOrdinal(segment) ?? readOrdinal(title);

  /**
   * The label: the publisher's own words where they are short enough to read on
   * a chip, and the kind's name otherwise.
   *
   * 42 characters is not arbitrary — it is about the width of a video card's
   * caption row, and a longer string is an ellipsis rather than information.
   * "Official Trailer 3" survives; "In Theaters June 2 — Stronger" does not and
   * becomes "Promo", which is both shorter and truer.
   */
  const cleaned = stripDecoration(segment);
  const usable = cleaned && cleaned.length <= 42 && /[A-Za-z]/.test(cleaned);
  const label = usable ? cleaned : KIND_LABELS[kind];

  return { kind, label, season, ordinal };
}

/**
 * Whether a channel name reads as the rights holder's own.
 *
 * Only ever used to order the rail; nothing is hidden for failing it.
 */
export function looksOfficial(publisher: string | undefined): boolean {
  if (!publisher) return false;
  return OFFICIAL_PUBLISHER.test(publisher);
}

/**
 * Builds a video record from a YouTube id and whatever is known about it.
 *
 * The thumbnail is *derived* rather than fetched: `i.ytimg.com/vi/<id>/…` is
 * addressable from the id alone, so a gallery costs zero requests to draw its
 * artwork and Chromium's own HTTP cache handles the rest — which is the whole
 * of PRD-45 §9's thumbnail caching, without a second cache to keep correct.
 */
export function youTubeVideo(
  id: string,
  options: {
    title?: string;
    publisher?: string;
    source: MetadataSource;
    /** Used only when nothing has supplied a real title yet. */
    fallbackTitle?: string;
  }
): TitleVideo {
  const title = (options.title ?? options.fallbackTitle ?? 'Trailer').trim();
  const classification = classifyVideoTitle(title);
  return {
    id: `youtube:${id}`,
    title,
    url: `https://www.youtube.com/watch?v=${id}`,
    host: 'youtube',
    thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    publisher: options.publisher,
    official: looksOfficial(options.publisher),
    sources: [options.source],
    ...classification,
  };
}

/**
 * The order a gallery draws them in.
 *
 * Series trailers before season ones, then by season; within a group, trailers
 * before teasers before promos.
 *
 * Then two tie-breaks, in this order and deliberately:
 *
 * **Official before not.** A studio upload is the canonical trailer; a fan
 * re-upload is lower quality and more likely to be taken down, so it goes
 * behind even when it carries a higher number.
 *
 * **Highest ordinal first.** "Official Trailer 3" is the most recent and the
 * most complete look at the film, which is what somebody opening a trailer
 * wants. Ascending would lead every major release with its earliest teaser.
 */
const KIND_RANK: Record<TitleVideoKind, number> = {
  [TitleVideoKind.Trailer]: 0,
  [TitleVideoKind.Teaser]: 1,
  [TitleVideoKind.Promo]: 2,
  [TitleVideoKind.Clip]: 3,
  [TitleVideoKind.Featurette]: 4,
  [TitleVideoKind.BehindTheScenes]: 5,
  [TitleVideoKind.Interview]: 6,
  [TitleVideoKind.Other]: 7,
};

export function orderVideos(videos: TitleVideo[]): TitleVideo[] {
  return [...videos].sort((a, b) => {
    const season = (a.season ?? 0) - (b.season ?? 0);
    if (season !== 0) return season;
    const kind = KIND_RANK[a.kind] - KIND_RANK[b.kind];
    if (kind !== 0) return kind;
    const official = Number(b.official ?? false) - Number(a.official ?? false);
    if (official !== 0) return official;
    const ordinal = (b.ordinal ?? 0) - (a.ordinal ?? 0);
    if (ordinal !== 0) return ordinal;
    // Stable and reproducible, so two runs of one gallery are one gallery.
    return a.id.localeCompare(b.id);
  });
}
