import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AppUpdateService, type AppUpdateDeps } from './appUpdateService.ts';

function store() {
  const values = new Map<string, unknown>();
  return {
    values,
    getString: (k: string, d?: string) => (values.has(k) ? (values.get(k) as string) : d),
    setString: (k: string, v: string) => void values.set(k, v),
    getBool: (k: string, d = false) => (values.has(k) ? (values.get(k) as boolean) : d),
    setBool: (k: string, v: boolean) => void values.set(k, v),
    getObject: <T,>(k: string, d: T) => (values.has(k) ? (values.get(k) as T) : d),
    setObject: (k: string, v: unknown) => void values.set(k, v),
  };
}

const releaseList = [
  {
    tag_name: 'v1.4.0',
    published_at: '2026-10-20T10:00:00Z',
    html_url: 'https://github.com/dipenparmar12/cs3/releases/tag/v1.4.0',
    assets: [{ name: 'CS3-1.4.0-windows-x64-installer.exe', size: 90, browser_download_url: 'https://github.com/dl/installer.exe' }],
  },
];

function service(responses: Array<() => Response>, extra: Partial<AppUpdateDeps> = {}) {
  const s = store();
  const requests: Array<RequestInit | undefined> = [];
  const opened: string[] = [];
  const svc = new AppUpdateService({
    store: s,
    fetch: async (_url, init) => {
      requests.push(init);
      return (responses.shift() ?? (() => new Response('[]', { status: 200 })))();
    },
    currentVersion: '1.3.0',
    platform: { os: 'win32', arch: 'x64', kind: 'installed' },
    enabled: true,
    openExternal: (url) => void opened.push(url),
    log: () => {},
    ...extra,
  });
  return { svc, s, requests, opened };
}

const ok = (body: unknown, etag = '"abc"') => () =>
  new Response(JSON.stringify(body), { status: 200, headers: { etag } });

test('a newer release is offered, with the file for this machine', async () => {
  const { svc, opened } = service([ok(releaseList)]);
  const state = await svc.check();
  assert.equal(state.available?.version, '1.4.0');
  assert.deepEqual(state.lastResult, { kind: 'available', version: '1.4.0' });
  assert.equal(await svc.openDownload(), true);
  assert.deepEqual(opened, ['https://github.com/dl/installer.exe']);
});

test('a repeat check sends the ETag and a 304 keeps the last answer', async () => {
  const { svc, requests } = service([ok(releaseList), () => new Response(null, { status: 304 })]);
  await svc.check();
  const second = await svc.check();
  assert.equal((requests[1]?.headers as Record<string, string>)['If-None-Match'], '"abc"');
  assert.equal(second.available?.version, '1.4.0');
});

test('a rate limit backs off and says so; a 404 stops automatic checks', async () => {
  const limited = service([() => new Response('', { status: 403, headers: { 'x-ratelimit-reset': '9999999999' } })]);
  const state = await limited.svc.check();
  assert.equal(state.lastResult?.kind, 'error');
  assert.ok((limited.s.values.get('app_update_last_check') as { backoffUntil: number }).backoffUntil > Date.now());

  const gone = service([() => new Response('', { status: 404 })]);
  assert.equal((await gone.svc.check()).lastResult?.kind, 'unavailable');
  assert.equal((gone.s.values.get('app_update_last_check') as { stoppedForVersion: string }).stoppedForVersion, '1.3.0');
});

test('skip hides the version; switching channel needs no network', async () => {
  const { svc, requests } = service([ok([...releaseList, { ...releaseList[0], tag_name: 'v1.5.0-beta.20261023.1', published_at: '2026-10-23T00:00:00Z', assets: [{ name: 'CS3-1.5.0-beta.20261023.1-windows-x64-installer.exe', size: 1, browser_download_url: 'https://github.com/dl/beta.exe' }] }])]);
  await svc.check();
  assert.equal(svc.skip('1.4.0').available, undefined);
  assert.equal(svc.setSettings({ channel: 'beta' }).available?.version, '1.5.0-beta.20261023.1');
  assert.equal(requests.length, 1);
  svc.dispose();
});

test('a development build never checks', async () => {
  const { svc, requests } = service([ok(releaseList)], { enabled: false });
  const state = await svc.check();
  assert.equal(requests.length, 0);
  assert.equal(state.available, undefined);
});

test('a network failure is reported, never thrown', async () => {
  const { svc } = service([() => { throw new Error('getaddrinfo ENOTFOUND api.github.com'); }]);
  const state = await svc.check();
  assert.equal(state.lastResult?.kind, 'error');
  assert.equal(state.checking, false);
});

const SUM = 'c'.repeat(64);
const withSums = [
  {
    ...releaseList[0],
    assets: [
      ...releaseList[0].assets,
      { name: 'SHA256SUMS.txt', size: 1, browser_download_url: 'https://github.com/dl/SHA256SUMS.txt' },
    ],
  },
];

function downloading(downloadOk: boolean, releases: unknown = withSums) {
  const asked: Array<{ url: string; sha256: string; targetPath: string }> = [];
  const launched: string[] = [];
  const responses = [ok(releases), () => new Response(`${SUM}  CS3-1.4.0-windows-x64-installer.exe\n`, { status: 200 })];
  const harness = service(responses, {
    downloadDir: () => 'C:/Users/me/Downloads',
    downloadVerified: async (input) => {
      asked.push(input);
      input.onProgress(45, 90);
      return downloadOk;
    },
    launchInstaller: (path) => void launched.push(path),
  });
  return { ...harness, asked, launched };
}

test('the download is verified against the published checksum, and only then may it run', async () => {
  const { svc, asked, launched } = downloading(true);
  await svc.check();
  assert.equal(await svc.installUpdate(), false, 'nothing to run before a verified download');
  const state = await svc.downloadUpdate();
  assert.equal(asked[0].sha256, SUM);
  assert.equal(asked[0].targetPath, 'C:/Users/me/Downloads/CS3-1.4.0-windows-x64-installer.exe');
  assert.equal(state.download?.phase, 'verified');
  assert.equal(await svc.installUpdate(), true);
  assert.deepEqual(launched, ['C:/Users/me/Downloads/CS3-1.4.0-windows-x64-installer.exe']);
});

test('a mismatch keeps nothing and opens the release page', async () => {
  const { svc, opened, launched } = downloading(false);
  await svc.check();
  const state = await svc.downloadUpdate();
  assert.equal(state.download?.phase, 'failed');
  assert.match(state.download?.message ?? '', /did not match/);
  assert.deepEqual(opened, ['https://github.com/dipenparmar12/cs3/releases/tag/v1.4.0']);
  assert.equal(await svc.installUpdate(), false);
  assert.deepEqual(launched, []);
});

test('a release without checksums is never downloaded', async () => {
  const { svc, asked } = downloading(true, releaseList);
  await svc.check();
  const state = await svc.downloadUpdate();
  assert.equal(state.download?.phase, 'failed');
  assert.equal(asked.length, 0);
});
