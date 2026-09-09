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

