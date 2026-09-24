/**
 * Everything the app already knows about a title, assembled for its card.
 *
 * ## This is a join, not a sixth store
 *
 * Nearly every fact PRD-46 asks a card to show is already recorded somewhere:
 * watch progress and the resume point in `libraryStore`, what happened last
 * time in `titleOutcomes`, transfers in `downloadService`, resolvable links in
 * `sourceCache`, the provider that actually played in `playedSource`. Copying
 * any of that into a new table would create a second record of one fact, and
 * this repository has a standing account of what that costs — the adult gate,
 * the runtime stamp, the settings level: the day the two disagree, two screens
 * tell one person different things and neither is obviously wrong.
 *
 * So this owns exactly one fact nobody else has — **that the details page was
 * opened** — and reads the rest live.
 *
 * ## Why visits could not be derived from `PageSnapshotStore`
 *
 * That store captures every detail page opened, which sounds like the same
 * thing. It keeps a *copy of the page*, so it is capped; a title would stop
 * being marked visited because a few hundred other titles were opened after it,
 * and the badge would disappear from cards in an order nobody could explain. A
 * visit is two timestamps and a count, so this ledger holds an order of
 * magnitude more for a fraction of the bytes.
 *
 * ## Batched, because a grid is forty rows
 *
 * `summarise` takes the whole screen's worth at once, for `useSourceProvenance`'s
 * reason: forty cards asking one at a time is forty IPC round trips to read
 * five in-memory maps.
 *
 * ## What is deliberately not recorded
 *
 * No query text, no titles beyond the key, and nothing about *why* a title was
 * opened. The key is a normalised title and a year — the same thing the library
 * already holds — and this file is long-lived, which is exactly the argument
 * `extensionIssues.ts` makes for keeping URLs out of a durable ledger.
 */

import type { DatastoreManager } from '../datastore.ts';
import type { DownloadTask } from '../../src/types/download';
import { DownloadState } from '../../src/types/download';
import type {
  DownloadSummary,
  SourceReadiness,
  TitleInteraction,
  TitleInteractionQuery,
  VisitRecord,
  WatchSummary,
} from '../../src/types/interactions';
import { canonicalKey, type LibraryStore } from './libraryStore.ts';
import type { TitleOutcomeStore } from './titleOutcomes.ts';

const KEY = 'cs3_title_visits';

/**
 * How many titles are remembered as visited.
 *
 * Far larger than `PageSnapshotStore`'s cap because a row here is three numbers
 * rather than a page. Someone browsing for a year should not watch the dimming
 * fall off the front of their history.
 */
const MAX_VISITS = 4_000;

/**
 * How long a visit is worth remembering.
 *
 * Long, because the whole value of the mark is recognising something from weeks
 * ago — "I looked at this already" is exactly the thing a short window would
 * throw away. Bounded at all because this is a convenience, and an unbounded
 * ledger in a backup is a browsing history under another name.
 */
const VISIT_TTL_MS = 180 * 24 * 60 * 60 * 1000;

type VisitRow = VisitRecord & { key: string };

/** Which download states, collapsed, describe a title as a whole. */
function summariseDownloads(tasks: DownloadTask[]): DownloadSummary | undefined {
  if (tasks.length === 0) return undefined;

  /**
   * Order is precedence, and it is "what is happening" rather than "what is
   * worst". A title with one transfer running and three finished is
   * downloading; a title with one failed and three finished is downloaded,
   * because a copy is on disk and that is the fact that changes what the viewer
   * would do. Failure only wins when nothing succeeded.
   */
  const active = tasks.find(
    (task) =>
      task.state === DownloadState.Downloading ||
      task.state === DownloadState.Retrying ||
      task.state === DownloadState.RefreshingSource
  );
  if (active) {
    return {
      state: 'downloading',
      percent:
        active.totalBytes > 0
          ? Math.min(100, (active.bytesDownloaded / active.totalBytes) * 100)
          : undefined,
      variants: tasks.length,
    };
  }

  if (tasks.some((task) => task.state === DownloadState.Completed)) {
    return { state: 'completed', variants: tasks.length };
  }
  if (tasks.some((task) => task.state === DownloadState.Queued)) {
    return { state: 'queued', variants: tasks.length };
  }

  const failed = tasks.find((task) => task.state === DownloadState.Failed);
  if (failed) {
    return { state: 'failed', variants: tasks.length, reason: failed.errorMessage };
  }
  if (tasks.some((task) => task.state === DownloadState.Paused)) {
    return { state: 'paused', variants: tasks.length };
  }
  return undefined;
}

export interface TitleInteractionDeps {
  datastore: DatastoreManager;
  library: LibraryStore;
  outcomes: TitleOutcomeStore;
  /**
   * Asked of `ContentService`, which owns the cache key rules — the episode
   * parameters and the scope suffix. Reproducing those here would be a second
   * spelling of one key, and a card would report "no sources cached" for an
   * episode whose entry is sitting right there under a key this file spelled
   * differently.
   */
  sourceReadiness: (url: string) => SourceReadiness | undefined;
  /** A thunk rather than the queue, because it changes under this file. */
  downloadTasks: () => DownloadTask[];
}

