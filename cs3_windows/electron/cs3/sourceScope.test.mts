/**
 * Who gets asked when the viewer presses play.
 *
 *   bun run test:scope
 *   node --experimental-strip-types electron/cs3/sourceScope.test.mts
 *
 * These rows are pinned because every wrong answer still plays something. The
 * app does not break when this regresses — it quietly contacts two hundred
 * third-party sites instead of two, and the report six months later is "it got
 * slow again", with nothing pointing here.
 */
import assert from 'node:assert/strict';
import { planSourceScope, shouldEscalateScope } from './sourceScope.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

const ROUTES = ['cs3ext://Cinefreak/abc', 'cs3ext://Movies4u/def'];

// --- the Android default ---------------------------------------------------

test('a searched title asks only the providers that returned it', () => {
  // The whole point. On Android a provider row plays from that provider; here
  // the merged row's alternates are the same set.
  const plan = planSourceScope({ routes: ROUTES, hasTitle: true, providersNarrowedToNothing: false });
  assert.equal(plan.scopeUsed, 'origin');
  assert.equal(plan.searchAllProviders, false);
});

test('no indexer is asked at origin scope', () => {
  // Android has no equivalent step at all, and it is most of the latency: an
  // indexer answering in 20s delays a link the provider returned in one.
  const plan = planSourceScope({ routes: ROUTES, hasTitle: true, providersNarrowedToNothing: false });
  assert.equal(plan.askIndexers, false);
});

test('origin is the default when no scope is named', () => {
  const plan = planSourceScope({ routes: ROUTES, hasTitle: true, providersNarrowedToNothing: false });
  assert.equal(plan.scopeUsed, 'origin');
  assert.equal(plan.canWiden, true);
});

// --- the one case origin cannot be honoured --------------------------------

test('a home-screen title has no origin, so it widens rather than finding nothing', () => {
  // Nothing was ever searched for, so no provider claimed it. Narrowing to an
  // empty set here would return zero sources for every catalogue item.
  const plan = planSourceScope({ routes: [], hasTitle: true, providersNarrowedToNothing: false });
  assert.equal(plan.scopeUsed, 'all');
  assert.equal(plan.askIndexers, true);
  assert.equal(plan.searchAllProviders, true);
});

test('and it reports that it widened, so nothing offers to widen again', () => {
  // `canWiden` false is what stops the UI showing "search everywhere" beside a
  // search that already did.
  const plan = planSourceScope({ routes: [], hasTitle: true, providersNarrowedToNothing: false });
  assert.equal(plan.canWiden, false);
});

// --- widening --------------------------------------------------------------

test('widening asks every provider, including ones that had no route', () => {
  // The condition that is easy to get wrong. Skipping the search whenever
  // routes exist makes "search everywhere" ask the same two providers again
  // and appear to do nothing.
  const plan = planSourceScope({
    requested: 'all',
    routes: ROUTES,
    hasTitle: true,
    providersNarrowedToNothing: false,
  });
  assert.equal(plan.scopeUsed, 'all');
  assert.equal(plan.searchAllProviders, true);
  assert.equal(plan.askIndexers, true);
});

test('widening twice is not offered', () => {
  const plan = planSourceScope({
    requested: 'all',
    routes: ROUTES,
    hasTitle: true,
    providersNarrowedToNothing: false,
  });
  assert.equal(plan.canWiden, false);
});

// --- degenerate inputs -----------------------------------------------------

test('a title that could not be determined is not searched for', () => {
  // There is nothing to put in the query; a fan-out would ask two hundred
  // providers about an empty string.
  const plan = planSourceScope({ requested: 'all', routes: [], hasTitle: false, providersNarrowedToNothing: false });
  assert.equal(plan.searchAllProviders, false);
});

test('a user narrowing to nothing is honoured rather than widened around', () => {
  // The search-scope selection is a strict filter, not a preference — the same
  // rule `searchScope.ts` enforces. Widening past it would query the sources
  // the user just excluded.
  const plan = planSourceScope({ requested: 'all', routes: [], hasTitle: true, providersNarrowedToNothing: true });
  assert.equal(plan.searchAllProviders, false);
});

// --- escalating an empty scoped answer -------------------------------------

const ESCALATE = {
  scopeUsed: 'origin' as const,
  sourceCount: 0,
  canWiden: true,
  allowed: true,
  hasTitle: true,
};

test('a provider with nothing widens itself rather than reporting a dead end', () => {
  // The reported case: HDO had no links for The Little Prince, and pressing the
  // button under that message found 137 sources across five other extensions.
  assert.equal(shouldEscalateScope(ESCALATE), true);
});

test('a scoped answer that found something is left alone', () => {
  // The narrow scope is paying for itself here: fewer sites contacted, faster,
  // and no dead links from providers that never carried the title.
  assert.equal(shouldEscalateScope({ ...ESCALATE, sourceCount: 1 }), false);
});

test('a widened answer never widens again', () => {
  assert.equal(
    shouldEscalateScope({ ...ESCALATE, scopeUsed: 'all', canWiden: false }),
    false
  );
});

test('and the scope guard holds on its own, with canWiden lying', () => {
  /*
   * Deliberately a state that cannot occur: `planSourceScope` never reports
   * `canWiden` at `all` scope. It is asserted anyway because this is the guard
   * standing between a bug in that pairing and unbounded recursion across the
   * whole provider corpus — and a test that only ever exercises it alongside
   * `canWiden: false` pins nothing. Verified by mutation: removing the
   * `scopeUsed` clause fails this row and nothing else.
   */
  assert.equal(shouldEscalateScope({ ...ESCALATE, scopeUsed: 'all' }), false);
});

test('a home-screen title that already looked everywhere does not widen', () => {
  // `planSourceScope` widened it on its own; there is nothing left to ask.
  assert.equal(shouldEscalateScope({ ...ESCALATE, canWiden: false }), false);
});

test('speculative callers do not widen', () => {
  // The prefetcher runs on a page that has merely been opened. A fan-out there
  // is the fastest way to get an IP blocked by a scraper target.
  assert.equal(shouldEscalateScope({ ...ESCALATE, allowed: false }), false);
});

test('a title that could not be determined does not widen', () => {
  // Same rule the fan-out enforces: there is nothing to search for.
  assert.equal(shouldEscalateScope({ ...ESCALATE, hasTitle: false }), false);
});

test('the escalation target is a plan that asks everything', () => {
  // The pair, checked together: escalation says "widen", and the plan it
  // produces is the one that actually reaches the providers with no route.
  assert.equal(shouldEscalateScope(ESCALATE), true);
  const widened = planSourceScope({
    requested: 'all',
    routes: ROUTES,
    hasTitle: true,
    providersNarrowedToNothing: false,
  });
  assert.equal(widened.searchAllProviders, true);
  assert.equal(widened.askIndexers, true);
  assert.equal(widened.canWiden, false);
});

// --- runner ----------------------------------------------------------------

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL ${name}`);
    console.log(`       ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(failed === 0 ? `\n${tests.length} passed` : `\n${failed} of ${tests.length} FAILED`);
process.exit(failed === 0 ? 0 : 1);
