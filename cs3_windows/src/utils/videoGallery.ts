/**
 * How the trailers and videos on a detail page are arranged.
 *
 * Pure and beside the component rather than inside it, for `metadataSection.ts`
 * and `settingsLevel.ts`'s reason: Node's type-stripping loader cannot load
 * JSX, and the grouping is the half worth testing.
 *
 * ## The one line this draws
 *
 * **Trailers versus everything else.** `trailer`, `teaser` and `promo` are what
 * somebody means when they say "show me the trailer"; a clip, a featurette, a
 * making-of and an interview are worth having and are not what was asked for.
 * PRD-45 §7 asks for the second group as its own subsection, and the split is
 * here rather than in the component so a mis-filed kind is a failing test
 * rather than a card in the wrong rail.
 *
 * The failure directions are the usual asymmetric pair:
 *
 * | A trailer filed as related | A featurette filed as a trailer |
 * |---|---|
 * | The viewer scrolls past what they came for | They click "Official Trailer" and get eleven minutes of interviews |
 * | Annoying, and visible | Reads as the app being wrong about its own content |
 *
 * Which is why `videoTitles.ts` defaults an unrecognised video to `trailer`:
 * being in the right rail with a vague label beats being in the wrong one.
 */

import { TitleVideoKind, type TitleVideo } from '../types/metadata.ts';

/** One heading's worth of videos. `heading` is null for the ungrouped set. */
export interface VideoGroup {
  /** `null` when there is only one group — see `groupVideos`. */
  heading: string | null;
  /** Present for a season group, so the caller can key on something stable. */
  season?: number;
  videos: TitleVideo[];
}

/** The kinds that answer "show me the trailer". */
const TRAILER_KINDS = new Set<TitleVideoKind>([
  TitleVideoKind.Trailer,
  TitleVideoKind.Teaser,
  TitleVideoKind.Promo,
]);

export function isTrailer(video: TitleVideo): boolean {
  return TRAILER_KINDS.has(video.kind);
}

export interface GroupedVideos {
  trailerGroups: VideoGroup[];
  related: TitleVideo[];
  /** Everything, so a caller can ask "is there anything at all" in one test. */
  total: number;
}

/**
 * Trailers grouped by season, and everything else in one list.
 *
 * Two rules about the headings:
 *
 * **The work's own trailers come first, under "Trailers".** A series trailer is
 * about the whole show and a season trailer is about one run of it; ordering
 * seasons first would bury the one most people want.
 *
 * **One group carries no heading.** A film has exactly one group, and a
 * "Trailers" heading inside a section already titled "Trailers & videos" is a
 * line of text that says nothing — the same rule the About table follows about
 * labels with nothing beside them.
 *
 * Related videos are deliberately *not* grouped by season. They are usually one
 * or two rows in total, and splitting two featurettes across three headings is
 * more structure than content.
 */
export function groupVideos(videos: TitleVideo[]): GroupedVideos {
  const trailers = videos.filter(isTrailer);
  const related = videos.filter((video) => !isTrailer(video));

  const bySeason = new Map<number, TitleVideo[]>();
  const seriesWide: TitleVideo[] = [];
  for (const video of trailers) {
    if (video.season == null) {
      seriesWide.push(video);
      continue;
    }
    const bucket = bySeason.get(video.season);
    if (bucket) bucket.push(video);
    else bySeason.set(video.season, [video]);
  }

  const groups: VideoGroup[] = [];
  if (seriesWide.length > 0) groups.push({ heading: 'Trailers', videos: seriesWide });
  for (const season of [...bySeason.keys()].sort((a, b) => a - b)) {
    groups.push({
      heading: `Season ${season}`,
      season,
      videos: bySeason.get(season) as TitleVideo[],
    });
  }

  if (groups.length === 1) groups[0] = { ...groups[0], heading: null };

  return { trailerGroups: groups, related, total: videos.length };
}

/**
 * What the section should draw right now.
 *
 * The same four-way decision `metadataSection.ts` makes, for the same reason
 * and with the same ordering argument. PRD-45 §10 asks for both "hide the
 * section" and "show a 'no trailers available' state", which cannot both be
 * true — and this repository has already settled which one is right: **nothing
 * settled renders empty.** A "Trailers" heading over a blank space reads as a
 * lookup that failed, and for a title no catalogue carries a trailer for, that
 * impression would be permanent and wrong.
 *
 * What the PRD is actually protecting against is the third thing, and that is
 * honoured: `looking` draws one line rather than an empty box, so the wait is
 * visible work instead of a gap.
 */
export type VideoSectionState = 'looking' | 'content' | 'nothing';

export function videoSectionState(input: {
  videos: TitleVideo[] | undefined;
  /** The metadata lookup is still running. */
  pending?: boolean;
}): VideoSectionState {
  if ((input.videos?.length ?? 0) > 0) return 'content';
  return input.pending ? 'looking' : 'nothing';
}

/** `142` → `2:22`. Absent duration renders nothing at all, never "0:00". */
export function formatVideoDuration(seconds: number | undefined): string | null {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return null;
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

/**
 * The publish date as a year, where one is known.
 *
 * A year rather than a full date: the caption row has space for one short fact
 * beside the publisher, and "2023" answers "is this the new trailer or the old
 * one" — which is the only thing a date on a trailer card is ever asked.
 */
export function formatVideoDate(iso: string | undefined): string | null {
  if (!iso) return null;
  const year = iso.slice(0, 4);
  return /^\d{4}$/.test(year) ? year : null;
}
