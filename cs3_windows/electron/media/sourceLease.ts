import { createHash } from 'crypto';
import type { Source } from '../../src/types/plugin.ts';
import { scopedLogger } from '../logging/logger.ts';

const log = scopedLogger('source-lease');

/**
 * PRD-40 / PRD-40.1 §4.1: Signed-URL lifecycle management.
 *
 * Provider URLs are ephemeral signed addresses that expire in 10-30 minutes.
 * A `SourceLease` represents the *logical* media source independently of the
 * momentary signed CDN address.
 *
 * Invariant INV-LEASE-1:
 * Reconnect (TCP reset/drop on same URL) and Refresh (re-resolving a fresh signed URL)
 * are strictly separate recovery paths with separate state transitions and budgets.
 */

export interface ResolvedSource {
  url: string;
  headers: Record<string, string>;
  cookies?: string;
  expiresAt?: number;
}

export interface SourceLeaseRetryPolicy {
  /** Maximum number of re-resolution attempts allowed per session. Default: 4. */
  maxRefreshes: number;
  /** Minimum interval in milliseconds between refreshes to prevent provider hammering. Default: 30_000. */
  minIntervalMs: number;
  /** Backoff algorithm when retrying consecutive refreshes. */
  backoff: 'fixed' | 'exponential';
}

export const DEFAULT_LEASE_RETRY_POLICY: SourceLeaseRetryPolicy = {
  maxRefreshes: 4,
  minIntervalMs: 30_000,
  backoff: 'fixed',
};

export type LeaseLifecycleState =
  | 'idle'
  | 'connected'
  | 'reconnecting'
  | 'refreshing'
  | 'exhausted'
  | 'disposed';

export interface SourceLeaseOptions {
  sourceId?: string;
  initialSource: Source | ResolvedSource;
  resolve?: () => Promise<ResolvedSource>;
  retryPolicy?: Partial<SourceLeaseRetryPolicy>;
}

/**
 * Generates a stable logical source identity from release metadata
 * so identity survives URL re-resolutions.
 */
export function generateStableSourceId(source: Source | ResolvedSource, fallbackProvider = 'unknown'): string {
  if ('provider' in source && source.provider && source.name) {
    const hash = createHash('sha256')
      .update(`${source.provider}:${source.name}:${source.quality ?? 0}`)
      .digest('hex')
      .slice(0, 16);
    return `${source.provider}-${hash}`;
  }
  const rawUrl = source.url || '';
  const urlWithoutQuery = rawUrl.split('?')[0] || rawUrl;
  const hash = createHash('sha256').update(urlWithoutQuery).digest('hex').slice(0, 16);
  return `${fallbackProvider}-${hash}`;
}

export class SourceLease {
  /** Stable logical source identity across all refreshes. */
  public readonly sourceId: string;

  private current: ResolvedSource;
  private resolveFn?: () => Promise<ResolvedSource>;
  private policy: SourceLeaseRetryPolicy;

  private state: LeaseLifecycleState = 'idle';
  private refreshAttempts = 0;
  private refreshSuccesses = 0;
  private reconnectAttempts = 0;
  private lastRefreshAt = 0;
  private hasStreamedSuccessfully = false;

  constructor(options: SourceLeaseOptions) {
    this.current = 'headers' in options.initialSource
      ? {
          url: options.initialSource.url,
          headers: options.initialSource.headers || {},
          cookies: 'cookies' in options.initialSource ? options.initialSource.cookies : undefined,
          expiresAt: options.initialSource.expiresAt,
        }
      : {
          url: (options.initialSource as Source).url || '',
          headers: (options.initialSource as Source).headers || {},
          expiresAt: (options.initialSource as Source).expiresAt,
        };

    this.sourceId = options.sourceId || generateStableSourceId(options.initialSource);
    this.resolveFn = options.resolve;
    this.policy = { ...DEFAULT_LEASE_RETRY_POLICY, ...options.retryPolicy };
  }

  public get url(): string {
    return this.current.url;
  }

  public get headers(): Record<string, string> {
    return this.current.headers;
  }

  public get cookies(): string | undefined {
    return this.current.cookies;
  }

  public get expiresAt(): number | undefined {
    return this.current.expiresAt;
  }

  public get refreshable(): boolean {
    return typeof this.resolveFn === 'function' && this.refreshAttempts < this.policy.maxRefreshes;
  }

  public get refreshBudgetRemaining(): number {
    return Math.max(0, this.policy.maxRefreshes - this.refreshAttempts);
  }

  public get lifecycleState(): LeaseLifecycleState {
    return this.state;
  }

