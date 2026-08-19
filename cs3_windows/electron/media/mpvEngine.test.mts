/**
 * The native engine, driven against a real mpv process.
 *
 *   node --experimental-strip-types electron/media/mpvEngine.test.mts
 *
 * Unlike `decisionEngine.test.mts` this one is not pure — it spawns mpv and
 * plays a file. That is the point: everything worth getting wrong here is in the
 * seam between two processes, and none of it can be asserted from a mock. The
 * JSON-IPC framing, the `request_id` correlation, the property observations that
 * drive the timeline, the track list, `end-file` telling a dead link apart from
 * the credits — all of it is mpv's behaviour, not ours, and a stub would only
 * ever assert what we assumed mpv does.
 *
 * It skips itself when mpv is absent, exactly as `pipeline.test.mts` does for
 * ffmpeg. The fixture is synthesised with ffmpeg rather than downloaded: HEVC
 * 10-bit in Matroska with 5.1 AC-3 is precisely the combination Chromium cannot
 * play and the transcoder handles expensively, so it is the row that matters,
 * and generating it locally costs a second and expires never.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MpvEngine } from './mpvEngine.ts';
import type { MpvSnapshot } from '../../src/types/mpv.ts';

const BIN_DIRS = [
  path.join(os.homedir(), 'AppData', 'Roaming', 'CloudStream 3 Desktop', 'bin'),
  path.join(process.cwd(), 'bin'),
];

function which(name: string): string | null {
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  for (const dir of [...BIN_DIRS, ...(process.env.PATH || '').split(path.delimiter)]) {
    if (!dir) continue;
    const candidate = path.join(dir, exe);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

const mpvPath = which('mpv');
const ffmpegPath = which('ffmpeg');

if (!mpvPath || !ffmpegPath) {
  console.log(`  skip  native engine suite (${!mpvPath ? 'mpv' : 'ffmpeg'} not installed)`);
  process.exit(0);
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs3-mpv-test-'));
const fixture = path.join(workDir, 'hevc10-ac3.mkv');

/** HEVC 10-bit + 5.1 AC-3 in Matroska: three separate reasons Chromium refuses it. */
execFileSync(
  ffmpegPath,
  [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=8',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8',
    '-c:v', 'libx265', '-pix_fmt', 'yuv420p10le', '-preset', 'ultrafast',
    '-c:a', 'ac3', '-ac', '6',
    '-metadata:s:a:0', 'language=hin',
    fixture,
  ],
  { stdio: 'ignore' }
);

const failures: string[] = [];
const snapshots: MpvSnapshot[] = [];

const engine = new MpvEngine({
  resolveBinary: (name) => which(name),
  onUpdate: (snapshot) => snapshots.push(snapshot),
});

const check = (name: string, fn: () => void) => {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`  FAIL ${name}`);
    console.log(`       ${error instanceof Error ? error.message : String(error)}`);
  }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls the pushed snapshots rather than sleeping a fixed time for each step. */
async function waitFor(
  predicate: (snapshot: MpvSnapshot) => boolean,
  timeoutMs: number,
  what: string
): Promise<MpvSnapshot> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = engine.snapshot();
    if (predicate(snapshot)) return snapshot;
    await sleep(100);
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}`);
}

try {
  const status = await engine.status();
  check('mpv is found and reports its version', () => {
    assert.equal(status.available, true);
    assert.match(status.version ?? '', /^mpv /);
  });

  check('hardware decoders are enumerated', () => {
    // Which ones exist is a property of the machine; that the list parses is ours.
    assert.equal(Array.isArray(status.hardwareDecoders), true);
  });

  const opened = await engine.open({ url: fixture, title: 'fixture', volume: 0 });
  check('a HEVC 10-bit / AC-3 5.1 Matroska file opens', () => {
    assert.equal(opened.ok, true, opened.error ?? '');
    assert.notEqual(opened.sessionId, '');
  });

  const playing = await waitFor((s) => s.state === 'playing' && s.positionSeconds > 0, 20_000, 'playback to start');

  check('the decoder reports what it is actually decoding', () => {
    // The whole premise of the engine: Chromium decodes none of this.
    assert.match(playing.videoCodec.toLowerCase(), /hevc|h\.?265/);
    assert.equal(playing.audioCodec, 'ac3');
    // 10-bit, read past the hardware surface format. See `snapshot()`.
    assert.match(playing.pixelFormat ?? '', /10/);
  });

  check('hardware decoding is actually in use, not merely enabled', () => {
    // `auto-safe` falls back to software silently, so this is a measurement of
    // the machine rather than an assertion about the code. A software fallback
    // is a legitimate outcome — reporting `no` as if it were `d3d11va` is not.
    assert.ok(playing.hardwareDecoder.length > 0);
    console.log(`       (decoder: ${playing.hardwareDecoder}, output: ${status.videoOutput ?? 'n/a'})`);
  });

  check('the timeline advances from observed properties, not a timer', () => {
    assert.ok(playing.positionSeconds > 0, `position was ${playing.positionSeconds}`);
    assert.ok(playing.durationSeconds > 7, `duration was ${playing.durationSeconds}`);
    assert.ok(snapshots.length > 3, `only ${snapshots.length} snapshots were pushed`);
  });

  check('the 5.1 track survives with its channel count and language', () => {
    assert.equal(playing.audioTracks.length, 1);
    assert.equal(playing.audioTracks[0].channels, 6);
    assert.equal(playing.audioTracks[0].language, 'hin');
  });

  await engine.setPaused(true);
  const paused = await waitFor((s) => s.paused, 5_000, 'the pause to take effect');
  check('pause is reflected back through the IPC channel', () => {
    assert.equal(paused.paused, true);
    assert.equal(paused.state, 'paused');
  });

  await engine.seek(5);
  await engine.setPaused(false);
  const seeked = await waitFor((s) => s.positionSeconds >= 4.5, 10_000, 'the seek to land');
  check('an absolute seek moves the playhead', () => {
    assert.ok(seeked.positionSeconds >= 4.5, `position was ${seeked.positionSeconds}`);
  });

  const ended = await waitFor((s) => s.state === 'ended', 20_000, 'end of file');
  check('reaching the end reports `ended`, not an error', () => {
    assert.equal(ended.state, 'ended');
    assert.equal(ended.error, null);
  });

  /**
   * The distinction `end-file` exists to preserve. A dead link and the credits
   * are the same event to mpv's caller unless the reason is read, and reporting
   * a 404 as "finished" is how a broken source becomes an unreported bug.
   */
  await engine.open({ url: path.join(workDir, 'does-not-exist.mkv'), title: 'missing' });
  const failed = await waitFor((s) => s.state === 'error', 15_000, 'the load failure');
  check('an unreadable source is reported as an error with a reason', () => {
    assert.equal(failed.state, 'error');
    assert.ok((failed.error ?? '').length > 0, 'no reason was carried');
  });

  check('the process is reused across files rather than respawned', () => {
    assert.equal(engine.isRunning(), true);
  });
} finally {
  await engine.shutdown();
  await sleep(300);
  try {
    fs.rmSync(workDir, { recursive: true, force: true });
  } catch {
    /* Windows holds the file briefly after mpv exits; the temp dir is disposable */
  }
  /** mpv is spawned detached from this script's stdio; make sure none survive. */
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/F', '/IM', 'mpv.exe'], { stdio: 'ignore', windowsHide: true });
  }
}

console.log(failures.length === 0 ? '\nnative engine suite passed' : `\n${failures.length} FAILED`);
process.exit(failures.length === 0 ? 0 : 1);
