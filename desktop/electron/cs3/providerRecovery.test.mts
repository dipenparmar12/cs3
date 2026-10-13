import { test } from 'node:test';
import assert from 'node:assert/strict';

import { planRecovery, isActionable, type RecoveryContext } from './providerRecovery.ts';

/**
 * The planner is tested because every wrong answer is invisible.
 *
 * A plan that is too short produces the exact bug this replaced: a button that
 * runs, reports success, and leaves the provider as unreachable as it was — the
 * user presses it, the page reloads, and the same message comes back. A plan
 * that is too long spends a download on an extension that was already installed.
 * Neither raises anything.
 */

/** A context where nothing is installed, disabled or known. */
function emptyContext(overrides: Partial<RecoveryContext> = {}): RecoveryContext {
  return {
    registered: new Map(),
    installed: new Map(),
    repositories: new Set(),
    known: new Map(),
    origins: new Map(),
    disabledProviders: new Set(),
    disabledExtensions: new Set(),
    disabledRepositories: new Set(),
    repositoryIdOf: () => 'repo-1',
    adultAllowed: false,
    ...overrides,
  };
}

const kinds = (plan: ReturnType<typeof planRecovery>) => plan.steps.map((step) => step.kind);

// --- the fresh-machine case, which is the whole point --------------------------

test('a provider whose extension is not installed is installed, repository first', () => {
  /**
   * The state after restoring a backup onto a new computer: the library names
   * `Netflix`, the origin map says NetMirror provided it, and neither the
   * repository nor the archive is here. The old handler called
   * `setProviderEnabled('Netflix', true)` — a no-op on a name that is not in
   * the disabled list — and reported success.
   */
  const plan = planRecovery(
    'Netflix',
    emptyContext({
      origins: new Map([['Netflix', { internalName: 'NetMirror', pluginName: 'NetMirror' }]]),
      known: new Map([
        ['NetMirror', { name: 'NetMirror', repositoryUrl: 'https://example.test/repo.json' }],
      ]),
    })
  );

  assert.deepEqual(kinds(plan), ['add-repository', 'install-extension']);
  assert.equal(plan.steps[0].target, 'https://example.test/repo.json');
  assert.equal(plan.steps[1].target, 'NetMirror');
  assert.ok(plan.steps.every((step) => step.costly), 'both steps go to the network and say so');
  assert.ok(isActionable(plan));
});

test('a repository already in the list is not added again', () => {
  const plan = planRecovery(
    'Netflix',
    emptyContext({
      repositories: new Set(['https://example.test/repo.json']),
      origins: new Map([['Netflix', { internalName: 'NetMirror', pluginName: 'NetMirror' }]]),
      known: new Map([
        ['NetMirror', { name: 'NetMirror', repositoryUrl: 'https://example.test/repo.json' }],
      ]),
    })
  );

  assert.deepEqual(kinds(plan), ['install-extension']);
});

// --- the cascade, which is what the old button got wrong -----------------------

test('a switched-off repository is turned back on, not just the provider', () => {
  /**
   * The precise shape of the reported bug. Enabling only the provider leaves
   * the repository switch closed, so `enabledProviderNames` still excludes it
   * and nothing changes on screen.
   */
  const plan = planRecovery(
    'Netflix',
    emptyContext({
      registered: new Map([
        ['Netflix', { pluginInternalName: 'NetMirror', pluginName: 'NetMirror', adult: false }],
      ]),
      installed: new Map([
        ['NetMirror', { name: 'NetMirror', repositoryUrl: 'https://example.test/repo.json' }],
      ]),
      repositories: new Set(['https://example.test/repo.json']),
      disabledRepositories: new Set(['repo-1']),
    })
  );

  assert.deepEqual(kinds(plan), ['enable-repository']);
  assert.equal(plan.steps[0].target, 'repo-1');
});

test('all three levels are turned back on when all three are off', () => {
  const plan = planRecovery(
    'Netflix',
    emptyContext({
      registered: new Map([
        ['Netflix', { pluginInternalName: 'NetMirror', pluginName: 'NetMirror', adult: false }],
      ]),
      installed: new Map([
        ['NetMirror', { name: 'NetMirror', repositoryUrl: 'https://example.test/repo.json' }],
      ]),
      repositories: new Set(['https://example.test/repo.json']),
      disabledRepositories: new Set(['repo-1']),
      disabledExtensions: new Set(['NetMirror']),
      disabledProviders: new Set(['Netflix']),
    })
  );

  assert.deepEqual(kinds(plan), ['enable-repository', 'enable-extension', 'enable-provider']);
});

test('a level that is already on gets no step', () => {
  /**
   * The opposite failure and the reason each step is checked rather than always
   * emitted: reporting "switched the repository back on" when it was never off
   * describes work that did not happen, and the next person to read the report
   * has no way to tell which lines were real.
   */
  const plan = planRecovery(
    'Netflix',
    emptyContext({
      registered: new Map([
        ['Netflix', { pluginInternalName: 'NetMirror', pluginName: 'NetMirror', adult: false }],
      ]),
      installed: new Map([
        ['NetMirror', { name: 'NetMirror', repositoryUrl: 'https://example.test/repo.json' }],
      ]),
      repositories: new Set(['https://example.test/repo.json']),
      disabledProviders: new Set(['Netflix']),
    })
  );

  assert.deepEqual(kinds(plan), ['enable-provider']);
});

// --- when there is nothing to offer --------------------------------------------

