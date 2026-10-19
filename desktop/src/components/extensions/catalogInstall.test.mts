/**
 * "Install all" on a Browse search: what it installs and what it leaves out.
 *
 *   node --experimental-strip-types src/components/extensions/catalogInstall.test.mts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeExclusions, isAdultOnlyPlugin, planCatalogInstall, type CatalogRepository } from './catalogInstall.ts';
import type { SitePlugin } from '../../types/plugin';

const plugin = (internalName: string, extra: Partial<SitePlugin> = {}): SitePlugin =>
  ({ internalName, name: internalName, url: `https://example.test/${internalName}.cs3`, status: 1, version: 1, ...extra }) as SitePlugin;

const repo = (name: string, plugins: SitePlugin[] | null, matchedItself = false): CatalogRepository => ({
  url: `https://example.test/${name}/repo.json`,
  name,
  matchedItself,
  plugins,
});

const base = { installed: new Set<string>(), active: new Set<string>(), adultAllowed: false };

test('a repository that matched itself offers everything it lists', () => {
  const plan = planCatalogInstall({ ...base, query: 'anime', repositories: [repo('AnimeHub', [plugin('A'), plugin('B')], true)] });
  assert.deepEqual(plan.items.map((item) => item.plugin.internalName), ['A', 'B']);
  assert.equal(plan.repositories, 1);
});

test('otherwise only the extensions whose own text matched, across several repositories', () => {
  const plan = planCatalogInstall({
    ...base,
    query: 'vega',
    repositories: [
      repo('One', [plugin('VegaMovies'), plugin('Other')]),
      repo('Two', [plugin('Unrelated', { description: 'Mirrors VEGA links' })]),
      repo('Three', [plugin('Nothing')]),
    ],
  });
  assert.deepEqual(plan.items.map((item) => item.plugin.internalName), ['VegaMovies', 'Unrelated']);
  assert.equal(plan.repositories, 2);
});

test('installed, queued, maintainer-down and adult-only extensions are left out and counted', () => {
  const plan = planCatalogInstall({
    query: '',
    installed: new Set(['Have']),
    active: new Set(['ext:Queued']),
    adultAllowed: false,
    repositories: [
      repo(
        'Mixed',
        [
          plugin('Have'),
          plugin('Queued'),
          plugin('Down', { status: 0 }),
          plugin('Adult', { tvTypes: ['NSFW'] as never }),
          plugin('Mixed18', { tvTypes: ['Movie', 'NSFW'] as never }),
          plugin('Fresh'),
        ],
        true
      ),
    ],
  });
  assert.deepEqual(plan.items.map((item) => item.plugin.internalName), ['Mixed18', 'Fresh']);
  assert.deepEqual(plan.excluded, { installed: 1, queued: 1, down: 1, adult: 1, duplicate: 0 });
  assert.equal(describeExclusions(plan.excluded), '1 installed · 1 already queued · 1 marked down · 1 adult');
});

test('adult-only extensions are offered once adult content is on', () => {
  const plan = planCatalogInstall({
    ...base,
    adultAllowed: true,
    query: '',
    repositories: [repo('R', [plugin('Adult', { tvTypes: ['NSFW'] as never })], true)],
  });
  assert.equal(plan.items.length, 1);
});

test('one extension listed by two repositories is installed once', () => {
  const plan = planCatalogInstall({
    ...base,
    query: '',
    repositories: [repo('Main', [plugin('Shared')], true), repo('Mirror', [plugin('Shared')], true)],
  });
  assert.equal(plan.items.length, 1);
  assert.equal(plan.items[0].repositoryName, 'Main');
  assert.equal(plan.excluded.duplicate, 1);
});

test('a repository never read is queued whole only when it matched itself', () => {
  const plan = planCatalogInstall({
    ...base,
    query: 'hindi',
    repositories: [repo('HindiHub', null, true), repo('Elsewhere', null, false)],
  });
  assert.deepEqual(plan.unread.map((r) => r.name), ['HindiHub']);
  assert.equal(plan.items.length, 0);
});

test('nothing matched means nothing to install', () => {
  const plan = planCatalogInstall({ ...base, query: 'zzz', repositories: [repo('R', [plugin('A')])] });
  assert.equal(plan.items.length + plan.unread.length, 0);
});

test('adult-only means NSFW with nothing general beside it', () => {
  assert.equal(isAdultOnlyPlugin(plugin('a', { tvTypes: ['NSFW', 'Others'] as never })), true);
  assert.equal(isAdultOnlyPlugin(plugin('b', { tvTypes: ['Movie', 'NSFW'] as never })), false);
  assert.equal(isAdultOnlyPlugin(plugin('c')), false);
});
