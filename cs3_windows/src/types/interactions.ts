/**
 * What has already happened between this viewer and one title.
 *
 * ## Why this is a record rather than a flag on the card
 *
 * Every surface in this app draws the same `PosterCard` — search results, the
 * home rails, a platform catalogue, the library, bookmarks, history, related
 * titles — and until now each one decided for itself what to put on it. Search
 * passed an outcome, Continue Watching passed a percentage, and everything else
 * passed nothing, so the same film was a different card depending on which
 * screen you found it on. A viewer cannot learn a language that changes between
 * rooms.
 *
 * So the states are one record, assembled once, and the card renders it. The
 * card gains no knowledge of the library, the download queue or the source
 * cache; the record gains no opinion about colour.
 *
 * ## Identity: two keys, and both are needed
 *
 * `key` is `canonicalKey(title, year)` — the library's identity, under which
 * one film found through five providers is one entry. That is the right key for
 * everything about *the work*: whether it has been watched, whether a copy is on
 * disk, how far through it the viewer is.
 *
 * `url` is the address of this particular row. That is the right key for
 * everything about *this source of it*: whether this provider's page opened,
 * and whether it produced anything playable. Folding those onto the title would
 * mark every copy of a film failed because one scraper's page was dead, which is
 * the wrong-answer-that-looks-plausible failure this repository keeps naming.
 *
 * So the aggregation joins on both, and a batched reply is keyed by `url`
 * because that is what the caller has in hand for each card.
 *
 * ## Nothing here is derived in the renderer
 *
 * Except by {@link module:src/utils/cardState}, which is pure and tested for the
 * reason `deadRows.ts` and `ottPlatforms.ts` are: every wrong answer is silent,
 * plausible, and attributed to the content rather than to us.
 */

/**
 * What happened last time someone tried to play a title at one address.
 *
 * Declared here rather than in `electron/cs3/titleOutcomes.ts`, which owns the
 * store, because both sides need the vocabulary and `PosterCard` had been
 * carrying its own copy of the union inline — two spellings of one closed set,
 * which is how one of them comes to be missing a member nobody notices.
 *
 * **The distinction that matters is whose fault it was.** `no-sources` is about
 * the source and belongs on the row; `app-error` is ours, and marking a title
 * unavailable for our own bug is how one broken translation pass came to look
 * like a hundred broken providers.
 */
export type TitleOutcomeKind = 'played' | 'no-sources' | 'app-error';

/** How a title's downloads are going, collapsed across every variant of it. */
export const DownloadSummaryState = {
  Queued: 'queued',
  Downloading: 'downloading',
  Paused: 'paused',
  Completed: 'completed',
  Failed: 'failed',
} as const;
export type DownloadSummaryState =
  (typeof DownloadSummaryState)[keyof typeof DownloadSummaryState];

/**
 * When the details page for this address was opened, and how often.
 *
 * The only fact in this record that nothing already stored: `PageSnapshotStore`
 * keeps a *copy* of each page and is capped at a few hundred, so deriving
 * "visited" from it would make a title stop being marked visited because three
 * hundred other titles were opened since. This ledger is two numbers and a
 * count, so it can hold thousands.
 */
export interface VisitRecord {
  firstAt: number;
  lastAt: number;
  count: number;
}

/** How far through the title the viewer got, from the library's own record. */
export interface WatchSummary {
  /** 0–100. Absent rather than zero when nothing has been watched. */
  percent: number;
  /** Past the completion threshold the library uses. */
  completed: boolean;
  season?: number;
  episode?: number;
  /** "S2 E4 · 38 min left" — the library already phrases this; it is not rebuilt. */
  label?: string;
  updatedAt: number;
}

export interface DownloadSummary {
  state: DownloadSummaryState;
  /** 0–100 for the transfer in progress, where one is. */
  percent?: number;
  /** How many variants of this title are in the queue at all. */
  variants: number;
  /** Why it failed, for the tooltip. Never rendered as a label. */
  reason?: string;
}

/**
 * Whether discovery could start this title now without asking anyone.
 *
 * `ready` counts sources whose links are still believed good; `expired` says an
 * entry exists but everything in it needs re-resolving. The distinction is the
 * point: the second is a title that *will* play after a pause, and reporting it
 * as ready is how a viewer comes to think the app lies about being ready.
 */
export interface SourceReadiness {
  ready: number;
  expired: boolean;
}

export interface TitleInteraction {
  /** Echoed, so a batched reply can be placed against the row that asked. */
  url: string;
  /** `canonicalKey(title, year)`. */
  key: string;
  visited?: VisitRecord;
  watch?: WatchSummary;
  /** What happened last time this address was opened for playback. */
  outcome?: { kind: TitleOutcomeKind; reason?: string; at: number };
  download?: DownloadSummary;
  sources?: SourceReadiness;
  /** The provider that last produced a stream that actually played. */
  lastProvider?: string;
}

/** What a caller knows about a card before anything is looked up. */
export interface TitleInteractionQuery {
  url: string;
  title: string;
  year?: number;
}
