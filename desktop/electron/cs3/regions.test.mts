import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  affectedByRemoval,
  matchRepository,
  normaliseSelection,
  planRegionalSetup,
  repositoryRegions,
  suggestRegions,
  wantedLanguages,
  type RegionalRepository,
} from './regions.ts';

/**
 * PRD-54. Both failure directions are quiet: a viewer handed another
 * region's scrapers reads it as the app finding the wrong films, and one
 * denied their own region's reads it as the app having nothing.
 */

const repo = (name: string, over: Partial<RegionalRepository> = {}): RegionalRepository => ({
  rawRepoUrl: `https://example.test/${name}/repo.json`,
  name,
  language: 'English',
  verified: true,
  ...over,
});

const global = repo('global', { regions: ['*'], bundled: true });
const globalUnbundled = repo('community', { regions: ['*'] });
const indian = repo('netmirror', { regions: ['IN'], language: 'Hindi / English' });
const indonesian = repo('indostream', { regions: ['SEA'], language: 'Indonesian (ID)' });
const both = repo('csx', { regions: ['*', 'IN'], bundled: true });
const adult = repo('adult', { regions: ['*'], adult: true });
const dead = repo('dead', { regions: ['IN'], verified: false });
const catalogue = [global, globalUnbundled, indian, indonesian, both, adult, dead];

const names = (plan: { repo: RegionalRepository }[]) => plan.map((entry) => entry.repo.name);

test('India + Global gets Indian and global repositories, not Indonesian ones', () => {
  const plan = planRegionalSetup(catalogue, ['IN', 'GLOBAL'], { adultAllowed: false });
  assert.deepEqual(names(plan), ['global', 'community', 'netmirror', 'csx']);
});

test('a region-matched repository installs in any language; a global one is language-filtered', () => {
  const plan = planRegionalSetup(catalogue, ['IN', 'GLOBAL'], { adultAllowed: false });
  const byName = Object.fromEntries(plan.map((entry) => [entry.repo.name, entry]));
  assert.equal(byName.netmirror.install, true);
  assert.equal(byName.netmirror.languages, null);
  assert.equal(byName.csx.languages, null, 'reached through India, so not filtered');
  assert.equal(byName.global.install, true);
  assert.ok(byName.global.languages?.includes('hi') && byName.global.languages.includes('en'));
  assert.ok(!byName.global.languages?.includes('id'));
});

test('an unbundled global repository is added, never installed from', () => {
  const plan = planRegionalSetup(catalogue, ['GLOBAL'], { adultAllowed: false });
  assert.equal(plan.find((entry) => entry.repo.name === 'community')?.install, false);
});

test('India alone does not pull in global repositories', () => {
  const plan = planRegionalSetup(catalogue, ['IN'], { adultAllowed: false });
  assert.deepEqual(names(plan), ['netmirror', 'csx']);
});

test('All regions matches everything verified, in any language', () => {
  const plan = planRegionalSetup(catalogue, ['ALL'], { adultAllowed: false });
  assert.deepEqual(names(plan), ['global', 'community', 'netmirror', 'indostream', 'csx']);
  assert.equal(wantedLanguages(['ALL']), null);
  assert.equal(plan.find((entry) => entry.repo.name === 'global')?.languages, null);
});

test('adult repositories appear only when allowed, and are never installed from', () => {
  assert.ok(!names(planRegionalSetup(catalogue, ['ALL'], { adultAllowed: false })).includes('adult'));
  const entry = planRegionalSetup(catalogue, ['GLOBAL'], { adultAllowed: true }).find(
    (candidate) => candidate.repo.name === 'adult'
  );
  assert.equal(entry?.install, false);
});

test('already-installed repositories are skipped, so a manual choice is never redone', () => {
  const plan = planRegionalSetup(catalogue, ['IN'], {
    adultAllowed: false,
    skip: new Set([indian.rawRepoUrl]),
  });
  assert.deepEqual(names(plan), ['csx']);
});

test('regions are derived from the language text when not declared', () => {
  assert.deepEqual(repositoryRegions({ language: 'Multilingual' }), ['*']);
  assert.deepEqual(repositoryRegions({ language: 'English' }), ['*']);
  assert.deepEqual(repositoryRegions({ language: 'German (DE)' }), ['EU']);
  assert.deepEqual(repositoryRegions({ language: 'Indonesian (ID)' }), ['SEA']);
  assert.ok(repositoryRegions({ language: 'Hindi / English' }).includes('IN'));
  assert.ok(!repositoryRegions({ language: 'Malayalam' }).includes('SEA'), 'Malayalam is not Malay');
  assert.ok(repositoryRegions({ language: 'Arabic (AR)' }).includes('ME'));
  assert.deepEqual(repositoryRegions({ language: 'Klingon', regions: ['KR'] }), ['KR'], 'declared wins');
});

test('removal names only repositories no remaining region covers', () => {
  const affected = affectedByRemoval([global, indian, both, indonesian], ['IN', 'GLOBAL', 'SEA'], ['GLOBAL']);
  assert.deepEqual(names(affected.map((r) => ({ repo: r }))), ['netmirror', 'indostream']);
  assert.equal(matchRepository(both, ['GLOBAL']), 'global', 'csx is still covered by Global');
});

test('the locale suggests a starting selection', () => {
  assert.deepEqual(suggestRegions('en-IN'), ['IN', 'GLOBAL']);
  assert.deepEqual(suggestRegions('id-ID'), ['SEA', 'GLOBAL']);
  assert.deepEqual(suggestRegions('en-US'), ['GLOBAL']);
  assert.deepEqual(suggestRegions('de'), ['EU', 'GLOBAL']);
  assert.deepEqual(suggestRegions(undefined), ['GLOBAL']);
});

test('a stored selection is normalised against the region table', () => {
  assert.deepEqual(normaliseSelection(['in', 'GLOBAL', 'IN', 'mars']), ['IN', 'GLOBAL']);
});

test('cross-region searches other regions’ repositories for the selection’s languages only', () => {
  const german = repo('german', { regions: ['EU'], language: 'German (DE)', bundled: true });
  const plan = planRegionalSetup([global, german, adult], ['GLOBAL'], { adultAllowed: true, crossRegion: true });
  const entry = plan.find((candidate) => candidate.repo.name === 'german');
  assert.equal(entry?.reason, 'language');
  assert.equal(entry?.install, true);
  assert.deepEqual(entry?.languages, ['en']);
  assert.ok(!plan.some((c) => c.repo.name === 'adult' && c.reason === 'language'), 'never through the back door');
  assert.ok(!planRegionalSetup([german], ['GLOBAL'], { adultAllowed: false }).length, 'off means off');
  assert.ok(!planRegionalSetup([german], ['ALL'], { adultAllowed: false, crossRegion: true }).some(
    (c) => c.reason === 'language'
  ));
});
