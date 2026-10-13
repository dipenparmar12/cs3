import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBackupSections, type BackupSectionDeps } from './backupSections.ts';
import { BackupService } from './backupService.ts';
import {
  DATASTORE_CATEGORIES,
  categorySectionId,
  classifyKey,
  type DatastoreRow,
} from './backup/datastoreCategories.ts';
import type { RestorePlan } from '../../src/types/backup.ts';

/**
 * The real section table, against in-memory stores.
 *
 * `backupService.test.mts` pins the framework; this pins the decisions each
 * store made about its own rows — the ones that would be invisible until a
 * restore on someone else's machine got them wrong.
 */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cs3-sections-'));
let n = 0;
const fileIn = () => path.join(tmp, `${n++}.json`);

function fakeDeps() {
  const state = {
    datastore: [] as DatastoreRow[],
    repositories: [] as string[],
    plugins: [] as Array<{ internalName: string; name: string; repositoryUrl: string; url: string; version: number; tvTypes?: string[] }>,
    offered: new Map<string, Array<{ internalName: string; name: string; url: string; version: number; tvTypes?: string[] }>>(),
    unreachable: new Set<string>(),
    disabled: { provider: [] as string[], extension: [] as string[], repository: [] as string[] },
    jobs: [] as unknown[],
    known: [] as unknown[],
    adultAllowed: false,
    adultMode: 'off' as 'off' | 'ask' | 'on',
    adultNotified: 0,
  };
  const toggle = (list: string[], names: string[], enabled: boolean) =>
    enabled ? list.filter((name) => !names.includes(name)) : [...new Set([...list, ...names])];
  const unused = () => {
    throw new Error('not used by this test');
  };
  const deps = {
    datastore: {
      rows: () => state.datastore,
      writeRows: (put: DatastoreRow[], remove: Array<{ bucket: string; key: string }>) => {
        const drop = new Set([...remove, ...put].map((row) => `${row.bucket}:${row.key}`));
        state.datastore = [...state.datastore.filter((row) => !drop.has(`${row.bucket}:${row.key}`)), ...put];
      },
    },
    plugins: {
      getInstalledRepositories: () => state.repositories,
      addRepository: async (url: string) => {
        if (state.unreachable.has(url)) return { ok: false, message: 'That repository could not be read.' };
        state.repositories.push(url);
        return { ok: true, message: 'Added' };
      },
      getInstalledPlugins: () => state.plugins,
      fetchRepository: async (url: string) => {
        if (state.unreachable.has(url)) throw new Error('offline');
        return { plugins: state.offered.get(url) ?? [] };
      },
      rememberKnownPlugins: (rows: unknown[]) => {
        state.known.push(...rows);
        return rows.length;
      },
      exportProviderOrigins: () => ({}),
      importProviderOrigins: () => 0,
      getDisabledProviders: () => state.disabled.provider,
      getDisabledExtensions: () => state.disabled.extension,
      getDisabledRepositories: () => state.disabled.repository,
      setProvidersEnabled: (names: string[], enabled: boolean) => {
        state.disabled.provider = toggle(state.disabled.provider, names, enabled);
      },
      setExtensionsEnabled: (names: string[], enabled: boolean) => {
        state.disabled.extension = toggle(state.disabled.extension, names, enabled);
      },
      setRepositoriesEnabled: (names: string[], enabled: boolean) => {
        state.disabled.repository = toggle(state.disabled.repository, names, enabled);
      },
    },
    enqueueExtensionJobs: (requests: unknown[]) => {
      state.jobs.push(...requests);
    },
    isAdultAllowed: () => state.adultAllowed,
    adult: {
      adultMode: () => state.adultMode,
      setAdultMode: (mode: 'off' | 'ask' | 'on') => {
        state.adultMode = mode;
        state.adultNotified++;
      },
    },
    // Stores these tests do not reach answer empty and refuse writes.
    library: { exportAll: () => ({ entries: [], progress: [], sources: [] }), exportPlayedSources: () => [], replaceEntries: unused, replaceProgress: unused, replaceSourceMemory: unused, replacePlayedSources: unused },
    history: { exportAll: () => [], replaceAll: unused },
    bookmarks: { list: () => [], replaceAll: unused },
    pageSnapshots: { list: () => [], replacePinned: unused },
    searchHistory: { list: () => [], replaceAll: unused },
    savedSearches: { exportAll: () => [], replaceAll: unused },
    titleOutcomes: { list: () => ({}), replaceAll: unused },
    providerAnalytics: { getSettings: () => ({}) as never, setSettings: unused, getPreferences: () => ({}), setPreference: unused },
    downloads: { getTasks: () => [], restoreTasks: unused },
    indexers: { getConfigs: () => [], saveConfigs: unused },
  } as unknown as BackupSectionDeps;
  return { deps, state };
}

