/**
 * S10's three ways to play a source (Provider Compatibility Audit PRD §6.1),
 * measured, never judged: `playbackEvidence.ts` judges. Every source byte
 * comes through the runner's metered `MediaProxy`; these read only loopback.
 *
 * - `playElement`: `play.html` in the network worker's hidden window.
 * - `playConversion`: the shipping `MediaTranscoder`, its output read on
 *   loopback and timed by the media seconds in its fragments.
 * - `playMpv`: mpv with no picture or sound (`--vo=null --ao=null`), read over
 *   its IPC pipe. Hardware decoding is `auto-copy-safe`, because the app's
 *   `auto-safe` needs a video output to hand frames to.
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import { fmp4MediaSeconds, VERIFY_CAPS } from '../../desktop/electron/cs3/audit/playbackEvidence.ts';

export async function playElement(worker, loop, transport) {
  const kind = transport === 'hls' ? 'hls' : 'file';
  const answer = await worker.post(
    { op: 'play', src: loop, kind, wallMs: VERIFY_CAPS.wallMs, enoughSeconds: VERIFY_CAPS.enoughSeconds },
    VERIFY_CAPS.wallMs + 15_000
  );
  const read = answer.ok ? answer : (answer.last ?? {});
  return {
    playedSeconds: read.playedSeconds ?? 0,
    startMs: read.startMs ?? undefined,
    wallMs: answer.wallMs ?? VERIFY_CAPS.wallMs,
    error: answer.ok ? (read.error ?? undefined) : { kind: 'other', message: answer.error ?? 'the window failed' },
    width: read.width,
    height: read.height,
    decodedFrames: read.decodedFrames,
    droppedFrames: read.droppedFrames,
    stalls: read.stalls,
    fragments: read.fragments,
    issue: read.issue ?? undefined,
  };
}

/** Converted output is kept up to this, then read no further. */
const OUTPUT_CAP = 64 * 1024 * 1024;

export async function playConversion(transcoder, loop, plan, transport, sequentialInput) {
  const started = Date.now();
  const url = await transcoder.createSession(loop, plan, transport, { sequentialInput });
  if (!url) return { playedSeconds: 0, wallMs: 0, error: { kind: 'other', message: 'The conversion could not be started.' } };
  const token = url.split('/').pop();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VERIFY_CAPS.wallMs);
  const chunks = [];
  let bytes = 0;
  let startMs;
  let playedSeconds = 0;
  let error;
  let checkedAt = 0;
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`The conversion answered HTTP ${response.status}`);
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      startMs ??= Date.now() - started;
      chunks.push(value);
      bytes += value.byteLength;
      // Count the fragments every half megabyte, not every chunk.
      if (bytes - checkedAt >= 512 * 1024) {
        checkedAt = bytes;
        playedSeconds = fmp4MediaSeconds(Buffer.concat(chunks)) ?? 0;
        if (playedSeconds >= VERIFY_CAPS.enoughSeconds) break;
      }
      if (bytes >= OUTPUT_CAP) break;
    }
    await reader.cancel().catch(() => {});
  } catch (caught) {
    if (!controller.signal.aborted) error = { kind: 'other', message: String(caught?.message ?? caught) };
  } finally {
    clearTimeout(timer);
    controller.abort();
    transcoder.closeSession(token);
  }
  playedSeconds = Math.max(playedSeconds, fmp4MediaSeconds(Buffer.concat(chunks)) ?? 0);
  // Ended with nothing to show: what ffmpeg said is the reason.
  if (playedSeconds === 0 && !error && bytes === 0) error = { kind: 'other', message: 'The conversion produced no output.' };
  return { playedSeconds, startMs, wallMs: Date.now() - started, error, outputBytes: bytes };
}

let pipes = 0;

export async function playMpv(binary, loop) {
  const started = Date.now();
  const pipe =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\cs3-audit-${process.pid}-${++pipes}`
      : `/tmp/cs3-audit-${process.pid}-${++pipes}.sock`;
  const child = spawn(
    binary,
    [
      '--no-config',
      '--vo=null',
      '--ao=null',
      '--hwdec=auto-copy-safe',
      '--idle=no',
      '--keep-open=no',
      '--ytdl=no',
      '--load-scripts=no',
      '--cache=yes',
      '--demuxer-max-bytes=256MiB',
      '--demuxer-readahead-secs=30',
      '--input-terminal=no',
      '--msg-level=all=error',
      `--input-ipc-server=${pipe}`,
      loop,
    ],
    { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] }
  );
  const stderr = [];
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => stderr.length < 50 && stderr.push(chunk));
  let exited = false;
  child.once('exit', () => (exited = true));

  let socket;
  const replies = new Map();
  let nextId = 1;
  const ask = (property) =>
    new Promise((resolve) => {
      if (!socket || socket.destroyed) return resolve(undefined);
      const id = nextId++;
      replies.set(id, resolve);
      socket.write(`${JSON.stringify({ command: ['get_property', property], request_id: id })}\n`);
      setTimeout(() => replies.delete(id) && resolve(undefined), 1000);
    });

  const read = { playedSeconds: 0 };
  let firstPosition;
  try {
    while (Date.now() - started < VERIFY_CAPS.wallMs && !exited) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (!socket) socket = await connect(pipe, replies).catch(() => undefined);
      if (!socket) continue;
      const position = await ask('time-pos');
      if (typeof position === 'number' && position > 0) {
        if (firstPosition === undefined) {
          firstPosition = position;
          read.startMs = Date.now() - started;
        }
        read.playedSeconds = position - firstPosition;
      }
      if (read.playedSeconds >= VERIFY_CAPS.enoughSeconds) break;
    }
    if (socket && !socket.destroyed) {
      read.width = await ask('width');
      read.height = await ask('height');
      read.hwdec = await ask('hwdec-current');
      read.droppedFrames = await ask('decoder-frame-drop-count');
    }
  } finally {
    socket?.destroy();
    if (!exited) child.kill();
  }
  const said = stderr.join('').trim();
  if (read.playedSeconds < VERIFY_CAPS.minSeconds && said) {
    read.error = { kind: /HTTP error|tcp:|timed out|Connection/i.test(said) ? 'network' : 'decode', message: said.slice(0, 300) };
  }
  return { ...read, wallMs: Date.now() - started };
}

function connect(pipe, replies) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(pipe);
    let buffer = '';
    socket.setEncoding('utf8');
    socket.once('connect', () => {
      // mpv closing the pipe as it exits is not an error anyone waits on.
      socket.on('error', () => {});
      resolve(socket);
    });
    socket.once('error', reject);
    socket.on('data', (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        try {
          const frame = JSON.parse(line);
          const resolve = replies.get(frame.request_id);
          if (resolve) {
            replies.delete(frame.request_id);
            resolve(frame.error === 'success' ? frame.data : undefined);
          }
        } catch {
          // An event line; nothing waits on it.
        }
      }
    });
  });
}
