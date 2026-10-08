import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  changeCount,
  extKey,
  filterTree,
  invertSelection,
  planBulk,
  provKey,
  selectEverything,
  selectMatching,
  splitSelection,
  type TreeFilter,
} from './bulkSelection.ts';
import type { ProviderTreeRepository } from '../../types/plugin';

const NONE: TreeFilter = { query: '', tags: new Set(), languages: new Set(), categories: new Set(), status: 'all' };
const filter = (patch: Partial<TreeFilter>): TreeFilter => ({ ...NONE, ...patch });

/**
 * Two repositories, three extensions:
 *   Repo A ▸ AnimeExt (Gogo [en, ANIME], Zoro [en, ANIME])
 *   Repo A ▸ MixedExt (Hindi1 [hi, MOVIE], English1 [en, MOVIE]) — switched off
 *   Repo B ▸ EmptyExt (no providers — failed to load)
 */
function tree(): ProviderTreeRepository[] {
  const provider = (name: string, lang: string, type: string, extensionName: string, enabled = true) => ({
    name,
    lang,
    supportedTypes: [type],
    enabled,
    effectivelyEnabled: enabled,
    extensionName,
  });
  return [
    {
      url: 'https://a.test/repo.json',
      name: 'Repo A',
      extensions: [
        {
          internalName: 'AnimeExt',
          name: 'Anime Ext',
          providers: [provider('Gogo', 'en', 'ANIME', 'Anime Ext'), provider('Zoro', 'en', 'ANIME', 'Anime Ext', false)],
        },
        {
          internalName: 'MixedExt',
          name: 'Mixed Ext',
          enabled: false,
          providers: [provider('Hindi1', 'hi', 'MOVIE', 'Mixed Ext'), provider('English1', 'en', 'MOVIE', 'Mixed Ext')],
        },
      ],
    },
    {
      url: 'https://b.test/repo.json',
      name: 'Repo B',
      extensions: [{ internalName: 'EmptyExt', name: 'Empty Ext', providers: [], unavailableReason: 'failed to load' }],
    },
  ];
}

test('select all matching takes what the search shows, nothing else', () => {
  const visible = filterTree(tree(), filter({ query: 'anime' }));
  assert.deepEqual([...selectMatching(visible)], [extKey('AnimeExt')]);
});

test('an extension only partly shown is selected provider by provider', () => {
  // The language filter shows English1 but not Hindi1 inside MixedExt.
  const visible = filterTree(tree(), filter({ languages: new Set(['en']) }));
  const picked = selectMatching(visible);
  assert.ok(picked.has(extKey('AnimeExt')));
  assert.ok(picked.has(provKey('English1')));
  assert.equal(picked.has(extKey('MixedExt')), false, 'would have swept Hindi1 in with it');
  assert.equal(picked.has(provKey('Hindi1')), false);
});

test('select everything is every installed extension, unfiltered', () => {
  assert.deepEqual(
    [...selectEverything(tree())].sort(),
    [extKey('AnimeExt'), extKey('EmptyExt'), extKey('MixedExt')]
  );
});

test('a hidden selection is kept and counted, but not acted on', () => {
  const selection = new Set([extKey('AnimeExt'), extKey('MixedExt')]);
  const visible = filterTree(tree(), filter({ query: 'anime' }));
  const { shown, hidden } = splitSelection(selection, visible);
  assert.deepEqual([...shown], [extKey('AnimeExt')]);
  assert.deepEqual([...hidden], [extKey('MixedExt')]);

  const plan = planBulk(selection, visible, new Map());
  assert.equal(plan.hidden, 1);
  assert.deepEqual(plan.uninstall.map((e) => e.internalName), ['AnimeExt']);
});

test('invert flips what is shown and leaves hidden selections alone', () => {
  const visible = filterTree(tree(), filter({ query: 'ext' }));
  const hiddenKey = provKey('SomethingFiltered');
  const inverted = invertSelection(new Set([extKey('AnimeExt'), hiddenKey]), visible);
  assert.equal(inverted.has(extKey('AnimeExt')), false);
  assert.ok(inverted.has(extKey('MixedExt')));
  assert.ok(inverted.has(extKey('EmptyExt')));
  assert.ok(inverted.has(hiddenKey), 'not on screen, so not inverted');
});

test('inverting twice returns the shown selection', () => {
  const visible = filterTree(tree(), NONE);
  const start = new Set([extKey('MixedExt')]);
  assert.deepEqual([...invertSelection(invertSelection(start, visible), visible)].sort(), [...start]);
});

test('enable and disable count only what would change', () => {
  const visible = filterTree(tree(), NONE);
  const plan = planBulk(selectEverything(tree()), visible, new Map());
  // MixedExt is off; AnimeExt and EmptyExt are on.
  assert.deepEqual(plan.enable.extensions.map((e) => e.internalName), ['MixedExt']);
  assert.deepEqual(plan.disable.extensions.map((e) => e.internalName).sort(), ['AnimeExt', 'EmptyExt']);
  assert.equal(changeCount(plan.enable), 1);
});

test('a provider under a selected extension is acted on through the extension only', () => {
  const visible = filterTree(tree(), NONE);
  const plan = planBulk(new Set([extKey('AnimeExt'), provKey('Gogo')]), visible, new Map());
  assert.equal(plan.count, 1);
  assert.deepEqual(plan.disable.providers, []);
  assert.deepEqual(plan.disable.extensions.map((e) => e.internalName), ['AnimeExt']);
});

test('uninstall lists what goes with each extension, and providers cannot be uninstalled alone', () => {
  const visible = filterTree(tree(), NONE);
  const plan = planBulk(new Set([extKey('AnimeExt'), provKey('English1')]), visible, new Map());
  assert.deepEqual(plan.uninstall, [
    { internalName: 'AnimeExt', name: 'Anime Ext', repositoryName: 'Repo A', providers: ['Gogo', 'Zoro'] },
  ]);
  assert.deepEqual(plan.notUninstallable.map((p) => p.name), ['English1']);
});

test('an extension with no providers can still be uninstalled', () => {
  const visible = filterTree(tree(), NONE);
  const plan = planBulk(new Set([extKey('EmptyExt')]), visible, new Map());
  assert.deepEqual(plan.uninstall.map((e) => e.providers), [[]]);
});

test('an extension a job is holding is left out of every action, with the reason', () => {
  const visible = filterTree(tree(), NONE);
  const plan = planBulk(
    new Set([extKey('AnimeExt'), extKey('MixedExt')]),
    visible,
    new Map([['AnimeExt', 'being updated']])
  );
  assert.deepEqual(plan.busy, [{ name: 'Anime Ext', reason: 'being updated' }]);
  assert.deepEqual(plan.uninstall.map((e) => e.internalName), ['MixedExt']);
  assert.equal(plan.disable.extensions.length, 0);
});

test('individually selected providers enable or disable by their own state', () => {
  const visible = filterTree(tree(), NONE);
  const plan = planBulk(new Set([provKey('Gogo'), provKey('Zoro')]), visible, new Map());
  assert.deepEqual(plan.disable.providers.map((p) => p.name), ['Gogo']);
  assert.deepEqual(plan.enable.providers.map((p) => p.name), ['Zoro']);
});
