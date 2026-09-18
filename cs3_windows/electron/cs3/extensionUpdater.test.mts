import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ExtensionUpdater } from './extensionUpdater.ts';
import { TRANSPORT_ERROR_KINDS, isTransportFailure } from './rpcResult.ts';
import type { DatastoreManager } from '../datastore.ts';
import type { PluginManager } from '../pluginManager.ts';
import type { SitePlugin } from '../../src/types/plugin.ts';

/**
 * Over-the-air extension updates, and the three ways they stopped working.
 *
 * All three were found by reading a real installation rather than a bug report,
 * and all three are silent — the UI reports a successful update in every one of
 * them:
 *
 * 1. **"Update all" read a stale cache.** Measured on that install: the stored
 *    list held 3 entries while a live check found 94. The button updated three
 *    extensions, said "Updated all 3", and left 91 out of date.
 * 2. **An update installed into the wrong directory.** One repository is known
 *    by two URL strings — the curated project page and the raw document it
 *    resolves to — and `installPathFor` keys the directory on the string. The
 *    same install had 311 archives on disk for 219 records, and no backup was
 *    taken for any extension whose record carried the other spelling.
 * 3. **A timeout was reported as a broken extension.** `inspect` turned every
 *    failed RPC into `T4_BLOCKED`, which the updater reads as "does not load"
 *    and rolls back — undoing an update that had downloaded, verified its
 *    SHA-256 and written cleanly.
 */

// --- fakes -----------------------------------------------------------------

function fakeDatastore(): DatastoreManager {
  const store = new Map<string, unknown>();
  return {
    getObject: <T,>(key: string, fallback: T): T => (store.get(key) as T) ?? fallback,
    setObject: (key: string, value: unknown) => store.set(key, value),
  } as unknown as DatastoreManager;
}

interface PluginsOptions {
  repositories: string[];
  /** repositoryUrl -> the plugins it publishes. */
  catalogue: Record<string, SitePlugin[]>;
  installed: Array<{ internalName: string; version: number; meta: SitePlugin }>;
  /** Archives that exist on disk, as `${repoUrl}|${internalName}`. */
  present?: Set<string>;
  verify?: (internalName: string) => { ok: boolean; message: string; tier?: string };
}

function fakePlugins(options: PluginsOptions) {
  const calls = {
    installed: [] as Array<{ internalName: string; repoUrl: string; version?: number }>,
    preserved: [] as string[],
    rolledBack: [] as string[],
    fetched: [] as string[],
  };

  const present = options.present ?? new Set<string>();

  const plugins = {
    getInstalledRepositories: () => options.repositories,
    getInstalledPluginRecords: () => options.installed,
    fetchRepository: async (url: string) => {
      calls.fetched.push(url);
      const list = options.catalogue[url];
      if (!list) throw new Error(`no such repository: ${url}`);
      return { repositoryUrl: url, name: url, plugins: list, warnings: [] };
    },
    preserveInstalledVersion: (repoUrl: string, internalName: string) => {
      calls.preserved.push(`${repoUrl}|${internalName}`);
      return present.has(`${repoUrl}|${internalName}`);
    },
    installPlugin: async (plugin: SitePlugin, repoUrl: string) => {
      calls.installed.push({
        internalName: plugin.internalName,
        repoUrl,
        version: plugin.version,
      });
      present.add(`${repoUrl}|${plugin.internalName}`);
      return { ok: true, message: 'installed' };
    },
    verifyInstalledPlugin: async (internalName: string) =>
      options.verify?.(internalName) ?? { ok: true, message: 'loads', tier: 'T1_DROPIN' },
    archivePathFor: (repoUrl: string, internalName: string) => `${repoUrl}/${internalName}.cs3`,
    rollbackPlugin: async (repoUrl: string, internalName: string) => {
      calls.rolledBack.push(`${repoUrl}|${internalName}`);
      return { ok: true, message: 'restored' };
    },
  };

  return { plugins: plugins as unknown as PluginManager, calls };
}

