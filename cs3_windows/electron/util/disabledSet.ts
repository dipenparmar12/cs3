import type { DatastoreManager } from '../datastore.ts';

/**
 * A persisted set of switched-off identities.
 *
 * The enable cascade has three levels — repository, extension, provider — and
 * each stored its own opt-outs with its own pair of methods: read the array,
 * build a `Set`, add or delete, write the array back. Three copies of eight
 * lines that differed only in which datastore key they named, and three places
 * for the next level to be added slightly differently.
 *
 * Three decisions are baked in here rather than repeated:
 *
 * **Disabled is stored, not enabled.** A provider nobody has an opinion about is
 * enabled, so the stored list is the exceptions. That is what lets a newly
 * installed extension work without anyone opting it in, and what keeps the
 * record small — a bootstrapped install has two hundred providers and usually
 * zero opinions about them.
 *
 * **The whole list comes back from every mutation.** The renderer re-renders
 * from what was actually stored rather than from what it assumed, so a failed
 * write shows up as the toggle springing back instead of as a lie on screen.
 *
 * **Bulk is the primitive and single is the special case.** Enabling a whole
 * repository is one write, not twenty — and twenty writes would each flush the
 * datastore to disk.
 */
export class DisabledSet {
  // Written out rather than declared as constructor parameter properties:
  // `erasableSyntaxOnly` is set across this project so that Node can strip the
  // types and run the suites directly, and that syntax is not erasable.
  private readonly datastore: DatastoreManager;
  private readonly key: string;

  constructor(datastore: DatastoreManager, key: string) {
    this.datastore = datastore;
    this.key = key;
  }

  /** The identities currently switched off. Order is not meaningful. */
  public list(): string[] {
    return this.datastore.getObject<string[]>(this.key, []) ?? [];
  }

  public has(id: string): boolean {
    return this.list().includes(id);
  }

  /** Switches `ids` on or off together, and answers with the new stored list. */
  public set(ids: string[], enabled: boolean): string[] {
    const disabled = new Set(this.list());
    for (const id of ids) {
      if (enabled) disabled.delete(id);
      else disabled.add(id);
    }
    const next = [...disabled];
    this.datastore.setObject(this.key, next);
    return next;
  }
}
