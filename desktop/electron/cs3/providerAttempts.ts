import { isPrivateSession } from './privacyMode.ts';
import type { ProviderAttemptOutcome } from '../../src/types/interactions.ts';

/**
 * What each provider answered the last time a work was looked for through it
 * (Playback Source Resolution, Phase 2, PRD §7.6–7.7).
 *
 * Keyed on the work (`canonicalKey`) and the provider, never on a title string
 * alone. Personal data: it says what this viewer looked for, so the key is in
 * `profiles/profileKeys.ts` (per profile), writes are refused in a private
 * session, it is bounded and expiring, and Settings' "Viewed titles and
 * results" erases it. A `wrong-match` describes one provider's candidate, not
 * the work: it is never a title outcome and never hides a card.
 */

export type { ProviderAttemptOutcome };

export interface ProviderAttempt {
  work: string;
  provider: string;
  outcome: ProviderAttemptOutcome;
  at: number;
  /** The provider's own words, or why its hit was refused. */
  detail?: string;
}

const KEY = 'cs3_provider_attempts';
const MAX_ENTRIES = 1000;

/**
 * How long each answer is believed (PRD §7.7). Found links have their own
 * deadlines in the source cache; this only says the provider had the work. An
 * empty answer is believed for less time than that, a failure for minutes, and
 * a wrong match longest, because it is evidence about the provider's search.
 */
const TTL_MS: Record<ProviderAttemptOutcome, number> = {
  sources: 6 * 60 * 60 * 1000,
  'no-sources': 24 * 60 * 60 * 1000,
  'wrong-match': 7 * 24 * 60 * 60 * 1000,
  error: 10 * 60 * 1000,
};

interface Backing {
  getObject<T>(key: string, fallback: T): T | null;
  setObject(key: string, value: unknown): void;
}

export class ProviderAttemptStore {
  private readonly backing: Backing;
  private readonly now: () => number;

  constructor(backing: Backing, now: () => number = Date.now) {
    this.backing = backing;
    this.now = now;
  }

  private live(): ProviderAttempt[] {
    const stored = this.backing.getObject<ProviderAttempt[]>(KEY, []);
    const now = this.now();
    return Array.isArray(stored) ? stored.filter((a) => a && now - a.at < (TTL_MS[a.outcome] ?? 0)) : [];
  }

  /** The newest answer per work and provider replaces the older one. */
  public record(attempts: Array<Omit<ProviderAttempt, 'at'>>): void {
    if (attempts.length === 0 || isPrivateSession()) return;
    const at = this.now();
    const fresh = attempts.map((attempt) => ({ ...attempt, at }));
    const replaced = new Set(fresh.map((a) => `${a.work}\u0000${a.provider}`));
    const kept = this.live().filter((a) => !replaced.has(`${a.work}\u0000${a.provider}`));
    this.backing.setObject(KEY, [...fresh, ...kept].slice(0, MAX_ENTRIES));
  }

  /**
   * One read for a whole screen of cards: the stored list is parsed once here,
   * never once per card (§12, "Nothing asked once per card may parse").
   */
  public lookup(): (work: string, provider: string | undefined) => ProviderAttempt | undefined {
    const index = new Map(this.live().map((a) => [`${a.work}\u0000${a.provider}`, a]));
    return (work, provider) => (provider ? index.get(`${work}\u0000${provider}`) : undefined);
  }

  /**
   * Drops one provider's answer for one work, so the card stops saying what it
   * said and the next look asks it fresh (the card's "Ask again", PRD §7.6).
   */
  public forget(work: string, provider: string): boolean {
    const stored = this.live();
    const kept = stored.filter((a) => !(a.work === work && a.provider === provider));
    if (kept.length === stored.length) return false;
    this.backing.setObject(KEY, kept);
    return true;
  }

  public count(): number {
    return this.live().length;
  }

  public clear(): void {
    this.backing.setObject(KEY, []);
  }
}
