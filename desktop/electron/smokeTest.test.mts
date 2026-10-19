/**
 * The release smoke check fails on what a broken package looks like — above
 * all on a check that passed only because the CI machine had its own copy.
 *
 *   node --experimental-strip-types electron/smokeTest.test.mts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cs3-smoke-'));
const reportFile = path.join(scratch, 'report.json');
process.env.CS3_SMOKE_REPORT = reportFile;
const resources = path.join(scratch, 'resources');
(process as unknown as { resourcesPath: string }).resourcesPath = resources;

const { bundledTools, runSmokeTest } = await import('./smokeTest.ts');
type Deps = Parameters<typeof runSmokeTest>[0];
type Report = { ok: boolean; sidecarPid?: number; checks: Array<{ id: string; ok: boolean; required: boolean; detail: string }> };

function deps(overrides: Partial<Deps> = {}, state = { quit: 0, count: 0 }): Deps {
  const app = {
    isPackaged: true,
    getVersion: () => '1.2.3',
    getPath: () => path.join(scratch, 'profile'),
    quit: () => {
      state.quit += 1;
    },
  } as unknown as Deps['app'];
  const window = {
    isDestroyed: () => false,
    webContents: {
      isLoading: () => false,
      executeJavaScript: async () => ({ bridge: true, nodes: 3 }),
      getURL: () => 'file:///app/dist/index.html',
    },
  } as unknown as ReturnType<Deps['window']>;
  return {
    app,
    window: () => window,
    testBinary: async (name) => ({ ok: true, version: `${name} 7.1`, path: path.join(resources, 'media', name) }),
    isBundled: () => true,
    sidecarStatus: async () => ({ running: true, canExecute: true, javaVersion: '21', pid: 4242 }),
    javaPath: () => path.join(resources, 'sidecar', 'jre', 'bin', 'java'),
    readLaunchCount: () => state.count,
    writeLaunchCount: (count) => {
      state.count = count;
    },
    startTorrentEngine: async () => {},
    reachRepository: async () => 'Repo: 12 extensions',
    target: { platform: 'linux', arch: 'x64' },
    ...overrides,
  };
}

async function run(d: Deps): Promise<Report> {
  fs.rmSync(reportFile, { force: true });
  await runSmokeTest(d);
  return JSON.parse(fs.readFileSync(reportFile, 'utf8')) as Report;
}
const check = (report: Report, id: string) => report.checks.find((c) => c.id === id)!;

const tests: Array<[string, () => Promise<void> | void]> = [];
const test = (name: string, fn: () => Promise<void> | void) => tests.push([name, fn]);

test('ffmpeg is expected in every package but Apple silicon; mpv only on Windows', () => {
  assert.deepEqual(bundledTools('win32', 'x64'), { ffmpeg: true, mpv: true });
  assert.deepEqual(bundledTools('darwin', 'x64'), { ffmpeg: true, mpv: false });
  assert.deepEqual(bundledTools('darwin', 'arm64'), { ffmpeg: false, mpv: false });
  assert.deepEqual(bundledTools('linux', 'arm64'), { ffmpeg: true, mpv: false });
});

test('a working package passes, records the JVM pid and quits through the normal shutdown', async () => {
  const state = { quit: 0, count: 0 };
  const report = await run(deps({}, state));
  assert.equal(report.ok, true, JSON.stringify(report.checks));
  assert.equal(report.sidecarPid, 4242);
  assert.equal(state.quit, 1);
  assert.equal(state.count, 1, 'the launch is counted on disk');
});

test("a sidecar that answered on the machine's own Java fails the package", async () => {
  const report = await run(deps({ javaPath: () => '/usr/lib/jvm/temurin-21/bin/java' }));
  assert.equal(report.ok, false);
  assert.match(check(report, 'sidecar').detail, /not the bundled JRE/);
});

test("ffmpeg resolved from the machine rather than the package fails where one is bundled", async () => {
  const fallback = () => deps({ isBundled: (name) => name !== 'ffmpeg' });
  const report = await run(fallback());
  assert.equal(report.ok, false);
  assert.match(check(report, 'ffmpeg').detail, /not the copy this package should carry/);

  const appleSilicon = await run({ ...fallback(), target: { platform: 'darwin', arch: 'arm64' } });
  assert.equal(appleSilicon.ok, true, 'Homebrew ffmpeg is the design there');
});

test('a missing mpv fails only the Windows package', async () => {
  const noMpv = () => deps({ testBinary: async (name) => (name === 'mpv' ? { ok: false, error: 'mpv is not installed' } : { ok: true, version: name, path: path.join(resources, name) }) });
  assert.equal((await run(noMpv())).ok, true);
  assert.equal((await run({ ...noMpv(), target: { platform: 'win32', arch: 'x64' } })).ok, false);
});

test('a second launch must find what the first one wrote', async () => {
  process.env.CS3_SMOKE_LAUNCH = '2';
  try {
    const lost = await run(deps());
    assert.equal(lost.ok, false, 'a profile that came back empty is a persistence failure');
    assert.match(check(lost, 'persistence').detail, /expected 1 earlier launches on disk, found 0/);

    const kept = await run(deps({}, { quit: 0, count: 1 }));
    assert.equal(kept.ok, true);
  } finally {
    delete process.env.CS3_SMOKE_LAUNCH;
  }
});

test('an unreachable repository is reported, and fails only when asked to', async () => {
  const offline = () => deps({ reachRepository: async () => { throw new Error('ENOTFOUND raw.githubusercontent.com'); } });
  const report = await run(offline());
  assert.equal(report.ok, true);
  assert.equal(check(report, 'network').ok, false);
  process.env.CS3_SMOKE_NETWORK = 'require';
  try {
    assert.equal((await run(offline())).ok, false);
  } finally {
    delete process.env.CS3_SMOKE_NETWORK;
  }
});

test('a torrent engine whose native modules do not load fails the package', async () => {
  const report = await run(deps({ startTorrentEngine: async () => { throw new Error('Cannot find module node_datachannel.node'); } }));
  assert.equal(report.ok, false);
  assert.match(check(report, 'torrent').detail, /node_datachannel/);
});

test('a renderer that never mounted fails the package', async () => {
  const blank = {
    isDestroyed: () => false,
    webContents: { isLoading: () => false, executeJavaScript: async () => ({ bridge: false, nodes: 0 }), getURL: () => '' },
  } as unknown as ReturnType<Deps['window']>;
  const report = await run(deps({ window: () => blank }));
  assert.equal(report.ok, false);
  assert.match(check(report, 'renderer').detail, /preload bridge/);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL ${name}`);
    console.log(`       ${error instanceof Error ? error.message : String(error)}`);
  }
}
fs.rmSync(scratch, { recursive: true, force: true });
console.log(failed === 0 ? `\n${tests.length} passed` : `\n${failed} of ${tests.length} FAILED`);
process.exit(failed === 0 ? 0 : 1);