  public get stats() {
    return {
      sourceId: this.sourceId,
      refreshAttempts: this.refreshAttempts,
      refreshSuccesses: this.refreshSuccesses,
      reconnectCount: this.reconnectAttempts,
      hasStreamedSuccessfully: this.hasStreamedSuccessfully,
      isExpired: this.isExpired(),
      refreshBudgetRemaining: this.refreshBudgetRemaining,
    };
  }

  /**
   * Marks that the current URL has delivered bytes successfully.
   * This is critical: a 403 on a source that NEVER streamed is a bad link or header mismatch,
   * while a 403 on a source that WAS streaming is a signed-token expiration pattern.
   */
  public markStreamSuccess(): void {
    this.hasStreamedSuccessfully = true;
    this.state = 'connected';
  }

  /**
   * Checks whether the current URL has passed its declared expiration deadline.
   */
  public isExpired(safetyMarginMs = 60_000): boolean {
    if (!this.current.expiresAt) return false;
    return Date.now() + safetyMarginMs >= this.current.expiresAt;
  }

  /**
   * Evaluates whether an HTTP error status warrants a source refresh.
   * Invariant: Refresh fires ONLY when token expiry is plausible, NEVER on blind 403s on first request.
   */
  public shouldTriggerRefresh(status: number): boolean {
    if (!this.refreshable) return false;
    if (this.isExpired()) return true;

    // A 401 or 403 on a stream that previously worked indicates token expiry.
    if ((status === 401 || status === 403) && this.hasStreamedSuccessfully) {
      return true;
    }

    return false;
  }

  /**
   * Records a transport connection reset/drop without changing the URL.
   * Invariant INV-LEASE-1: Reconnect does NOT consume refresh budget.
   */
  public recordReconnect(): void {
    this.reconnectAttempts++;
    this.state = 'reconnecting';
    log.info('lease_reconnect', {
      sourceId: this.sourceId,
      reconnectCount: this.reconnectAttempts,
      url: this.current.url,
    });
  }

  /**
   * Re-resolves a fresh signed URL from the provider.
   * Decrements refresh budget, enforces minIntervalMs, and updates current URL.
   */
  public async refreshSource(): Promise<ResolvedSource> {
    if (!this.resolveFn) {
      this.state = 'exhausted';
      throw new Error(`SourceLease [${this.sourceId}] is not refreshable (no resolver provided).`);
    }

    if (this.refreshAttempts >= this.policy.maxRefreshes) {
      this.state = 'exhausted';
      log.warn('lease_refresh_exhausted', {
        sourceId: this.sourceId,
        refreshAttempts: this.refreshAttempts,
        maxRefreshes: this.policy.maxRefreshes,
      });
      throw new Error(
        `SourceLease [${this.sourceId}] refresh budget exhausted (${this.refreshAttempts}/${this.policy.maxRefreshes}).`
      );
    }

    const now = Date.now();
    const elapsedSinceLast = now - this.lastRefreshAt;
    if (elapsedSinceLast < this.policy.minIntervalMs && this.lastRefreshAt > 0) {
      const waitMs = this.policy.minIntervalMs - elapsedSinceLast;
      log.info('lease_refresh_throttled', {
        sourceId: this.sourceId,
        waitingMs: waitMs,
      });
      await new Promise((r) => setTimeout(r, waitMs));
    }

    this.refreshAttempts++;
    this.lastRefreshAt = Date.now();
    this.state = 'refreshing';

    log.info('lease_refreshing_start', {
      sourceId: this.sourceId,
      attempt: this.refreshAttempts,
      max: this.policy.maxRefreshes,
    });

    try {
      const fresh = await this.resolveFn();
      if (!fresh || !fresh.url) {
        throw new Error('Resolver returned empty or invalid source');
      }

      this.current = {
        url: fresh.url,
        headers: fresh.headers || this.current.headers,
        cookies: fresh.cookies ?? this.current.cookies,
        expiresAt: fresh.expiresAt,
      };
      this.refreshSuccesses++;
      this.state = 'connected';

      log.info('lease_refresh_success', {
        sourceId: this.sourceId,
        attempt: this.refreshAttempts,
        newUrl: fresh.url,
        expiresAt: fresh.expiresAt,
      });

      return this.current;
    } catch (err) {
      if (this.refreshAttempts >= this.policy.maxRefreshes) {
        this.state = 'exhausted';
      }
      log.error('lease_refresh_failed', {
        sourceId: this.sourceId,
        attempt: this.refreshAttempts,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  public dispose(): void {
    this.state = 'disposed';
  }
}
