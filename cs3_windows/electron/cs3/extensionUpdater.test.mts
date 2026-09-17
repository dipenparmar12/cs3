import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ExtensionUpdater, type AvailableUpdate } from './extensionUpdater.ts';
import type { DatastoreManager } from '../datastore.ts';
import type { PluginManager } from '../pluginManager.ts';
import type { SitePlugin } from '../../src/types/plugin.ts';

class FakeDatastore {
  private data = new Map<string, unknown>();

  getObject<T>(key: string, defaultValue: T): T {
    return (this.data.get(key) as T) ?? defaultValue;
  }

  setObject(key: string, value: unknown): void {
    this.data.set(key, value);
  }
}

test('ExtensionUpdater.checkForUpdates finds higher versions and stores artifact metadata', async () => {
  const datastore = new FakeDatastore();
  const mockInstalled: Array<{ internalName: string; version: number; meta: SitePlugin }> = [
    {
      internalName: 'AllMovieLandProvider',
      version: 23,
      meta: {
        internalName: 'AllMovieLandProvider',
        name: 'AllMovieLandProvider',
        version: 23,
        status: 1,
        url: 'https://example.test/AllMovieLandProvider.cs3',
      },
    },
    {
      internalName: 'UpToDateProvider',
      version: 10,
      meta: {
        internalName: 'UpToDateProvider',
        name: 'UpToDateProvider',
        version: 10,
        status: 1,
        url: 'https://example.test/UpToDate.cs3',
      },
    },
  ];

  const mockRepoPlugins: SitePlugin[] = [
    {
      internalName: 'AllMovieLandProvider',
      name: 'AllMovieLandProvider',
      version: 25,
      status: 1,
      url: 'https://example.test/AllMovieLandProvider.cs3',
      fileHash: 'sha256-5b9ce3b',
      jarUrl: 'https://example.test/AllMovieLandProvider.jar',
      jarHash: 'sha256-c75e73b',
      jarFileSize: 297020,
    },
    {
      internalName: 'UpToDateProvider',
      name: 'UpToDateProvider',
      version: 10,
      status: 1,
      url: 'https://example.test/UpToDate.cs3',
    },
  ];

  const fakePlugins = {
    getInstalledRepositories: () => ['https://example.test/repo.json'],
    getInstalledPluginRecords: () => mockInstalled,
    fetchRepository: async () => ({
      repositoryUrl: 'https://example.test/repo.json',
      name: 'Test Repo',
      plugins: mockRepoPlugins,
      warnings: [],
    }),
  } as unknown as PluginManager;

  const updater = new ExtensionUpdater(datastore as unknown as DatastoreManager, fakePlugins);
  const result = await updater.checkForUpdates();

  assert.equal(result.updates.length, 1, 'Only outdated plugin is reported as update');
  const update = result.updates[0];
  assert.equal(update.internalName, 'AllMovieLandProvider');
  assert.equal(update.installedVersion, 23);
  assert.equal(update.availableVersion, 25);
  assert.equal(update.fileHash, 'sha256-5b9ce3b');
  assert.equal(update.jarUrl, 'https://example.test/AllMovieLandProvider.jar');
  assert.equal(update.jarHash, 'sha256-c75e73b');
  assert.equal(update.jarFileSize, 297020);

  const cached = updater.getCachedUpdates();
  assert.equal(cached.length, 1);
  assert.equal(cached[0].internalName, 'AllMovieLandProvider');
});