const RAW = 'https://raw.githubusercontent.com/owner/repo/builds/repo.json';
const PAGE = 'https://github.com/owner/repo';

const remote = (over: Partial<SitePlugin> = {}): SitePlugin => ({
  internalName: 'ShowBox',
  name: 'ShowBox',
  url: `${RAW}/ShowBox.cs3`,
  status: 1,
  version: 8,
  fileHash: 'bbbb',
  ...over,
});

const local = (over: Partial<SitePlugin> = {}) => ({
  internalName: 'ShowBox',
  version: 6,
  meta: { ...remote({ version: 6, fileHash: 'aaaa' }), repositoryUrl: RAW, ...over },
});

// --- 1: "update everything" means everything out of date now ----------------

test('update-all re-checks rather than trusting a persisted snapshot', async () => {
  const datastore = fakeDatastore();
  // What a real install looked like: one stale entry cached, more available.
  datastore.setObject('extension_available_updates', [
    { internalName: 'Stale', name: 'Stale', installedVersion: 1, availableVersion: 2,
      repositoryUrl: RAW, downloadUrl: 'x', reason: 'newer' },
  ]);

  const { plugins, calls } = fakePlugins({
    repositories: [RAW],
    catalogue: { [RAW]: [remote(), remote({ internalName: 'Second', name: 'Second', version: 4 })] },
    installed: [
      local(),
      { internalName: 'Second', version: 3, meta: { ...remote({ internalName: 'Second', version: 3 }), repositoryUrl: RAW } },
    ],
  });

  const outcomes = await new ExtensionUpdater(datastore, plugins).updateAll();
  const names = calls.installed.map((c) => c.internalName).sort();

  assert.deepEqual(
    names,
    ['Second', 'ShowBox'],
    'the live check finds both; the cached snapshot named neither'
  );
  assert.ok(
    !names.includes('Stale'),
    'and the stale entry, which no repository still offers, is not attempted'
  );
  assert.equal(outcomes.length, 2);
});

// --- 2: install where the extension actually lives --------------------------

test('an update replaces the installed archive, not one beside it', async () => {
  // The record was stamped with the project-page URL — what the curated list
  // stores — while the check iterates the raw document it resolves to.
  const { plugins, calls } = fakePlugins({
    repositories: [RAW],
    catalogue: { [RAW]: [remote()] },
    installed: [local({ repositoryUrl: PAGE })],
    present: new Set([`${PAGE}|ShowBox`]),
  });

  const updater = new ExtensionUpdater(fakeDatastore(), plugins);
  const outcome = await updater.updatePlugin('ShowBox');

  assert.equal(outcome.ok, true);
  assert.equal(
    calls.installed[0].repoUrl,
    PAGE,
    'installing under the other spelling writes a second archive and orphans the first'
  );
  assert.deepEqual(
    calls.preserved,
    [`${PAGE}|ShowBox`],
    'and the backup has to be taken where the archive actually is, or there is none'
  );
});

test('the new bytes still come from the repository that published them', async () => {
  const { plugins, calls } = fakePlugins({
    repositories: [RAW],
    catalogue: { [RAW]: [remote({ version: 9, url: `${RAW}/ShowBox-v9.cs3` })] },
    installed: [local({ repositoryUrl: PAGE })],
    present: new Set([`${PAGE}|ShowBox`]),
  });

  await new ExtensionUpdater(fakeDatastore(), plugins).updatePlugin('ShowBox');

  assert.ok(calls.fetched.includes(RAW), 'the download is resolved against the live repository');
  assert.equal(calls.installed[0].version, 9, 'and it is the version that repository publishes');
});

test('a rollback goes back to where the archive lives', async () => {
  const { plugins, calls } = fakePlugins({
    repositories: [RAW],
    catalogue: { [RAW]: [remote()] },
    installed: [local({ repositoryUrl: PAGE })],
    present: new Set([`${PAGE}|ShowBox`]),
    verify: () => ({ ok: false, message: 'missing classes', tier: 'T4_BLOCKED' }),
  });

  const outcome = await new ExtensionUpdater(fakeDatastore(), plugins).updatePlugin('ShowBox');

  assert.equal(outcome.ok, false);
  assert.deepEqual(
    calls.rolledBack,
    [`${PAGE}|ShowBox`],
    'a rollback aimed at the other spelling restores nothing and reports success'
  );
});

