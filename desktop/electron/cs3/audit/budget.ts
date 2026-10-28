/**
 * How much the audit may read, and how hard it may lean on one host
 * (Provider Compatibility Audit PRD §6.5, §6.6, AC-5). Pure; time is passed
 * in, so the limiter is tested without waiting.
 *
 * The caps are hard: a flag may lower them or raise them to a stated number,
 * never to "unlimited", and a source that needs more is `inconclusive:
 * budget-exhausted`, not a failure and not a bigger read.
 */
const KB = 1024;
const MB = 1024 * KB;

export const BYTE_CAPS = {
  /** S7 body sniff, plus one tail read of the same size for an MP4. */
  sniff: 64 * KB,
  /** Manifest and the head of its first segment. */
  manifest: 128 * KB,
  /** First inspection read; escalated once when the probe was incomplete. */
  inspectFirst: 2 * MB,
  inspect: 16 * MB,
  verify: 32 * MB,
  provider: 48 * MB,
} as const;

export const VERIFY_WALL_MS = 12_000;

/**
 * Counts bytes as they arrive. `add` answers whether the transfer must stop
 * now; the caller destroys the request and the response (discarding the body
 * alone keeps the transfer going).
 */
export class ByteMeter {
  private total = 0;
  private readonly cap: number;

  constructor(cap: number) {
    if (!Number.isFinite(cap) || cap <= 0) throw new Error(`A byte cap must be a positive number, not ${cap}.`);
    this.cap = cap;
  }

  /** True once the cap is reached: stop reading. */
  add(bytes: number): boolean {
    this.total += Math.max(0, bytes);
    return this.total >= this.cap;
  }

  get bytes(): number {
    return this.total;
  }

  get exhausted(): boolean {
    return this.total >= this.cap;
  }

  get remaining(): number {
    return Math.max(0, this.cap - this.total);
  }
}

export interface HostPolicy {
  perHost: number;
  spacingMs: number;
  /** Escalating cooldowns after a rate limit or challenge; the last repeats. */
  cooldownsMs: number[];
}

export const DEFAULT_HOST_POLICY: HostPolicy = {
  perHost: 2,
  spacingMs: 400,
  cooldownsMs: [30_000, 120_000, 600_000],
};

export type HostGate =
  | { ok: true }
  | { ok: false; waitMs: number; reason: 'busy' | 'spacing' | 'cooldown' };

interface HostState {
  inFlight: number;
  lastStartAt: number;
  strikes: number;
  coolUntil: number;
}

/**
 * One host's share of the run. Every provider that resolves to the same host
 * shares it, so two extensions scraping one CDN are not twice as polite.
 */
export class HostLimiter {
  private readonly hosts = new Map<string, HostState>();
  private readonly policy: HostPolicy;

  constructor(policy: HostPolicy = DEFAULT_HOST_POLICY) {
    this.policy = policy;
  }

  private state(host: string): HostState {
    let state = this.hosts.get(host);
    if (!state) {
      state = { inFlight: 0, lastStartAt: Number.NEGATIVE_INFINITY, strikes: 0, coolUntil: 0 };
      this.hosts.set(host, state);
    }
    return state;
  }

  check(host: string, now: number): HostGate {
    const state = this.state(host);
    if (now < state.coolUntil) return { ok: false, waitMs: state.coolUntil - now, reason: 'cooldown' };
    if (state.inFlight >= this.policy.perHost) return { ok: false, waitMs: this.policy.spacingMs, reason: 'busy' };
    const since = now - state.lastStartAt;
    if (since < this.policy.spacingMs) return { ok: false, waitMs: this.policy.spacingMs - since, reason: 'spacing' };
    return { ok: true };
  }

  started(host: string, now: number): void {
    const state = this.state(host);
    state.inFlight++;
    state.lastStartAt = now;
  }

  /** `throttled`: the host answered 429 or a challenge. Any other answer resets the strikes. */
  finished(host: string, now: number, throttled = false): void {
    const state = this.state(host);
    state.inFlight = Math.max(0, state.inFlight - 1);
    if (throttled) {
      const steps = this.policy.cooldownsMs;
      state.coolUntil = now + steps[Math.min(state.strikes, steps.length - 1)];
      state.strikes++;
    } else {
      state.strikes = 0;
    }
  }

  coolingDown(host: string, now: number): boolean {
    return now < (this.hosts.get(host)?.coolUntil ?? 0);
  }
}