test('ExtensionUpdater.updatePlugin drops cached update on successful installation', async () => {
  const datastore = new FakeDatastore();
  const cachedUpdates: AvailableUpdate[] = [
    {
      internalName: 'AllMovieLandProvider',
      name: 'AllMovieLandProvider',
      installedVersion: 23,
      availableVersion: 25,
      repositoryUrl: 'https://example.test/repo.json',
      downloadUrl: 'https://example.test/AllMovieLandProvider.cs3',
      fileHash: 'sha256-5b9ce3b',
      reason: 'newer',
    },
  ];
  datastore.setObject('extension_available_updates', cachedUpdates);

  let preservedCalled = false;
  let installCalledWith: SitePlugin | null = null;
  let verifiedCalled = false;

  const fakePlugins = {
    fetchRepository: async () => ({
      repositoryUrl: 'https://example.test/repo.json',
      name: 'Test Repo',
      plugins: [
        {
          internalName: 'AllMovieLandProvider',
          name: 'AllMovieLandProvider',
          version: 25,
          status: 1,
          url: 'https://example.test/AllMovieLandProvider.cs3',
          fileHash: 'sha256-5b9ce3b',
        },
      ],
      warnings: [],
    }),
    preserveInstalledVersion: () => {
      preservedCalled = true;
      return true;
    },
    installPlugin: async (plugin: SitePlugin) => {
      installCalledWith = plugin;
      return { ok: true, message: 'installed' };
    },
    archivePathFor: () => 'C:/fake/path.cs3',
    verifyInstalledPlugin: async () => {
      verifiedCalled = true;
      return { ok: true, tier: 'T3_DEGRADED', message: 'loads' };
    },
  } as unknown as PluginManager;

  const updater = new ExtensionUpdater(datastore as unknown as DatastoreManager, fakePlugins);
  const outcome = await updater.updatePlugin('AllMovieLandProvider');

  assert.ok(outcome.ok);
  assert.equal(outcome.fromVersion, 23);
  assert.equal(outcome.toVersion, 25);
  assert.ok(preservedCalled);
  assert.ok(verifiedCalled);
  assert.ok(installCalledWith);
  assert.equal((installCalledWith as SitePlugin).fileHash, 'sha256-5b9ce3b');
  assert.equal(updater.getCachedUpdates().length, 0, 'Cached update is cleared upon success');
});

test('ExtensionUpdater.updatePlugin triggers rollback and retains cache if verification fails', async () => {
  const datastore = new FakeDatastore();
  const cachedUpdates: AvailableUpdate[] = [
    {
      internalName: 'BrokenProvider',
      name: 'BrokenProvider',
      installedVersion: 1,
      availableVersion: 2,
      repositoryUrl: 'https://example.test/repo.json',
      downloadUrl: 'https://example.test/Broken.cs3',
      reason: 'newer',
    },
  ];
  datastore.setObject('extension_available_updates', cachedUpdates);

  let rolledBack = false;

  const fakePlugins = {
    fetchRepository: async () => {
      throw new Error('network down');
    },
    preserveInstalledVersion: () => true,
    installPlugin: async () => ({ ok: true, message: 'written' }),
    archivePathFor: () => 'C:/fake/path.cs3',
    verifyInstalledPlugin: async () => ({
      ok: false,
      tier: 'T4_BLOCKED',
      message: 'missing critical class',
    }),
    rollbackPlugin: async () => {
      rolledBack = true;
      return { ok: true, message: 'restored' };
    },
  } as unknown as PluginManager;

  const updater = new ExtensionUpdater(datastore as unknown as DatastoreManager, fakePlugins);
  const outcome = await updater.updatePlugin('BrokenProvider');

  assert.equal(outcome.ok, false);
  assert.ok(rolledBack, 'Rollback was performed');
  assert.match(outcome.message, /v1 has been restored/);
  assert.equal(updater.getCachedUpdates().length, 1, 'Cached update is kept because update failed');
});

test('ExtensionUpdater.updatePlugin retains cache and returns failure if verification fails even without previous backup', async () => {
  const datastore = new FakeDatastore();
  const cachedUpdates: AvailableUpdate[] = [
    {
      internalName: 'UnpreservedProvider',
      name: 'UnpreservedProvider',
      installedVersion: 1,
      availableVersion: 2,
      repositoryUrl: 'https://example.test/repo.json',
      downloadUrl: 'https://example.test/Unpreserved.cs3',
      reason: 'newer',
    },
  ];
  datastore.setObject('extension_available_updates', cachedUpdates);

  const fakePlugins = {
    fetchRepository: async () => {
      throw new Error('network down');
    },
    preserveInstalledVersion: () => false,
    installPlugin: async () => ({ ok: true, message: 'written' }),
    archivePathFor: () => 'C:/fake/path.cs3',
    verifyInstalledPlugin: async () => ({
      ok: false,
      tier: 'T4_BLOCKED',
      message: 'verification failed',
    }),
    rollbackPlugin: async () => ({ ok: false, message: 'no backup' }),
  } as unknown as PluginManager;

  const updater = new ExtensionUpdater(datastore as unknown as DatastoreManager, fakePlugins);
  const outcome = await updater.updatePlugin('UnpreservedProvider');

  assert.equal(outcome.ok, false);
  assert.match(outcome.message, /verification failed/);
  assert.equal(updater.getCachedUpdates().length, 1, 'Cached update is kept even when no backup was preserved');
});