function serviceFor(deps: BackupSectionDeps) {
  return new BackupService(createBackupSections(deps), 'test', 'test', {
    recoveryDir: fs.mkdtempSync(path.join(tmp, 'rec-')),
  });
}

const plan = (mode: RestorePlan['mode'], sections: string[]): RestorePlan => ({ mode, sections });

test('every section id is unique and every settings category has one', () => {
  const ids = createBackupSections(fakeDeps().deps).map((section) => section.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const category of DATASTORE_CATEGORIES) assert.ok(ids.includes(categorySectionId(category.id)), category.id);
  // Restore order: repositories before the extensions installed from them,
  // and both before the switches that turn some of them off.
  assert.ok(ids.indexOf('repositories') < ids.indexOf('extensions'));
  assert.ok(ids.indexOf('extensions') < ids.indexOf('extensionSwitches'));
});

test('store-owned keys and caches never travel as settings, and unknown keys still do', () => {
  for (const key of ['library_entries', 'watch_progress', 'media_history_events_v1', 'cs3_disabled_providers']) {
    assert.equal(classifyKey(key), 'owned', key);
  }
  for (const key of ['source_cache_v1', 'window_bounds', 'media_inspection_v1']) assert.equal(classifyKey(key), 'excluded', key);
  assert.equal(classifyKey('ott_pinned_platforms'), 'streaming');
  assert.equal(classifyKey('incognito_allow_downloads'), 'privacy');
  assert.equal(classifyKey('home_tmdb_api_key'), 'home');
  assert.equal(classifyKey('a_setting_added_next_year'), 'other');
});

test('a settings category restores only its own keys and leaves the rest of the datastore alone', async () => {
  const source = fakeDeps();
  source.state.datastore = [
    { bucket: 'datastore', type: '_String', key: 'ott_pinned_platforms', value: '["netflix","prime"]' },
    { bucket: 'datastore', type: '_Bool', key: 'prefetch_sources_on_detail', value: false },
  ];
  const file = fileIn();
  serviceFor(source.deps).write(file);

  const target = fakeDeps();
  target.state.datastore = [
    { bucket: 'datastore', type: '_String', key: 'ott_pinned_platforms', value: '["hotstar"]' },
    { bucket: 'datastore', type: '_Bool', key: 'prefetch_sources_on_detail', value: true },
  ];
  await serviceFor(target.deps).restore(file, plan('replace', ['settings.streaming']));
  const byKey = Object.fromEntries(target.state.datastore.map((row) => [row.key, row.value]));
  assert.equal(byKey.ott_pinned_platforms, '["netflix","prime"]');
  assert.equal(byKey.prefetch_sources_on_detail, true, 'a different category was not chosen');
});

test('a differing setting is a conflict for smart restore: settings carry no timestamps', () => {
  const source = fakeDeps();
  source.state.datastore = [{ bucket: 'datastore', type: '_String', key: 'native_engine_policy', value: 'auto' }];
  const file = fileIn();
  serviceFor(source.deps).write(file);
  const target = fakeDeps();
  target.state.datastore = [{ bucket: 'datastore', type: '_String', key: 'native_engine_policy', value: 'off' }];
  const analysis = serviceFor(target.deps).analyze(file);
  assert.ok(analysis.ok);
  const playback = analysis.analysis.sections.find((section) => section.id === 'settings.playback');
  assert.equal(playback?.conflictTotal, 1);
  assert.equal(playback?.conflicts[0].label, 'Native player');
});

test('a JSON setting is compared by meaning, not by the order its keys were written in', () => {
  const source = fakeDeps();
  source.state.datastore = [{ bucket: 'datastore', type: '_String', key: 'player_preferences', value: '{"a":1,"b":2}' }];
  const file = fileIn();
  serviceFor(source.deps).write(file);
  const target = fakeDeps();
  target.state.datastore = [{ bucket: 'datastore', type: '_String', key: 'player_preferences', value: '{"b":2,"a":1}' }];
  const analysis = serviceFor(target.deps).analyze(file);
  assert.ok(analysis.ok);
  const playback = analysis.analysis.sections.find((section) => section.id === 'settings.playback');
  assert.equal(playback?.counts.same, 1);
});

