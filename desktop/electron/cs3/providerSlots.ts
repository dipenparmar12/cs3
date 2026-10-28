/**
 * How many requests one provider may have in flight (Content Validation PRD
 * §10.1: per-provider concurrency, no bursts from background work).
 *
 * The global caps (8 searches at once, the JVM's two lanes) say nothing about
 * one host: a streaming-service page asked one provider for 18 catalogue rows
 * at once, and a burst like that is what earns the rate limit the next search
 * then runs into. Background work (search, catalogue rows, prefetched links)
 * waits for a slot, first come first served. Urgent work (a page being opened,
 * a Play press) takes a slot at once even over the limit, so a viewer's press
 * never queues behind the app's own traffic; it still counts, so background
 * work waits until it is done. Pure apart from the promises.
 */
export const DEFAULT_PROVIDER_SLOTS = 4;

export class ProviderSlots {
  private readonly active = new Map<string, number>();
  private readonly waiting = new Map<string, Array<() => void>>();
  private readonly limit: number;

  constructor(limit = DEFAULT_PROVIDER_SLOTS) {
    this.limit = limit;
  }

  async run<T>(provider: string, work: () => Promise<T>, options: { urgent?: boolean } = {}): Promise<T> {
    if (options.urgent || this.inFlight(provider) < this.limit) {
      this.active.set(provider, this.inFlight(provider) + 1);
    } else {
      // Resolved by `release`, which has already counted this caller in.
      await new Promise<void>((granted) => {
        const queue = this.waiting.get(provider) ?? [];
        queue.push(granted);
        this.waiting.set(provider, queue);
      });
    }
    try {
      return await work();
    } finally {
      this.release(provider);
    }
  }

  inFlight(provider: string): number {
    return this.active.get(provider) ?? 0;
  }

  queued(provider: string): number {
    return this.waiting.get(provider)?.length ?? 0;
  }

  private release(provider: string): void {
    let count = this.inFlight(provider) - 1;
    const queue = this.waiting.get(provider);
    while (queue?.length && count < this.limit) {
      count++;
      queue.shift()!();
    }
    if (!queue?.length) this.waiting.delete(provider);
    if (count > 0) this.active.set(provider, count);
    else this.active.delete(provider);
  }
}
