import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pickStarterPlugins, preferredLanguages, repositorySpeaks } from './starterPlugins.ts';
import type { SitePlugin } from '../../src/types/plugin.ts';

/**
 * What a new install starts with. The failure this guards is quiet: a first
 * search drawing on scrapers in languages the viewer does not watch, which
 * reads as the app finding the wrong films.
 */

const plugin = (internalName: string, over: Partial<SitePlugin> = {}): SitePlugin =>
  ({
    internalName,
    name: internalName,
    url: `https://example.test/${internalName}.cs3`,
    status: 1,
    version: 1,
    language: 'en',
    ...over,
  }) as SitePlugin;

test('the viewer’s language and English, and nothing else', () => {
  const picked = pickStarterPlugins(
    [
      plugin('Hindi', { language: 'hi' }),
      plugin('English'),
      plugin('Turkish', { language: 'tr' }),
      plugin('Multi', { language: 'multi' }),
      plugin('Undeclared', { language: undefined }),
    ],
    { languages: preferredLanguages('en-IN'), allowAdult: false, limit: 10 }
  );
  assert.deepEqual(
    picked.map((p) => p.internalName),
    ['English', 'Multi', 'Undeclared']
  );
});

test('a German viewer gets German first, then English', () => {
  assert.deepEqual(preferredLanguages('de-DE'), ['de', 'en']);
  const picked = pickStarterPlugins(
    [plugin('English'), plugin('German', { language: 'de' })],
    { languages: preferredLanguages('de-DE'), allowAdult: false, limit: 10 }
  );
  assert.deepEqual(picked.map((p) => p.internalName), ['German', 'English']);
});

test('working before beta before slow, and never what its maintainer marked down', () => {
  const picked = pickStarterPlugins(
    [
      plugin('Slow', { status: 2 }),
      plugin('Down', { status: 0 }),
      plugin('Beta', { status: 3 }),
      plugin('Working', { status: 1 }),
    ],
    { languages: ['en'], allowAdult: false, limit: 10 }
  );
  assert.deepEqual(picked.map((p) => p.internalName), ['Working', 'Beta', 'Slow']);
});

test('adult providers are not installed unless adult content is on', () => {
  const nsfw = plugin('Adult', { tvTypes: ['NSFW'] as never });
  const off = pickStarterPlugins([nsfw, plugin('Film')], { languages: ['en'], allowAdult: false, limit: 10 });
  assert.deepEqual(off.map((p) => p.internalName), ['Film']);
  const on = pickStarterPlugins([nsfw, plugin('Film')], { languages: ['en'], allowAdult: true, limit: 10 });
  assert.equal(on.length, 2);
});

test('the limit keeps the best, and the index order breaks ties', () => {
  const picked = pickStarterPlugins(
    [plugin('A', { status: 3 }), plugin('B'), plugin('C'), plugin('D')],
    { languages: ['en'], allowAdult: false, limit: 2 }
  );
  assert.deepEqual(picked.map((p) => p.internalName), ['B', 'C']);
});

test('a bundled repository in another language is left to the catalogue', () => {
  const english = preferredLanguages('en-IN');
  assert.equal(repositorySpeaks('German (DE)', english), false);
  assert.equal(repositorySpeaks('English', english), true);
  assert.equal(repositorySpeaks('Hindi / English', english), true);
  assert.equal(repositorySpeaks('Multilingual', english), true);
  assert.equal(repositorySpeaks('English / Global', english), true);
  assert.equal(repositorySpeaks('German (DE)', preferredLanguages('de-AT')), true);
  assert.equal(repositorySpeaks(undefined, english), true, 'an undeclared language is not a reason to skip');
});
