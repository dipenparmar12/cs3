import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SearchSession, type SearchSnapshot } from '../searchSession.ts';
import type { SearchResponse } from '../../src/types/api.ts';

function createMockDeps(delayMs = 40) {
  const notifications: SearchSnapshot[] = [];
  const resultsReceived: SearchResponse[][] = [];

  const deps = {
    plugins: {
      listEnabledProviders: async () => ['Provider1', 'Provider2', 'Provider3'],
      searchEach: async (
        _query: string,
        extensions: string[],
        onOutcome: (outcome: { provider: string; results: SearchResponse[]; latencyMs: number; error?: string }) => void,
        signal?: AbortSignal
      ) => {
        for (const provider of extensions) {
          if (signal?.aborted) break;
          if (delayMs > 0) {
            await new Promise((r) => setTimeout(r, delayMs));
          }
          if (signal?.aborted) break;
          onOutcome({
            provider,
            results: [
              {
                name: `Result from ${provider}`,
                url: `https://example.com/${provider}`,
                apiName: provider,
              },
            ],
            latencyMs: 10,
          });
        }
      },
    } as any,
    registry: {
      search: async () => [],
      getConfigs: () => [],
      getEnabledIndexers: () => [],
    } as any,
    cinemeta: {
      search: async () => [],
    } as any,
    metadata: {
      search: async () => [],
    } as any,
    scope: {
      resolveProviders: () => ({ kind: 'all', providers: new Set() }),
      resolveIndexers: () => ({ kind: 'all', indexers: new Set() }),
      report: () => ({ active: false, missingProviders: [], missingIndexers: [] }),
    } as any,
    natives: {
      enabledProviderNames: () => [],
      search: async () => [],
    } as any,
    notify: (snapshot: SearchSnapshot) => {
      notifications.push(snapshot);
    },
    onResults: (results: SearchResponse[]) => {
      resultsReceived.push(results);
    },
  };

  return { deps, notifications, resultsReceived };
}

test('SearchSession emits plan immediately and flushes terminal snapshot when finished', async () => {
  const { deps, notifications } = createMockDeps(30);
  const session = new SearchSession('test-1', 'dune', {}, deps);

  const initial = session.begin();
  assert.equal(initial.id, 'test-1');
  assert.equal(initial.query, 'dune');
  assert.equal(initial.done, false);

  // Wait for session to finish
  await new Promise<void>((resolve) => {
    const check = setInterval(() => {
      if (session.isFinished) {
        clearInterval(check);
        resolve();
      }
    }, 20);
  });

  assert.ok(notifications.length >= 2, 'Should emit at least initial plan and completion');
  const first = notifications[0];
  assert.equal(first.id, 'test-1');
  assert.equal(first.total, 5, 'Plan should contain 3 providers + 2 catalogues');

  const last = notifications[notifications.length - 1];
  assert.equal(last.done, true);
  assert.equal(last.settled, 5);
  assert.equal(last.results.length, 3);
});

test('SearchSession flushes immediately on cancel without waiting for timer', async () => {
  const { deps, notifications } = createMockDeps(100);
  const session = new SearchSession('test-cancel', 'avatar', {}, deps);

  const initial = session.begin();
  assert.equal(initial.done, false);

  // Cancel while in flight
  const cancelledSnapshot = session.cancel();
  assert.equal(cancelledSnapshot.cancelled, true);
  assert.equal(cancelledSnapshot.done, true);

  const last = notifications[notifications.length - 1];
  assert.equal(last.cancelled, true);
  assert.equal(last.done, true);
});
