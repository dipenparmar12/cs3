import type { DatastoreManager } from '../datastore';

/**
 * What happened last time someone tried to play a title.
 *
 * Search results all look equally promising. They are not: some open and play,
 * some open onto a page with no links behind it, and some fail because our own
 * runtime could not handle the provider. Without a record, a viewer clicks the
 * same dead row on Tuesday that they clicked on Monday, and the app has no
 * memory of having already answered that question.
 *
 * **The distinction that matters is whose fault it was.** "This provider offered
 * no links" is about the source and is worth showing as a property of the row.
 * "Our extension runtime threw" is about the app, and telling the viewer the
 * title is unavailable would be blaming the content for our bug — which is
 * exactly the confusion that made `constructor_impl` look like a hundred broken
 * providers instead of one broken translation pass. They are stored separately
 * and rendered differently.
 *
 * Kept in the datastore's object bucket so it travels with backup and restore,
 * and bounded, because this is a convenience rather than a permanent record.
 */

const KEY = 'cs3_title_outcomes';

/** Enough to cover a few weeks of browsing without unbounded growth. */
const MAX_ENTRIES = 400;

export type TitleOutcomeKind =
  /** Played, or at least produced a link that started. */
  | 'played'
  /** The source has nothing behind this title. Its problem, and stable. */
  | 'no-sources'
  /** Our runtime or transport failed. Ours, and likely to change on a fix. */
  | 'app-error';

export interface TitleOutcome {
  url: string;
  kind: TitleOutcomeKind;
  /** The failure as reported, for the tooltip. */
  reason?: string;
  at: number;
}

/**
 * How long a failure is worth remembering.
 *
 * A source that had nothing yesterday often has something next week — releases
 * appear, mirrors come back. Holding a "no sources" verdict forever would turn
 * one bad night into a permanent gap in the catalogue, so it expires.
 * `app-error` expires faster still: the whole point of fixing a bug is that the
 * old verdict stops being true, and a stale one would hide the fix.
 */
const TTL_MS: Record<TitleOutcomeKind, number> = {
  played: 30 * 24 * 60 * 60 * 1000,
  'no-sources': 7 * 24 * 60 * 60 * 1000,
  'app-error': 24 * 60 * 60 * 1000,
};

export class TitleOutcomeStore {
  private datastore: DatastoreManager;

  constructor(datastore: DatastoreManager) {
    this.datastore = datastore;
  }

  private all(): TitleOutcome[] {
    const stored = this.datastore.getObject<TitleOutcome[]>(KEY, []);
    if (!Array.isArray(stored)) return [];
    const now = Date.now();
    return stored.filter(
      (entry) =>
        entry &&
        typeof entry.url === 'string' &&
        typeof entry.at === 'number' &&
        now - entry.at < (TTL_MS[entry.kind] ?? TTL_MS['no-sources'])
    );
  }

  /** Everything still current, as a map the renderer can look rows up in. */
  public list(): Record<string, TitleOutcome> {
    const out: Record<string, TitleOutcome> = {};
    for (const entry of this.all()) out[entry.url] = entry;
    return out;
  }

  public record(url: string, kind: TitleOutcomeKind, reason?: string): void {
    if (!url) return;
    const entries = this.all().filter((entry) => entry.url !== url);
    entries.unshift({ url, kind, reason, at: Date.now() });
    this.datastore.setObject(KEY, entries.slice(0, MAX_ENTRIES));
  }

  public clear(): void {
    this.datastore.setObject(KEY, []);
  }
}
