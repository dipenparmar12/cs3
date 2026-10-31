import { classifyFailure } from './failureTaxonomy.ts';

/**
 * Giving a struggling extension provider room (Content Validation PRD §10).
 *
 * A provider that rate-limits, blocks or keeps timing out was asked again on
 * every search, by up to eight lanes at once, which is how a temporary limit
 * becomes a long one. Two transient failures in a row start a cooldown that
 * escalates (1, 5, 15, then 60 minutes); any success resets it. While cooling,
 * automatic fan-outs (search, the widened walk) skip the provider; an explicit
 * ask (its own page, an exhaustive search) still reaches it, and nothing is
 * ever disabled. Per launch, in memory: a restart is a fresh start, and a
 * temporary limit is never stored as a verdict. Pure but for the clock.
 */

const STEPS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
const TRIGGER = 2;

/** Failures worth backing off from: the provider (or its host) said "not now". */
export function isTransientFailure(message: string | undefined): boolean {
  if (!message) return false;
  if (/\b429\b|too many requests|rate.?limit/i.test(message)) return true;
  const kind = classifyFailure(message);
  return kind === 'blocked' || kind === 'timeout' || kind === 'network' || kind === 'server-error';
}

interface Entry {
  streak: number;
  level: number;
  until: number;
  reason?: string;
}

export class ProviderCooldown {
  private entries = new Map<string, Entry>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** Records one call's outcome: `undefined` for success. */
  record(provider: string, error: string | undefined): void {
    if (!error) {
      this.entries.delete(provider);
      return;
    }
    if (!isTransientFailure(error)) return;
    const entry = this.entries.get(provider) ?? { streak: 0, level: -1, until: 0 };
    entry.streak += 1;
    entry.reason = error;
    if (entry.streak >= TRIGGER) {
      entry.level = Math.min(entry.level + 1, STEPS_MS.length - 1);
      entry.until = this.now() + STEPS_MS[entry.level];
      entry.streak = 0;
    }
    this.entries.set(provider, entry);
  }

  /** Milliseconds left on a provider's cooldown, 0 when it may be asked. */
  remaining(provider: string): number {
    const entry = this.entries.get(provider);
    return entry ? Math.max(0, entry.until - this.now()) : 0;
  }

  /** The names to ask now, in order, and those left out with how long they wait. */
  partition(names: string[]): { ask: string[]; cooling: Array<{ provider: string; ms: number; reason?: string }> } {
    const ask: string[] = [];
    const cooling: Array<{ provider: string; ms: number; reason?: string }> = [];
    for (const name of names) {
      const ms = this.remaining(name);
      if (ms > 0) cooling.push({ provider: name, ms, reason: this.entries.get(name)?.reason });
      else ask.push(name);
    }
    return { ask, cooling };
  }
}
