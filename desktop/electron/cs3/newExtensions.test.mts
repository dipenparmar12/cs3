import { test } from 'node:test';
import assert from 'node:assert/strict';

import { planNewExtensions } from './newExtensions.ts';
import type { SitePlugin } from '../../src/types/plugin.ts';

const REPO = 'https://example.test/repo.json';
const plugin = (internalName: string, extra: Partial<SitePlugin> = {}): SitePlugin =>
  ({ url: `${internalName}.cs3`, status: 1, version: 1, name: internalName, internalName, ...extra }) as SitePlugin;

test('a plugin published after the repository was seen is installed', () => {
  const plan = planNewExtensions({
    listings: [{ url: REPO, plugins: [plugin('A'), plugin('B'), plugin('C')] }],
    installed: new Set(['A']),
    usedRepositories: new Set([REPO]),
    known: { [REPO]: ['A', 'B'] },
    adultAllowed: false,
  });
  assert.deepEqual(plan.install.map((i) => i.plugin.internalName), ['C']);
  assert.deepEqual(plan.known[REPO], ['A', 'B', 'C']);
});

test('the first look at a repository installs nothing, it only remembers', () => {
  const plan = planNewExtensions({
    listings: [{ url: REPO, plugins: [plugin('A'), plugin('B')] }],
    installed: new Set(['A']),
    usedRepositories: new Set([REPO]),
    known: {},
    adultAllowed: false,
  });
  assert.equal(plan.install.length, 0);
  assert.deepEqual(plan.known[REPO], ['A', 'B']);
});

test('an extension the viewer uninstalled does not come back', () => {
  const plan = planNewExtensions({
    listings: [{ url: REPO, plugins: [plugin('A'), plugin('B')] }],
    installed: new Set(['A']), // B was installed once and removed
    usedRepositories: new Set([REPO]),
    known: { [REPO]: ['A', 'B'] },
    adultAllowed: false,
  });
  assert.equal(plan.install.length, 0);
});

test('a repository nothing was installed from is not installed from', () => {
  const plan = planNewExtensions({
    listings: [{ url: REPO, plugins: [plugin('A'), plugin('N')] }],
    installed: new Set(),
    usedRepositories: new Set(),
    known: { [REPO]: ['A'] },
    adultAllowed: false,
  });
  assert.equal(plan.install.length, 0);
});

test('down and adult-only plugins are left out, with the reason', () => {
  const plan = planNewExtensions({
    listings: [
      {
        url: REPO,
        plugins: [plugin('A'), plugin('Down', { status: 0 }), plugin('Adult', { tvTypes: ['NSFW'] as never }), plugin('Mixed', { tvTypes: ['Movie', 'NSFW'] as never })],
      },
    ],
    installed: new Set(['A']),
    usedRepositories: new Set([REPO]),
    known: { [REPO]: ['A'] },
    adultAllowed: false,
  });
  assert.deepEqual(plan.install.map((i) => i.plugin.internalName), ['Mixed']);
  assert.deepEqual(plan.skipped.map((s) => s.internalName).sort(), ['Adult', 'Down']);
});

test('the same new plugin listed by two repositories is queued once', () => {
  const OTHER = 'https://example.test/mirror.json';
  const plan = planNewExtensions({
    listings: [
      { url: REPO, plugins: [plugin('A'), plugin('N')] },
      { url: OTHER, plugins: [plugin('X'), plugin('N')] },
    ],
    installed: new Set(['A', 'X']),
    usedRepositories: new Set([REPO, OTHER]),
    known: { [REPO]: ['A'], [OTHER]: ['X'] },
    adultAllowed: true,
  });
  assert.equal(plan.install.length, 1);
});
