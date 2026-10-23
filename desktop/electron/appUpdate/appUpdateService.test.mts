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