test('a provider nothing has ever recorded is blocked, not offered a button', () => {
  const plan = planRecovery('Unheard', emptyContext());

  assert.deepEqual(plan.steps, []);
  assert.match(String(plan.blocked), /Search for the title again/);
  assert.equal(isActionable(plan), false, 'a dead button is what this replaced');
});

test('a known extension with no repository is blocked rather than half-planned', () => {
  /**
   * `rememberKnownPlugins` drops rows with no repository for this reason, but
   * an origin record can name an extension the plugin catalogue never covered.
   * Emitting `install-extension` with nowhere to fetch from would produce a
   * button that runs and fails, which is worse than one that explains.
   */
  const plan = planRecovery(
    'Netflix',
    emptyContext({
      origins: new Map([['Netflix', { internalName: 'NetMirror', pluginName: 'NetMirror' }]]),
    })
  );

  assert.deepEqual(plan.steps, []);
  assert.match(String(plan.blocked), /no record of/);
  assert.equal(plan.extension?.internalName, 'NetMirror', 'it still names who to look for');
});

test('a working provider produces no steps and no block', () => {
  /**
   * This is the case that must NOT get a button. The provider is installed and
   * enabled, so the failure was the host, the title or the runtime — and
   * offering "fix this" would be the dead button one level up.
   */
  const plan = planRecovery(
    'Netflix',
    emptyContext({
      registered: new Map([
        ['Netflix', { pluginInternalName: 'NetMirror', pluginName: 'NetMirror', adult: false }],
      ]),
      installed: new Map([
        ['NetMirror', { name: 'NetMirror', repositoryUrl: 'https://example.test/repo.json' }],
      ]),
      repositories: new Set(['https://example.test/repo.json']),
    })
  );

  assert.deepEqual(plan.steps, []);
  assert.equal(plan.blocked, undefined);
  assert.equal(isActionable(plan), false);
});

// --- the adult gate -------------------------------------------------------------

test('an adult provider behind the gate is explained, never silently allowed', () => {
  /**
   * DROP-style rule: the gate is a decision about the whole app made in
   * Settings. A button that opened one title by turning it on for everything
   * would be a setting changed by a control that never named it.
   */
  const plan = planRecovery(
    'SomeAdultProvider',
    emptyContext({
      registered: new Map([
        [
          'SomeAdultProvider',
          { pluginInternalName: 'AdultExt', pluginName: 'AdultExt', adult: true },
        ],
      ]),
      installed: new Map([
        ['AdultExt', { name: 'AdultExt', repositoryUrl: 'https://example.test/repo.json' }],
      ]),
      repositories: new Set(['https://example.test/repo.json']),
      disabledProviders: new Set(['SomeAdultProvider']),
      adultAllowed: false,
    })
  );

  assert.deepEqual(plan.steps, [], 'no step pretends this is one switch away');
  assert.match(String(plan.blocked), /adult content/);
  assert.ok(!kinds(plan).includes('enable-provider'));
});

test('the gate being open leaves an adult provider recoverable like any other', () => {
  const plan = planRecovery(
    'SomeAdultProvider',
    emptyContext({
      registered: new Map([
        [
          'SomeAdultProvider',
          { pluginInternalName: 'AdultExt', pluginName: 'AdultExt', adult: true },
        ],
      ]),
      installed: new Map([
        ['AdultExt', { name: 'AdultExt', repositoryUrl: 'https://example.test/repo.json' }],
      ]),
      repositories: new Set(['https://example.test/repo.json']),
      disabledProviders: new Set(['SomeAdultProvider']),
      adultAllowed: true,
    })
  );

  assert.deepEqual(kinds(plan), ['enable-provider']);
});

// --- where the repository URL is allowed to come from ---------------------------

test('the live record wins over a stale backup claim', () => {
  /**
   * The backup is a claim about another machine. What is installed here is a
   * fact about this one, and an extension that moved repositories would
   * otherwise have its archive fetched from an address it no longer lives at.
   */
  const plan = planRecovery(
    'Netflix',
    emptyContext({
      registered: new Map([
        ['Netflix', { pluginInternalName: 'NetMirror', pluginName: 'NetMirror', adult: false }],
      ]),
      installed: new Map([
        ['NetMirror', { name: 'NetMirror', repositoryUrl: 'https://current.test/repo.json' }],
      ]),
      known: new Map([
        ['NetMirror', { name: 'NetMirror', repositoryUrl: 'https://old.test/repo.json' }],
      ]),
      repositories: new Set(['https://current.test/repo.json']),
    })
  );

  assert.equal(plan.extension?.repositoryUrl, 'https://current.test/repo.json');
  assert.deepEqual(plan.steps, []);
});

test('no step ever names a URL that was not already recorded', () => {
  /**
   * The security rule, asserted rather than trusted to review. A `cs3ext://`
   * address travels in library rows and bookmarks and is built from a provider
   * name; if recovery could take a repository URL from one, reopening a saved
   * page would become a way to make the app install code from anywhere.
   */
  const recorded = new Set(['https://example.test/repo.json']);
  const plan = planRecovery(
    'Netflix',
    emptyContext({
      origins: new Map([['Netflix', { internalName: 'NetMirror', pluginName: 'NetMirror' }]]),
      known: new Map([
        ['NetMirror', { name: 'NetMirror', repositoryUrl: 'https://example.test/repo.json' }],
      ]),
    })
  );

  for (const step of plan.steps) {
    if (step.kind !== 'add-repository') continue;
    assert.ok(
      recorded.has(step.target),
      `add-repository named ${step.target}, which no local record mentions`
    );
  }
});