// --- 3: which repository supplies an update ---------------------------------

test('at equal standing the repository the extension came from wins', async () => {
  const OTHER = 'https://raw.githubusercontent.com/mirror/repo/repo.json';
  const { plugins } = fakePlugins({
    // The mirror is iterated first, so without the preference it would win on
    // arrival order alone.
    repositories: [OTHER, RAW],
    catalogue: {
      [OTHER]: [remote({ url: `${OTHER}/ShowBox.cs3` })],
      [RAW]: [remote({ url: `${RAW}/ShowBox.cs3` })],
    },
    installed: [local()],
  });

  const result = await new ExtensionUpdater(fakeDatastore(), plugins).checkForUpdates();

  assert.equal(result.updates.length, 1);
  assert.equal(
    result.updates[0].repositoryUrl,
    RAW,
    'which repository supplies an update must not depend on fetch ordering'
  );
});

test('a genuinely higher version still wins, wherever it is published', async () => {
  const OTHER = 'https://raw.githubusercontent.com/mirror/repo/repo.json';
  const { plugins } = fakePlugins({
    repositories: [RAW, OTHER],
    catalogue: {
      [RAW]: [remote({ version: 8 })],
      [OTHER]: [remote({ version: 12, url: `${OTHER}/ShowBox.cs3` })],
    },
    installed: [local()],
  });

  const result = await new ExtensionUpdater(fakeDatastore(), plugins).checkForUpdates();
  assert.equal(result.updates[0].availableVersion, 12);
  assert.equal(result.updates[0].repositoryUrl, OTHER, 'preference is a tie-break, not a veto');
});

// --- 4: a republished artifact is an update --------------------------------

test('the same version with different bytes is offered, and only with both hashes', async () => {
  const { plugins } = fakePlugins({
    repositories: [RAW],
    catalogue: {
      [RAW]: [
        remote({ version: 6, fileHash: 'sha256-BBBB' }),
        remote({ internalName: 'NoHashes', name: 'NoHashes', version: 3, fileHash: undefined }),
      ],
    },
    installed: [
      local(),
      { internalName: 'NoHashes', version: 3, meta: { ...remote({ internalName: 'NoHashes', version: 3, fileHash: undefined }), repositoryUrl: RAW } },
    ],
  });

  const result = await new ExtensionUpdater(fakeDatastore(), plugins).checkForUpdates();
  const names = result.updates.map((u) => u.internalName);

  assert.deepEqual(names, ['ShowBox']);
  assert.equal(result.updates[0].reason, 'republished');
  assert.ok(
    !names.includes('NoHashes'),
    'a repository publishing no hash gives nothing to compare; treating that as changed would re-download the catalogue forever'
  );
});

// --- 5: a transport failure is not a verdict --------------------------------

test('the runtime failing to answer is never the extension failing to load', () => {
  // `inspect` used to flatten all of these into `T4_BLOCKED`, which the updater
  // acts on by rolling back a good update.
  for (const kind of ['TIMEOUT', 'SIDECAR_UNAVAILABLE', 'SIDECAR_CRASHED', 'SIDECAR_STOPPED']) {
    assert.equal(isTransportFailure({ ok: false, errorKind: kind }), true, kind);
    assert.ok(TRANSPORT_ERROR_KINDS.has(kind));
  }
});

test('a verdict from the runtime is still a verdict', () => {
  // The sidecar answering "I looked and it does not link" must keep failing the
  // update — that check is the whole reason the backup is taken.
  assert.equal(isTransportFailure({ ok: false, errorKind: 'PROVIDER_NOT_LOADED' }), false);
  assert.equal(isTransportFailure({ ok: false, errorKind: undefined }), false);
  assert.equal(isTransportFailure({ ok: true }), false);
});