test('restoring adult content tells the owner, so every surface hears about it', async () => {
  const source = fakeDeps();
  source.state.datastore = [{ bucket: 'datastore', type: '_String', key: 'cs3_adult_content_mode', value: 'ask' }];
  const file = fileIn();
  serviceFor(source.deps).write(file);
  const target = fakeDeps();
  await serviceFor(target.deps).restore(file, plan('smart', ['settings.contentFilters']));
  assert.equal(target.state.adultNotified, 1);
});

test('an unreachable repository is reported by address and the others are added', async () => {
  const source = fakeDeps();
  source.state.repositories = ['https://good/repo.json', 'https://dead/repo.json'];
  const file = fileIn();
  serviceFor(source.deps).write(file);

  const target = fakeDeps();
  target.state.unreachable.add('https://dead/repo.json');
  const summary = await serviceFor(target.deps).restore(file, plan('smart', ['repositories']));
  const row = summary.sections.find((section) => section.id === 'repositories')!;
  assert.equal(row.added, 1);
  assert.deepEqual(row.failed.map((failure) => failure.label), ['https://dead/repo.json']);
  assert.deepEqual(target.state.repositories, ['https://good/repo.json']);
});

test('replace never removes a repository, because that would uninstall what it brought', async () => {
  const source = fakeDeps();
  const file = fileIn();
  serviceFor(source.deps).write(file);
  const target = fakeDeps();
  target.state.repositories = ['https://mine/repo.json'];
  await serviceFor(target.deps).restore(file, plan('replace', ['repositories']));
  assert.deepEqual(target.state.repositories, ['https://mine/repo.json']);
});

test('missing extensions are queued for install, and ones that cannot be found say why', async () => {
  const source = fakeDeps();
  source.state.plugins = [
    { internalName: 'Offered', name: 'Offered', repositoryUrl: 'https://r', url: 'u', version: 3 },
    { internalName: 'Withdrawn', name: 'Withdrawn', repositoryUrl: 'https://r', url: 'u', version: 1 },
    { internalName: 'Adult', name: 'Adult', repositoryUrl: 'https://r', url: 'u', version: 1 },
    { internalName: 'Offline', name: 'Offline', repositoryUrl: 'https://down', url: 'u', version: 1 },
    { internalName: 'Older', name: 'Older', repositoryUrl: 'https://r', url: 'u', version: 5 },
    { internalName: 'Current', name: 'Current', repositoryUrl: 'https://r', url: 'u', version: 2 },
  ];
  const file = fileIn();
  serviceFor(source.deps).write(file);

  const target = fakeDeps();
  target.state.plugins = [
    { internalName: 'Older', name: 'Older', repositoryUrl: 'https://r', url: 'u', version: 4 },
    { internalName: 'Current', name: 'Current', repositoryUrl: 'https://r', url: 'u', version: 2 },
  ];
  target.state.offered.set('https://r', [
    { internalName: 'Offered', name: 'Offered', url: 'u', version: 3 },
    { internalName: 'Adult', name: 'Adult', url: 'u', version: 1, tvTypes: ['NSFW'] },
  ]);
  target.state.unreachable.add('https://down');

  const summary = await serviceFor(target.deps).restore(file, plan('smart', ['extensions']));
  const row = summary.sections.find((section) => section.id === 'extensions')!;
  const kinds = (target.state.jobs as Array<{ kind: string; plugin?: { internalName: string }; internalName?: string }>).map(
    (job) => `${job.kind}:${job.plugin?.internalName ?? job.internalName}`
  );
  assert.deepEqual(kinds.sort(), ['install:Offered', 'update:Older']);
  const reasons = Object.fromEntries(row.failed.map((failure) => [failure.label, failure.reason]));
  assert.match(reasons.Withdrawn, /no longer offers/);
  assert.match(reasons.Adult, /Adult content is switched off/);
  assert.match(reasons.Offline, /could not be reached/);
  assert.equal(row.added, 1, 'only the extension that was actually queued counts as added');
  assert.equal(row.unchanged, 1);
});

test('merge only ever adds exclusions; replace turns sources back on', async () => {
  const source = fakeDeps();
  source.state.disabled.provider = ['A'];
  const file = fileIn();
  serviceFor(source.deps).write(file);

  const merged = fakeDeps();
  merged.state.disabled.provider = ['B'];
  await serviceFor(merged.deps).restore(file, plan('merge', ['extensionSwitches']));
  assert.deepEqual(merged.state.disabled.provider.sort(), ['A', 'B']);

  const replaced = fakeDeps();
  replaced.state.disabled.provider = ['B'];
  await serviceFor(replaced.deps).restore(file, plan('replace', ['extensionSwitches']));
  assert.deepEqual(replaced.state.disabled.provider, ['A']);
});
