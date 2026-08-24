/**
 * PRD-40.1 §4.1 & §7: SourceLease unit tests.
 *
 *   node --experimental-strip-types electron/media/sourceLease.test.mts
 */
import assert from 'node:assert/strict';
import {
  SourceLease,
  generateStableSourceId,
} from './sourceLease.ts';

const tests: Array<[string, () => void | Promise<void>]> = [];
const test = (name: string, fn: () => void | Promise<void>) => tests.push([name, fn]);

test('generates stable sourceId across URL token changes', () => {
  const initial = {
    provider: 'SuperStream',
    name: 'Movie.2024.1080p.WEB-DL',
    quality: 1080,
    url: 'https://cdn.example.com/stream?token=abc1234',
  };
  const id1 = generateStableSourceId(initial);

  const refreshed = {
    provider: 'SuperStream',
    name: 'Movie.2024.1080p.WEB-DL',
    quality: 1080,
    url: 'https://cdn.example.com/stream?token=xyz9876_different_token',
  };
  const id2 = generateStableSourceId(refreshed);

  assert.equal(id1, id2, 'stable sourceId must survive signed URL token rotation');
  assert.match(id1, /^SuperStream-[a-f0-9]{16}$/);
});

test('detects expiration correctly against safety margin', () => {
  const now = Date.now();
  const leaseExpired = new SourceLease({
    initialSource: {
      url: 'https://cdn.test/video.mp4',
      headers: { Referer: 'https://test.com' },
      expiresAt: now + 30_000, // 30s in future (< 60s default safety margin)
    },
  });

  assert.equal(leaseExpired.isExpired(), true, 'token expiring in 30s should be marked expired with 60s safety margin');

  const leaseValid = new SourceLease({
    initialSource: {
      url: 'https://cdn.test/video.mp4',
      headers: {},
      expiresAt: now + 600_000, // 10 min in future
    },
  });
  assert.equal(leaseValid.isExpired(), false, 'token expiring in 10m is not expired');
});

test('INV-LEASE-1: distinguishes connection reconnect from lease refresh', async () => {
  let resolveCallCount = 0;
  const lease = new SourceLease({
    initialSource: {
      url: 'https://cdn.test/token-1',
      headers: {},
    },
    resolve: async () => {
      resolveCallCount++;
      return {
        url: `https://cdn.test/token-${resolveCallCount + 1}`,
        headers: { 'X-Auth': 'new-token' },
      };
    },
  });

  assert.equal(lease.stats.reconnectCount, 0);
  assert.equal(lease.stats.refreshAttempts, 0);

  // Connection drop (TCP reset)
  lease.recordReconnect();
  lease.recordReconnect();
  assert.equal(lease.stats.reconnectCount, 2);
  assert.equal(lease.stats.refreshAttempts, 0, 'reconnects must not consume refresh budget');

  // Lease token refresh
  const fresh = await lease.refreshSource();
  assert.equal(fresh.url, 'https://cdn.test/token-2');
  assert.equal(lease.stats.refreshAttempts, 1);
  assert.equal(lease.stats.refreshSuccesses, 1);
  assert.equal(lease.stats.reconnectCount, 2, 'reconnect count preserved');
});

test('shouldTriggerRefresh rules: does not refresh on blind first-request 403', () => {
  const lease = new SourceLease({
    initialSource: { url: 'https://cdn.test/stream.mp4', headers: {} },
    resolve: async () => ({ url: 'https://cdn.test/fresh.mp4', headers: {} }),
  });

  // Never streamed, gets 403 on first request -> likely bad link, DO NOT refresh
  assert.equal(
    lease.shouldTriggerRefresh(403),
    false,
    'must not trigger blind refresh on first request 403'
  );

  // Now mark that bytes were delivered successfully
  lease.markStreamSuccess();

  // After streaming, getting 403 -> token expired!
  assert.equal(
    lease.shouldTriggerRefresh(403),
    true,
    'must trigger refresh on 403 after stream was active'
  );
  assert.equal(
    lease.shouldTriggerRefresh(404),
    false,
    'must not trigger refresh on 404'
  );
});

test('enforces bounded refresh budget and throttles rapid refreshes', async () => {
  let callCount = 0;
  const lease = new SourceLease({
    initialSource: { url: 'https://cdn.test/stream', headers: {} },
    resolve: async () => {
      callCount++;
      return { url: `https://cdn.test/stream-${callCount}`, headers: {} };
    },
    retryPolicy: {
      maxRefreshes: 2,
      minIntervalMs: 50,
      backoff: 'fixed',
    },
  });

  assert.equal(lease.refreshBudgetRemaining, 2);

  const r1 = await lease.refreshSource();
  assert.equal(r1.url, 'https://cdn.test/stream-1');
  assert.equal(lease.refreshBudgetRemaining, 1);

  const r2 = await lease.refreshSource();
  assert.equal(r2.url, 'https://cdn.test/stream-2');
  assert.equal(lease.refreshBudgetRemaining, 0);
  assert.equal(lease.refreshable, false);

  // Attempt #3 must throw budget exhaustion error
  await assert.rejects(
    async () => lease.refreshSource(),
    /refresh budget exhausted/i,
    'exceeding budget must reject'
  );
  assert.equal(lease.lifecycleState, 'exhausted');
});

// --- execution -------------------------------------------------------------

let passed = 0;
let failed = 0;

for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
    passed++;
  } catch (error) {
    console.error(`  FAIL ${name}`);
    console.error(error);
    failed++;
  }
}

console.log(`\n${passed} passed${failed > 0 ? `, ${failed} failed` : ''}`);
if (failed > 0) process.exit(1);
