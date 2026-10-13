/**
 * Lets several callers share one expensive run.
 *
 * Source discovery asks a dozen community sites for the same thing, so two
 * callers wanting the same title must not each start one. That is not a
 * micro-optimisation here — it is what makes background prefetching viable at
 * all. Warming the cache while a detail page is read only helps if pressing
 * Play a second later *joins* that work; otherwise the "optimisation" doubles
 * the load on every site involved and the viewer waits exactly as long.
 *
 * Extracted from `ContentService` rather than inlined there for two reasons:
 * the abort refcounting is the subtlest code in the source path and deserves to
 * be read on its own, and it is the one part that can be tested without an
 * Electron app around it.
 *
 * ## The two rules that matter
 *
 * **Cancellation is by consensus.** Each caller brings its own `AbortSignal`,
 * and the underlying work is cancelled only once *every* caller has withdrawn.
 * Aborting on the first would mean a detail page closing could cancel the
 * discovery the player — which joined it a moment earlier — is waiting on.
 *
 * **A late joiner is caught up immediately.** The most recent progress is
 * retained and replayed on join, so a caller that attaches halfway through sees
 * the sources found so far instead of an empty list until the next site
 * answers.
 */

export interface SharedRunHandle<TProgress> {
  /** Fires on every progress event from the moment of joining, plus a replay. */
  onProgress?: (progress: TProgress) => void;
  signal?: AbortSignal;
}

interface Subscriber<TProgress> {
  onProgress?: (progress: TProgress) => void;
}

interface Run<TResult, TProgress> {
  promise: Promise<TResult>;
  controller: AbortController;
  subscribers: Set<Subscriber<TProgress>>;
  lastProgress: TProgress | null;
  /** Caller-defined tag used to decide whether a new request may join. */
  tag: string;
}

export class SharedDiscovery<TResult, TProgress> {
  private runs = new Map<string, Run<TResult, TProgress>>();

  /**
   * Joins the run for `key` when one is compatible, else starts a new one.
   *
   * `canJoin` decides compatibility. It exists because not every caller may
   * share: a refresh that must bypass the cache cannot be served by a run that
   * may have answered from it.
   */
  public run(
    key: string,
    tag: string,
    canJoin: (existingTag: string) => boolean,
    start: (
      emit: (progress: TProgress) => void,
      signal: AbortSignal
    ) => Promise<TResult>,
    handle: SharedRunHandle<TProgress> = {}
  ): Promise<TResult> {
    const existing = this.runs.get(key);

    /*
     * An already-aborted run is never joined, however recent. It stays in the
     * map until its promise settles, and joining it would hand the caller a
     * cancelled result — precisely the race where a page unmounts a moment
     * after Play was pressed, dropping the last subscriber and cancelling the
     * run the player was about to attach to.
     */
    if (existing && !existing.controller.signal.aborted && canJoin(existing.tag)) {
      return this.join(existing, handle);
    }

    const controller = new AbortController();
    const run: Run<TResult, TProgress> = {
      controller,
      tag,
      subscribers: new Set(),
      lastProgress: null,
      promise: undefined as unknown as Promise<TResult>,
    };

    run.promise = start((progress) => {
      run.lastProgress = progress;
      // Copied before iterating: a subscriber may withdraw while being told.
      for (const subscriber of [...run.subscribers]) {
        try {
          subscriber.onProgress?.(progress);
        } catch {
          // One subscriber throwing must not stop the others being told.
        }
      }
    }, controller.signal).finally(() => {
      // Identity, not key: a superseded run must not evict its replacement.
      if (this.runs.get(key) === run) this.runs.delete(key);
    });

    this.runs.set(key, run);
    return this.join(run, handle);
  }

  private join(
    run: Run<TResult, TProgress>,
    handle: SharedRunHandle<TProgress>
  ): Promise<TResult> {
    // A caller that has already given up neither subscribes nor cancels: it
    // takes whatever the run produces, which its own `aborted` check discards.
    if (handle.signal?.aborted) return run.promise;

    const subscriber: Subscriber<TProgress> = { onProgress: handle.onProgress };
    run.subscribers.add(subscriber);

    let detach = (): void => {};
    if (handle.signal) {
      const signal = handle.signal;
      const onAbort = () => {
        run.subscribers.delete(subscriber);
        if (run.subscribers.size === 0) run.controller.abort();
      };
      signal.addEventListener('abort', onAbort, { once: true });
      detach = () => signal.removeEventListener('abort', onAbort);
    }

    if (run.lastProgress !== null && handle.onProgress) {
      try {
        handle.onProgress(run.lastProgress);
      } catch {
        // As above.
      }
    }

    return run.promise.finally(() => {
      run.subscribers.delete(subscriber);
      detach();
    });
  }

  /** How many runs are in flight. For diagnostics and tests. */
  public get size(): number {
    return this.runs.size;
  }

  public has(key: string): boolean {
    const run = this.runs.get(key);
    return Boolean(run && !run.controller.signal.aborted);
  }
}