export class TitleInteractionStore {
  private readonly deps: TitleInteractionDeps;

  constructor(deps: TitleInteractionDeps) {
    this.deps = deps;
  }

  private rows(): VisitRow[] {
    const stored = this.deps.datastore.getObject<VisitRow[]>(KEY, []);
    if (!Array.isArray(stored)) return [];
    const now = Date.now();
    return stored.filter(
      (row) =>
        row &&
        typeof row.key === 'string' &&
        typeof row.lastAt === 'number' &&
        now - row.lastAt < VISIT_TTL_MS
    );
  }

  /**
   * Records that a details page was opened.
   *
   * Keyed on the title rather than the address, deliberately: the same film
   * opened from a search result and from a home rail is the same film, and
   * marking only the row that was clicked would leave four identical cards in
   * four different states on one screen.
   */
  public recordVisit(title: string, year?: number): VisitRecord | null {
    const key = canonicalKey(title ?? '', year);
    if (!key) return null;

    const now = Date.now();
    const rows = this.rows();
    const existing = rows.find((row) => row.key === key);
    const updated: VisitRow = existing
      ? { ...existing, lastAt: now, count: existing.count + 1 }
      : { key, firstAt: now, lastAt: now, count: 1 };

    const rest = rows.filter((row) => row.key !== key);
    rest.unshift(updated);
    this.deps.datastore.setObject(KEY, rest.slice(0, MAX_VISITS));
    return { firstAt: updated.firstAt, lastAt: updated.lastAt, count: updated.count };
  }

  public clearVisits(): number {
    const count = this.rows().length;
    this.deps.datastore.setObject(KEY, []);
    return count;
  }

  /**
   * Watch progress for a title, collapsed to one number.
   *
   * A series has one record per episode. The one that matters to a card is the
   * **furthest episode with history**, which is the rule `resumePoint.ts`
   * already settled for the resume button — not the most recently updated,
   * because rewatching episode 1 of a season somebody finished must not make
   * the card say they are 4% through the series.
   */
  private watchFor(key: string): WatchSummary | undefined {
    const entries = this.deps.library.getProgressForKey(key);
    if (entries.length === 0) return undefined;

    const best = [...entries].sort((a, b) => {
      const season = (b.season ?? 0) - (a.season ?? 0);
      if (season !== 0) return season;
      const episode = (b.episode ?? 0) - (a.episode ?? 0);
      if (episode !== 0) return episode;
      return b.updatedAt - a.updatedAt;
    })[0];

    if (!best) return undefined;
    const percent =
      best.durationSeconds > 0
        ? Math.min(100, (best.positionSeconds / best.durationSeconds) * 100)
        : 0;

    return {
      percent,
      completed: best.completed,
      season: best.season,
      episode: best.episode,
      updatedAt: best.updatedAt,
    };
  }

  /** One screen's worth of cards, keyed by the address each row asked with. */
  public summarise(queries: TitleInteractionQuery[]): Record<string, TitleInteraction> {
    const visits = new Map(this.rows().map((row) => [row.key, row]));
    const outcomes = this.deps.outcomes.list();

    /**
     * Downloads bucketed by title key once, rather than scanned per card.
     *
     * The queue is routinely hundreds of tasks and a catalogue page is forty
     * rows; scanning per row is the quadratic version of the same answer.
     */
    const downloadsByKey = new Map<string, DownloadTask[]>();
    for (const task of this.deps.downloadTasks()) {
      const name = task.parentTitle || task.title;
      if (!name) continue;
      const key = canonicalKey(name, task.year);
      const bucket = downloadsByKey.get(key);
      if (bucket) bucket.push(task);
      else downloadsByKey.set(key, [task]);
    }

    const out: Record<string, TitleInteraction> = {};
    for (const query of queries) {
      if (!query?.url) continue;
      const key = canonicalKey(query.title ?? '', query.year);
      const visit = visits.get(key);
      const outcome = outcomes[query.url];
      const played = this.deps.library.getPlayedSourcesForKey(key)[0];
      const entry = this.deps.library.getEntry(key);

      out[query.url] = {
        url: query.url,
        key,
        visited: visit
          ? { firstAt: visit.firstAt, lastAt: visit.lastAt, count: visit.count }
          : undefined,
        watch: this.watchFor(key),
        outcome: outcome
          ? { kind: outcome.kind, reason: outcome.reason, at: outcome.at }
          : undefined,
        download: summariseDownloads(downloadsByKey.get(key) ?? []),
        sources: query.url ? this.deps.sourceReadiness(query.url) : undefined,
        lastProvider: played?.source?.providerName ?? undefined,
        library: entry ? { key: entry.key, status: entry.status } : undefined,
      };
    }
    return out;
  }
}
