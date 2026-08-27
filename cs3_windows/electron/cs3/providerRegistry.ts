import fs from 'fs';

import { JsonFileStore } from '../util/jsonFileStore.ts';

/**
 * What each installed archive registered, remembered between launches.
 *
 * ## The measurement this exists for
 *
 * Loading every installed plugin into the JVM took **66.8 seconds** on the
 * development machine's real 124-archive install, and it happened on the first
 * search of *every* launch. Where that time goes was measured rather than
 * guessed, and the answer ruled out all the obvious fixes:
 *
 * | Experiment | Result |
 * |---|---|
 * | `inspect` (DEX translate + linkage analysis) across all 124 | **1.4s** — so translation is not the cost, and caching it buys nothing |
 * | Load all 124, unload all, load all again in the same JVM | 57.1s, then **2.4s** — so it is JVM class loading of the shared runtime, not plugin logic and not network |
 * | Load all 124 with 8 concurrent RPCs | 43.5s — a 1.4x saving, and **176 providers attributed to the wrong extension** (see `PluginHost.registrationLock`) |
 *
 * The second row is the important one. The cost is demand-driven loading of the
 * 56-jar runtime classpath — jsoup, ktor, jackson, coroutines — spread across
 * the plugins that first touch each part. It is paid once per JVM process and
 * cannot be made much cheaper; the third row says it cannot safely be made much
 * more parallel either.
 *
 * So the fix is not to make the load faster. It is to **stop doing it before
 * anyone has asked for anything**.
 *
 * ## What this changes
 *
 * Almost everything the app does with providers needs only their *descriptions*
 * — the search scope picker, the extensions tree, the enable/disable cascade,
 * `cs3ext://` addressing, provenance, the adult gate. None of that needs a live
 * JVM object; it needs a name, a language and a list of content types. Those
 * are a deterministic function of the archive, so they are written down here
 * after the first real load and read back instantly on every launch after.
 *
 * A plugin is then only loaded into the JVM when one of its providers is
 * actually *called*, which is a handful per search rather than all 124.
 *
 * ## Why the key is size + mtime rather than a content hash
 *
 * An archive only ever changes by being rewritten: `installPlugin` renames a
 * freshly downloaded temp file over the target, so the mtime moves on every
 * install and every update. Hashing 124 files would be about 6 MB of reads to
 * learn the same thing `stat` already answered — and this runs on the launch
 * path, which is the one thing this module exists to keep short.
 *
 * The runtime generation is part of the key for a different reason: the shim
 * and the bridge decide what a plugin *can* register, so a runtime upgrade can
 * legitimately change the answer for an archive whose bytes never moved. That
 * is the same argument `RuntimeProvisioner` makes for dropping translations
 * when the sidecar changes, and it fails the same way if skipped — a cached
 * claim outliving the thing that produced it.
 *
 * ## What a cached row is, and is not
 *
 * It is a claim that *this archive, under this runtime, registered these
 * providers last time it was loaded*. It is not a claim that loading will
 * succeed now: a site can change, an extension can start throwing in its own
 * `load()`. When activation later fails, the row is withdrawn and the failure
 * is reported through the existing `runtimeReports` path, so a provider that
 * has gone away is explained rather than merely missing —
 * `PluginManager.explainMissingProvider` already handles exactly this case for
 * bookmarks and cached sources that outlive their extension.
 */

/** A provider as the app addresses it, with no live JVM object behind it. */
export interface CachedProvider {
  name: string;
  mainUrl?: string;
  lang?: string;
  hasMainPage: boolean;
  hasQuickSearch: boolean;
  supportedTypes: string[];
}

interface RegistryEntry {
  internalName: string;
  /** `size:mtimeMs:generation` — see the note on why this is not a hash. */
  fingerprint: string;
  providers: CachedProvider[];
  recordedAt: number;
}

interface Persisted {
  version: 1;
  generation: number;
  entries: RegistryEntry[];
}