/**
 * A maintainer fixing a scraper without bumping the version is the ordinary
 * case in this ecosystem, not an edge one. Version-only comparison reported
 * "up to date" for exactly the extensions that had stopped working.
 */
test('ExtensionUpdater.checkForUpdates offers a republished archive at the same version', async () => {
  const datastore = new FakeDatastore();

  const fakePlugins = {
    getInstalledRepositories: () => ['https://example.test/repo.json'],
    getInstalledPluginRecords: () => [
      {
        internalName: 'RepublishedProvider',
        version: 7,
        meta: {
          internalName: 'RepublishedProvider',
          name: 'RepublishedProvider',
          version: 7,
          status: 1,
          url: 'https://example.test/Republished.cs3',
          fileHash: 'sha256-AAAA',
        },
      },
      {
        internalName: 'UntouchedProvider',
        version: 3,
        meta: {
          internalName: 'UntouchedProvider',
          name: 'UntouchedProvider',
          version: 3,
          status: 1,
          url: 'https://example.test/Untouched.cs3',
          fileHash: 'sha256-CCCC',
        },
      },
      {
        internalName: 'NoHashProvider',
        version: 2,
        meta: {
          internalName: 'NoHashProvider',
          name: 'NoHashProvider',
          version: 2,
          status: 1,
          url: 'https://example.test/NoHash.cs3',
        },
      },
    ],
    fetchRepository: async () => ({
      repositoryUrl: 'https://example.test/repo.json',
      name: 'Test Repo',
      plugins: [
        {
          internalName: 'RepublishedProvider',
          name: 'RepublishedProvider',
          version: 7,
          status: 1,
          url: 'https://example.test/Republished.cs3',
          // Same version, different bytes: the prefix and case differ from the
          // installed record's spelling too, which must not read as a change.
          fileHash: 'BBBB',
        },
        {
          internalName: 'UntouchedProvider',
          name: 'UntouchedProvider',
          version: 3,
          status: 1,
          url: 'https://example.test/Untouched.cs3',
          fileHash: 'sha256-cccc',
        },
        {
          internalName: 'NoHashProvider',
          name: 'NoHashProvider',
          version: 2,
          status: 1,
          url: 'https://example.test/NoHash.cs3',
        },
      ],
      warnings: [],
    }),
  } as unknown as PluginManager;

  const updater = new ExtensionUpdater(datastore as unknown as DatastoreManager, fakePlugins);
  const result = await updater.checkForUpdates();

  assert.deepEqual(
    result.updates.map((u) => u.internalName),
    ['RepublishedProvider'],
    'Only the archive whose published bytes changed is offered'
  );
  assert.equal(result.updates[0].reason, 'republished');
  assert.equal(result.updates[0].availableVersion, 7);
});

test('ExtensionUpdater.updatePlugin resolves from the repository when nothing is cached', async () => {
  const datastore = new FakeDatastore();
  let installed: SitePlugin | null = null;
  const fetched: string[] = [];

  const fakePlugins = {
    getInstalledRepositories: () => [
      'https://example.test/other.json',
      'https://example.test/repo.json',
    ],
    getInstalledPluginRecords: () => [
      {
        internalName: 'ColdCacheProvider',
        version: 4,
        meta: {
          internalName: 'ColdCacheProvider',
          name: 'ColdCacheProvider',
          version: 4,
          status: 1,
          url: 'https://example.test/Cold.cs3',
          repositoryUrl: 'https://example.test/repo.json',
        },
      },
    ],
    fetchRepository: async (url: string) => {
      fetched.push(url);
      return {
        repositoryUrl: url,
        name: 'Test Repo',
        plugins: [
          {
            internalName: 'ColdCacheProvider',
            name: 'ColdCacheProvider',
            version: 9,
            status: 1,
            url: 'https://example.test/Cold-9.cs3',
            fileHash: 'sha256-9999',
          },
        ],
        warnings: [],
      };
    },
    preserveInstalledVersion: () => true,
    installPlugin: async (plugin: SitePlugin) => {
      installed = plugin;
      return { ok: true, message: 'installed' };
    },
    archivePathFor: () => 'C:/fake/path.cs3',
    verifyInstalledPlugin: async () => ({ ok: true, tier: 'T1_DROPIN', message: 'loads' }),
  } as unknown as PluginManager;

  const updater = new ExtensionUpdater(datastore as unknown as DatastoreManager, fakePlugins);
  const outcome = await updater.updatePlugin('ColdCacheProvider');

  assert.ok(outcome.ok, outcome.message);
  assert.equal(outcome.fromVersion, 4);
  assert.equal(outcome.toVersion, 9);
  assert.ok(installed, 'The install path was reached without a prior check');
  // The extension's own repository is asked first, not whichever is listed first.
  assert.equal(fetched[0], 'https://example.test/repo.json');
});

