import fs from 'fs';
import path from 'path';

/**
 * A JSON file kept in step with in-memory state, written on a delay.
 *
 * Five modules had grown their own copy of this — `diagnostics`,
 * `providerAnalytics`, `detailCache`, `discovery` and `inspectionStore` — and
 * each copy had to rediscover the same four things:
 *
 * **Writes are coalesced.** A search across thirty providers produces thirty
 * records in about a second. Writing the file thirty times would make the
 * diagnostics the slowest part of the failure they are describing.
 *
 * **The timer is unref'd.** A pending write must never be the reason the
 * process stays alive; on quit the caller flushes explicitly instead.
 *
 * **Failure is swallowed.** These are caches and debugging exhaust. Losing one
 * costs a refetch or some history, and a store that threw on a full disk would
 * take down the feature it exists to support — worst of all in `diagnostics`,
 * where the thing that reports problems failing loudly is absurd.
 *
 * **Reading a missing or corrupt file is not an error.** It is the first run,
 * or a file truncated by a crash. Both mean "start empty", which is what the
 * app does anyway.
 *
 * What is *not* here is the shape of the data. Each caller still decides what
 * it serialises and how it validates what comes back, because those are real
 * per-store decisions: `detailCache` drops entries past a TTL on load,
 * `providerAnalytics` reads a versioned envelope, `diagnostics` keeps a bare
 * array. Folding those together would trade five honest differences for one
 * misleading sameness.
 */
export class JsonFileStore<T> {
  private readonly file: string;
  private readonly debounceMs: number;
  private readonly serialise: () => T;
  private writeTimer: NodeJS.Timeout | null = null;

  /**
   * @param file        Absolute path. Its directory is created if absent.
   * @param debounceMs  How long to wait for the next change before writing.
   * @param serialise   Called at write time, not at schedule time — so a burst
   *                    of changes costs one snapshot, of the final state.
   */
  constructor(file: string, debounceMs: number, serialise: () => T) {
    this.file = file;
    this.debounceMs = debounceMs;
    this.serialise = serialise;
  }

  public get filePath(): string {
    return this.file;
  }

  /**
   * Reads the file, or answers `null` when there is nothing usable to read.
   *
   * `null` covers both "no file yet" and "the file is corrupt", deliberately:
   * the caller's response to each is the same — start empty — and a crash
   * during a write is a routine way to produce the second.
   */
  public load(): T | null {
    try {
      if (!fs.existsSync(this.file)) return null;
      return JSON.parse(fs.readFileSync(this.file, 'utf8')) as T;
    } catch {
      return null;
    }
  }

  /** Marks the state dirty. The write happens once, `debounceMs` from now. */
  public schedule(): void {
    if (this.writeTimer) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      this.writeNow();
    }, this.debounceMs);
    // Never hold the process open for a pending cache write.
    this.writeTimer.unref?.();
  }

  /**
   * Writes immediately, cancelling any pending write.
   *
   * Called on shutdown. Without it the last few seconds of a session are lost,
   * which is exactly the window that matters when the session ended badly.
   */
  public flush(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    this.writeNow();
  }

  private writeNow(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.serialise()), 'utf8');
    } catch {
      // See the class comment: these are caches and exhaust. A store that threw
      // here would take down the feature it exists to support.
    }
  }
}