const WRITE_DEBOUNCE_MS = 1_000;

export class ProviderRegistryCache {
  private readonly entries = new Map<string, RegistryEntry>();
  private readonly generation: number;
  private readonly store: JsonFileStore<Persisted>;

  constructor(options: { file: string; generation: number }) {
    this.generation = options.generation;
    this.store = new JsonFileStore<Persisted>(options.file, WRITE_DEBOUNCE_MS, () => ({
      version: 1,
      generation: this.generation,
      entries: [...this.entries.values()],
    }));

    const loaded = this.store.load();
    /**
     * A whole-file generation check as well as a per-row one.
     *
     * The per-row fingerprint would catch this too, one row at a time. Dropping
     * the file outright on a runtime upgrade is cheaper and says the same
     * thing: nothing recorded under the previous runtime is trustworthy, and
     * keeping rows around to fail 124 individual comparisons is just a slower
     * way of arriving at an empty map.
     */
    if (loaded && loaded.generation === this.generation) {
      for (const entry of loaded.entries ?? []) {
        if (entry?.internalName && Array.isArray(entry.providers)) {
          this.entries.set(entry.internalName, entry);
        }
      }
    }
  }

  /**
   * What the archive at `filePath` registered last time, or `null`.
   *
   * `null` covers "never loaded", "the archive has changed" and "the runtime
   * has changed" — the response to all three is the same, a real load.
   */
  public read(internalName: string, filePath: string): CachedProvider[] | null {
    const entry = this.entries.get(internalName);
    if (!entry) return null;
    const fingerprint = this.fingerprint(filePath);
    if (!fingerprint || entry.fingerprint !== fingerprint) return null;
    return entry.providers;
  }

  /**
   * Records what a real load found.
   *
   * An archive that registers **nothing** is recorded too, and deliberately.
   * Plenty of installed archives are extractor-only bundles that register no
   * `MainAPI` at all, and treating an empty list as "no record" would make
   * every one of them pay the full JVM load on every launch, forever — the
   * exact cost this module exists to remove, concentrated on the plugins that
   * benefit from it least.
   */
  public write(internalName: string, filePath: string, providers: CachedProvider[]): void {
    const fingerprint = this.fingerprint(filePath);
    if (!fingerprint) return;
    this.entries.set(internalName, {
      internalName,
      fingerprint,
      providers,
      recordedAt: Date.now(),
    });
    this.store.schedule();
  }

  /**
   * Withdraws a row whose claim turned out to be wrong.
   *
   * Called when activation fails. Leaving it would advertise providers that
   * cannot answer, and — worse — would keep advertising them across restarts,
   * so the app would offer a permanently dead source with no memory of why.
   */
  public forget(internalName: string): void {
    if (this.entries.delete(internalName)) this.store.schedule();
  }

  /** Drops rows for archives that are no longer installed. */
  public prune(installed: Iterable<string>): void {
    const keep = new Set(installed);
    let changed = false;
    for (const name of [...this.entries.keys()]) {
      if (!keep.has(name)) {
        this.entries.delete(name);
        changed = true;
      }
    }
    if (changed) this.store.schedule();
  }

  public clear(): void {
    this.entries.clear();
    this.store.schedule();
  }

  public get size(): number {
    return this.entries.size;
  }

  public flush(): void {
    this.store.flush();
  }

  /**
   * `size:mtime:generation`, or `null` when the archive is not there.
   *
   * `null` rather than a thrown error: a missing archive is an ordinary state
   * with its own handling in `ensureProvidersLoaded` (`ARCHIVE_MISSING`), and
   * this is not the layer that should be reporting it.
   */
  private fingerprint(filePath: string): string | null {
    try {
      const stat = fs.statSync(filePath);
      return `${stat.size}:${Math.floor(stat.mtimeMs)}:${this.generation}`;
    } catch {
      return null;
    }
  }
}
