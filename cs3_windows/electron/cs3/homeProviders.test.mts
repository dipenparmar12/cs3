/**
 * Home-provider health, and what "healthy" is allowed to mean.
 *
 *   node --experimental-strip-types electron/cs3/homeProviders.test.mts
 *
 * This gates a refusal the user sees: a provider judged unhealthy cannot be
 * selected. Both directions of getting it wrong are bad in ways that look like
 * *our* bug rather than the service's.
 *
 * Too lenient and someone selects a catalogue that answers 200 with nothing
 * usable, then stares at an empty home screen with no explanation — which is
 * the exact failure the check exists to prevent, now with a control that
 * pretended to check.
 *
 * Too strict and a service that works fine is unselectable, with a message
 * blaming it for something that is not wrong.
 */
import assert from 'node:assert/strict';
import { TvType, type SearchResponse } from '../../src/types/api.ts';
import {
  checkProvider,
  isSelectable,
  type HomeCatalogRequest,
  type HomeProvider,
  type HomeProviderCapabilities,
} from './homeProviders.ts';

const tests: Array<[string, () => Promise<void> | void]> = [];
const test = (name: string, fn: () => Promise<void> | void) => tests.push([name, fn]);

function item(overrides: Partial<SearchResponse> = {}): SearchResponse {
  return {
    name: 'Dune',
    url: 'cs3meta://cinemeta/movie/tt1160419',
    apiName: 'Catalogue',
    type: TvType.Movie,
    posterUrl: 'https://images.example/dune.jpg',
    ...overrides,
  } as SearchResponse;
}

/** A provider whose answer the test dictates completely. */
function fake(options: {
  items?: SearchResponse[];
  throws?: Error;
  delayMs?: number;
  catalogs?: HomeProviderCapabilities['catalogs'];
  requiresKey?: boolean;
}): HomeProvider {
  return {
    id: 'fake',
    name: 'Fake catalogue',
    description: '',
    requiresKey: options.requiresKey,
    capabilities: () => ({
      catalogs: options.catalogs ?? ['popular-movies'],
      genres: [],
      paging: true,
    }),
    async fetch(_request: HomeCatalogRequest) {
      if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      if (options.throws) throw options.throws;
      return options.items ?? [];
    },
  };
}

// --- healthy ----------------------------------------------------------------

test('a catalogue returning real, illustrated items is healthy', async () => {
  const health = await checkProvider(fake({ items: Array.from({ length: 20 }, () => item()) }));
  assert.equal(health.status, 'healthy');
  assert.equal(health.items, 20);
  assert.equal(health.withArtwork, 20);
  assert.equal(isSelectable(health), true);
});

// --- the failures that answer 200 -------------------------------------------

test('an empty catalogue is unavailable, not healthy', async () => {
  /**
   * The failure the whole check exists for. A 200 with no `metas` is what a
   * catalogue API does when it is half-broken, and treating "it answered" as
   * "it works" is what puts an empty home screen in front of someone with no
   * explanation.
   */
  const health = await checkProvider(fake({ items: [] }));
  assert.equal(health.status, 'unavailable');
  assert.equal(isSelectable(health), false);
  assert.match(health.reason ?? '', /only 0 usable items/i);
});

test('a handful of items is not enough to call a catalogue working', async () => {
  const health = await checkProvider(fake({ items: [item(), item()] }));
  assert.equal(health.status, 'unavailable');
  assert.equal(isSelectable(health), false);
});

test('a catalogue of blank cards is degraded, and says why', async () => {
  /**
   * Artwork is a completeness test, not a cosmetic one: a home screen is a
   * browsing surface, and one made of unposted rectangles is unusable for the
   * only thing it is for.
   */
  const items = Array.from({ length: 20 }, (_, index) =>
    item({ posterUrl: index < 4 ? 'https://images.example/x.jpg' : undefined })
  );
  const health = await checkProvider(fake({ items }));
  assert.equal(health.status, 'degraded');
  assert.match(health.reason ?? '', /4 of 20 items have artwork/);
});

test('degraded is still selectable — it works, it is just not good', async () => {
  // Refusing a slow-but-working catalogue would be the check overreaching:
  // the user can see the latency and decide for themselves.
  const items = Array.from({ length: 20 }, (_, index) =>
    item({ posterUrl: index < 8 ? 'https://images.example/x.jpg' : undefined })
  );
  const health = await checkProvider(fake({ items }));
  assert.equal(health.status, 'degraded');
  assert.equal(isSelectable(health), true);
});

// --- outright failures ------------------------------------------------------

test('an unreachable host gets a reason a person can act on', async () => {
  /**
   * Node says `fetch failed` for DNS failures, refused connections and TLS
   * errors alike, which in a settings panel is useless — it cannot distinguish
   * a typo in an addon URL from a service being down.
   */
  const health = await checkProvider(fake({ throws: new Error('fetch failed') }));
  assert.equal(health.status, 'unavailable');
  assert.match(health.reason ?? '', /could not be reached/i);
  assert.doesNotMatch(health.reason ?? '', /fetch failed/);
});

test('a missing API key is reported as that, not as a network failure', async () => {
  // Otherwise the fix — paste a key — is nowhere in the message describing the
  // problem, and the field that needs filling is the one thing not mentioned.
  const health = await checkProvider(
    fake({ requiresKey: true, throws: new Error('No TMDB API key has been set.') })
  );
  assert.equal(health.needsKey, true);
  assert.match(health.reason ?? '', /needs an API key/i);
  assert.equal(isSelectable(health), false);
});

test('a provider publishing no catalogues cannot be healthy', async () => {
  const health = await checkProvider(fake({ catalogs: [] }));
  assert.equal(health.status, 'unavailable');
  assert.match(health.reason ?? '', /publishes no catalogues/i);
});

test('an unchecked provider is not selectable', () => {
  // The default before any probe has run. Treating unknown as usable would let
  // the very first click select something nobody has tested.
  assert.equal(isSelectable(undefined), false);
  assert.equal(
    isSelectable({ id: 'x', name: 'x', status: 'unchecked', checkedAt: Date.now() }),
    false
  );
});

// --- runner -----------------------------------------------------------------

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL ${name}`);
    console.log(`       ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(failed === 0 ? `\n${tests.length} passed` : `\n${failed} of ${tests.length} FAILED`);
process.exit(failed === 0 ? 0 : 1);