test('ExtensionUpdater.updateAll checks for updates when the cache is cold', async () => {
  const datastore = new FakeDatastore();
  const updated: string[] = [];

  const fakePlugins = {
    getInstalledRepositories: () => ['https://example.test/repo.json'],
    getInstalledPluginRecords: () => [
      {
        internalName: 'StaleProvider',
        version: 1,
        meta: {
          internalName: 'StaleProvider',
          name: 'StaleProvider',
          version: 1,
          status: 1,
          url: 'https://example.test/Stale.cs3',
        },
      },
    ],
    fetchRepository: async () => ({
      repositoryUrl: 'https://example.test/repo.json',
      name: 'Test Repo',
      plugins: [
        {
          internalName: 'StaleProvider',
          name: 'StaleProvider',
          version: 2,
          status: 1,
          url: 'https://example.test/Stale-2.cs3',
        },
      ],
      warnings: [],
    }),
    preserveInstalledVersion: () => true,
    installPlugin: async (plugin: SitePlugin) => {
      updated.push(plugin.internalName);
      return { ok: true, message: 'installed' };
    },
    archivePathFor: () => 'C:/fake/path.cs3',
    verifyInstalledPlugin: async () => ({ ok: true, tier: 'T1_DROPIN', message: 'loads' }),
  } as unknown as PluginManager;

  const updater = new ExtensionUpdater(datastore as unknown as DatastoreManager, fakePlugins);
  const outcomes = await updater.updateAll();

  assert.deepEqual(updated, ['StaleProvider'], 'Update all found the update it had not checked for');
  assert.equal(outcomes.length, 1);
  assert.ok(outcomes[0].ok);
});

/**
 * The maintainer's own status is this ecosystem's entire health mechanism, and
 * the update check has been re-fetching it on every run and discarding it. A
 * user debugging a provider its author has already declared broken is the
 * failure it prevents.
 */
test('ExtensionUpdater.checkForUpdates reports extensions their maintainer marked down', async () => {
  const datastore = new FakeDatastore();

  const fakePlugins = {
    getInstalledRepositories: () => ['https://a.test/repo.json', 'https://b.test/repo.json'],
    getInstalledPluginRecords: () => [
      {
        internalName: 'BrokenSite',
        version: 4,
        meta: { internalName: 'BrokenSite', name: 'BrokenSite', version: 4, status: 1, url: 'x' },
      },
      {
        internalName: 'HealthySite',
        version: 2,
        meta: { internalName: 'HealthySite', name: 'HealthySite', version: 2, status: 1, url: 'y' },
      },
      {
        internalName: 'SlowSite',
        version: 1,
        meta: { internalName: 'SlowSite', name: 'SlowSite', version: 1, status: 1, url: 'z' },
      },
    ],
    fetchRepository: async (url: string) => ({
      repositoryUrl: url,
      name: url,
      plugins: [
        // Published by both repositories, down in both: one notice, not two.
        { internalName: 'BrokenSite', name: 'BrokenSite', version: 4, status: 0, url: 'x' },
        { internalName: 'HealthySite', name: 'HealthySite', version: 2, status: 1, url: 'y' },
        // Slow is a ranking input, not a notice: it still works.
        { internalName: 'SlowSite', name: 'SlowSite', version: 1, status: 2, url: 'z' },
        // Down, but not installed — not this user's problem.
        { internalName: 'NotInstalled', name: 'NotInstalled', version: 9, status: 0, url: 'q' },
      ],
      warnings: [],
    }),
  } as unknown as PluginManager;

  const updater = new ExtensionUpdater(datastore as unknown as DatastoreManager, fakePlugins);
  const result = await updater.checkForUpdates();

  assert.deepEqual(
    result.notices.map((notice) => notice.internalName),
    ['BrokenSite']
  );
  assert.match(result.notices[0].message, /marked as not working by its maintainer/);
  assert.equal(result.updates.length, 0, 'A down status is not itself an update');
});
