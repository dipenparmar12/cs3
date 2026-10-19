/**
 * The deep smoke steps call the bridge the UI calls, in order, and stop saying
 * why — checked against a stubbed `window.cloudstream`.
 *
 *   node --experimental-strip-types electron/smokeDeep.test.mts
 */
import assert from 'node:assert/strict';
import { deepSteps, deepTarget } from './smokeDeep.ts';

type Stub = Record<string, (...args: unknown[]) => unknown>;
type Win = Parameters<typeof deepSteps>[0];

const BRIDGE = /^window\.cloudstream\[("[^"]+")\]\(\.\.\.(.*)\)$/s;

/** A window whose page answers bridge calls from `stub` and plays anything handed to a `<video>`. */
function fakeWindow(stub: Stub, calls: string[], element = { ok: true, detail: '1920x800, 2.0s played' }): Win {
  return {
    webContents: {
      executeJavaScript: async (code: string) => {
        const call = BRIDGE.exec(code);
        if (!call) {
          calls.push('<video>');
          return element;
        }
        const method = JSON.parse(call[1]) as string;
        calls.push(method);
        const fn = stub[method];
        if (!fn) throw new Error(`unexpected bridge call ${method}`);
        return fn(...(JSON.parse(call[2]) as unknown[]));
      },
    },
  } as unknown as Win;
}

const TARGET = { repository: 'https://repo.example/repo.json', plugin: 'MovieBoxProvider', query: 'Interstellar' };
const SOURCE = {
  infoHash: '',
  magnet: '',
  title: 'Interstellar 1080p',
  directUrl: 'https://cdn.example/interstellar.mp4',
  directHeaders: { Referer: 'https://moviebox.example/' },
  sizeBytes: 0,
  seeders: 1,
  leechers: 0,
  indexerId: 'MovieBox',
  indexerName: 'MovieBox',
  providerName: 'MovieBox',
  parsed: {},
  score: 0,
  scoreReasons: [],
  query: 'Interstellar',
};

function working(overrides: Stub = {}): Stub {
  let queued = 0;
  return {
    fetchRepository: () => ({ ok: true, repository: { plugins: [{ internalName: 'MovieBoxProvider', name: 'MovieBox', version: 7 }] } }),
    installPlugin: () => ({ ok: true, message: 'Installed', report: { recommendedTier: 'T1_DROPIN' } }),
    getExtensionProviders: () => ({ ok: true, providers: [{ name: 'MovieBox', pluginInternalName: 'MovieBoxProvider' }] }),
    searchAll: (query: unknown, options: unknown) => {
      assert.equal(query, 'Interstellar');
      assert.deepEqual(options, { providers: ['MovieBox'] }, 'the search is scoped to the extension under test');
      return { ok: true, results: [{ name: 'Interstellar', url: 'cs3ext://MovieBox/1', apiName: 'MovieBox', type: 'Movie', year: 2014 }] };
    },
    loadMedia: () => ({ ok: true, detail: { name: 'Interstellar', type: 'Movie', url: 'cs3ext://MovieBox/1' } }),
    getSources: (request: unknown) => {
      assert.deepEqual(request, { mediaUrl: 'cs3ext://MovieBox/1' });
      return { ok: true, sources: [SOURCE] };
    },
    preparePlaybackStream: (request: unknown) => {
      assert.deepEqual((request as { headers: unknown }).headers, SOURCE.directHeaders, "the provider's headers travel with the link");
      return { ok: true, playbackUrl: 'http://127.0.0.1:5000/s/abc', sessionId: 'abc', capability: { requiredStrategy: 'REMUX_CONTAINER' } };
    },
    closePlaybackStream: () => ({ ok: true }),
    requestDownload: (task: unknown) => {
      assert.equal((task as { providerName: string }).providerName, 'MovieBox');
      return { ok: true, action: 'started', taskId: 'task-1', message: 'Downloading' };
    },
    getDownloadQueue: () => [{ id: 'task-1', state: 'Downloading', bytesDownloaded: (queued += 1) * 1.5 * 1048576 }],
    removeDownload: () => undefined,
    ...overrides,
  };
}

async function runAll(win: Win, launch: number): Promise<Array<{ id: string; ok: boolean; detail: string }>> {
  const out = [];
  for (const step of deepSteps(win, launch, TARGET)) {
    const outcome = await step.run();
    out.push({ id: step.id, ...outcome });
    if (!outcome.ok) break;
  }
  return out;
}

const tests: Array<[string, () => Promise<void> | void]> = [];
const test = (name: string, fn: () => Promise<void> | void) => tests.push([name, fn]);

test('the default target is one measured working, and each part can be overridden', () => {
  assert.equal(deepTarget({}).plugin, 'MovieBoxProvider');
  assert.match(deepTarget({}).repository, /phisher98/);
  assert.deepEqual(deepTarget({ CS3_SMOKE_DEEP_PLUGIN: 'X', CS3_SMOKE_DEEP_QUERY: 'Dune', CS3_SMOKE_DEEP_REPO: 'https://r' }), {
    repository: 'https://r',
    plugin: 'X',
    query: 'Dune',
  });
});

test('a working extension goes install → load → search → details → links → play → download, through the bridge', async () => {
  const calls: string[] = [];
  const results = await runAll(fakeWindow(working(), calls), 1);
  assert.deepEqual(results.map((r) => r.id), ['ext-install', 'ext-load', 'search', 'details', 'links', 'play', 'play-in-app', 'download']);
  assert.ok(results.every((r) => r.ok), JSON.stringify(results));
  assert.ok(calls.includes('<video>'), 'a converted stream is played in a real <video>');
  assert.ok(calls.includes('closePlaybackStream') && calls.includes('removeDownload'), 'the smoke test cleans up after itself');
});

test('the restart checks the extension is still there and still searches — nothing is installed again', async () => {
  const calls: string[] = [];
  const results = await runAll(fakeWindow(working(), calls), 2);
  assert.deepEqual(results.map((r) => r.id), ['ext-kept', 'search-again']);
  assert.ok(results.every((r) => r.ok), JSON.stringify(results));
  assert.ok(!calls.includes('installPlugin'));
});

test('a plugin missing from the repository stops at install and says so', async () => {
  const results = await runAll(fakeWindow(working({ fetchRepository: () => ({ ok: true, repository: { plugins: [] } }) }), []), 1);
  assert.equal(results.length, 1);
  assert.equal(results[0].ok, false);
  assert.match(results[0].detail, /MovieBoxProvider is not in/);
});

test('mpv is asked to play, polled until it has, and stopped; then the same link plays in the app', async () => {
  const calls: string[] = [];
  let position = 0;
  const stub = working({
    preparePlaybackStream: (request: unknown) =>
      (request as { avoidNativeEngine?: boolean }).avoidNativeEngine
        ? { ok: true, playbackUrl: 'http://127.0.0.1:5000/c', sessionId: 'c', capability: { requiredStrategy: 'VIDEO_TRANSCODE' } }
        : { ok: true, playbackUrl: 'http://127.0.0.1:5000/p', sessionId: '', capability: { requiredStrategy: 'NATIVE_MPV' } },
    openInNativeEngine: () => ({ ok: true }),
    getMpvSnapshot: () => ({ ok: true, snapshot: { positionSeconds: (position += 1.5), videoCodec: 'hevc', hardwareDecoder: 'd3d11va' } }),
    mpvStop: () => ({ ok: true }),
  });
  const results = await runAll(fakeWindow(stub, calls), 1);
  const play = results.find((r) => r.id === 'play')!;
  assert.ok(play.ok, play.detail);
  assert.match(play.detail, /mpv played 3\.0s \(hevc, d3d11va\)/);
  assert.ok(calls.includes('mpvStop'));
  const inApp = results.find((r) => r.id === 'play-in-app')!;
  assert.ok(inApp.ok, inApp.detail);
  assert.match(inApp.detail, /^VIDEO_TRANSCODE — /, 'the second engine is the conversion path');
  assert.equal(calls.filter((c) => c === '<video>').length, 1);
});

test('"play in the app" sends the player\'s own request, and mpv as its answer is a failure', async () => {
  const requests: Array<Record<string, unknown>> = [];
  const stub = working({
    preparePlaybackStream: (request: unknown) => {
      requests.push(request as Record<string, unknown>);
      return { ok: true, playbackUrl: 'http://127.0.0.1:5000/p', sessionId: 's', capability: { requiredStrategy: 'NATIVE_MPV' } };
    },
    openInNativeEngine: () => ({ ok: true }),
    getMpvSnapshot: () => ({ ok: true, snapshot: { positionSeconds: 3, videoCodec: 'h264', hardwareDecoder: '' } }),
    mpvStop: () => ({ ok: true }),
  });
  const results = await runAll(fakeWindow(stub, []), 1);
  const inApp = results.at(-1)!;
  assert.equal(inApp.id, 'play-in-app');
  assert.equal(inApp.ok, false);
  assert.match(inApp.detail, /handed to mpv/);
  assert.deepEqual(
    { refresh: requests[1].refresh, force: requests[1].force, avoidNativeEngine: requests[1].avoidNativeEngine },
    { refresh: true, force: true, avoidNativeEngine: true }
  );
  assert.equal(requests[0].force, undefined, 'the first attempt is an ordinary play press');
});

test('a link that will not play is reported with every attempt, and the download is not tried', async () => {
  const results = await runAll(fakeWindow(working(), [], { ok: false, detail: 'the element refused it: MEDIA_ERR_SRC_NOT_SUPPORTED' }), 1);
  const last = results.at(-1)!;
  assert.equal(last.id, 'play');
  assert.equal(last.ok, false);
  assert.match(last.detail, /REMUX_CONTAINER — the element refused it/);
});

test('a download that fails is a failure, not a timeout', async () => {
  const results = await runAll(
    fakeWindow(working({ getDownloadQueue: () => [{ id: 'task-1', state: 'Failed', errorMessage: 'HTTP 403', bytesDownloaded: 0 }] }), []),
    1
  );
  const last = results.at(-1)!;
  assert.equal(last.id, 'download');
  assert.equal(last.ok, false);
  assert.equal(last.detail, 'HTTP 403');
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL ${name}`);
    console.log(`       ${error instanceof Error ? error.stack : String(error)}`);
  }
}
console.log(failed === 0 ? `\n${tests.length} passed` : `\n${failed} of ${tests.length} FAILED`);
process.exit(failed === 0 ? 0 : 1);
