/**
 * The vendor coverage matrix: what our providers actually serve, and whether we
 * can play it.
 *
 *   node --experimental-strip-types tools/e2e/native-engine-matrix.mjs
 *   node --experimental-strip-types tools/e2e/native-engine-matrix.mjs --plugins 12 --links 2
 *   node --experimental-strip-types tools/e2e/native-engine-matrix.mjs --only Cinefreak,HDhub4u
 *   node --experimental-strip-types tools/e2e/native-engine-matrix.mjs --titles hindi-movie,english-series
 *
 * `provider-e2e.mjs` answers "does the extension corpus still run?". This
 * answers the question after it: **given what those extensions hand back, can
 * this app put it on screen?** They are different failures with different
 * owners — a provider that resolves five links to 10-bit HEVC is working
 * perfectly and is still, without the native engine, five links we cannot play.
 *
 * What makes it worth trusting is that it imports the shipping modules rather
 * than reimplementing them. `MediaInspector` does the probing and
 * `decideStrategy` makes the call, so the strategy printed in the report is
 * literally the one the app will choose for that URL. A harness with its own
 * copy of the decision would agree with the product right up until the moment
 * it mattered.
 *
 * The last column is the one that cannot be reasoned about: every candidate
 * stream is **played for real, for a few seconds, by mpv**, and the report
 * carries how far the playhead got and how many frames were dropped. A stream
 * that probes cleanly and stalls on the second GOP looks identical to a healthy
 * one until something presses play.
 *
 * Language coverage is deliberate. Hindi releases are where the hard cases
 * cluster — dual-audio Matroska with 5.1 AC-3 or E-AC-3 per language, 10-bit
 * HEVC encodes, and the multi-track files that the audio-selection logic exists
 * for — so a matrix of English titles alone would report a compatibility story
 * that is true for half the catalogue.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import http from 'http';
import https from 'https';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  MediaInspector,
  detectExtensionPicky,
  drmRequiresEme,
} from '../../cs3_windows/electron/media/mediaInspector.ts';
import { runTool } from '../../cs3_windows/electron/media/runTool.ts';
import { decideStrategy } from '../../cs3_windows/electron/media/decisionEngine.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const APPDATA_DIR = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'CloudStream 3 Desktop'
);
const BIN_DIR = path.join(APPDATA_DIR, 'bin');
const EXTENSIONS_DIR = path.join(APPDATA_DIR, 'extensions');
const SIDECAR_JAR = path.join(REPO_ROOT, 'sidecar', 'target', 'cs3-sidecar.jar');
const RUNTIME_DIR = path.join(REPO_ROOT, 'sidecar', 'runtime');

function exe(name) {
  return process.platform === 'win32' ? `${name}.exe` : name;
}

function findBinary(name) {
  const candidates = [
    path.join(BIN_DIR, exe(name)),
    ...(process.env.PATH || '').split(path.delimiter).map((dir) => path.join(dir, exe(name))),
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) ?? null;
}

function findBinaryExact(fileName) {
  const candidates = [
    path.join(BIN_DIR, fileName),
    ...(process.env.PATH || '').split(path.delimiter).map((dir) => path.join(dir, fileName)),
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) ?? null;
}

function findJava() {
  const toolchain = path.join(REPO_ROOT, 'tools', 'toolchain');
  if (fs.existsSync(toolchain)) {
    for (const entry of fs.readdirSync(toolchain)) {
      if (!entry.startsWith('jdk-')) continue;
      const candidate = path.join(toolchain, entry, 'bin', exe('java'));
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return findBinary('java');
}

const FFPROBE = findBinary('ffprobe');
const FFMPEG = findBinary('ffmpeg');
/**
 * `mpv.com`, deliberately, and only for this harness.
 *
 * `mpv.exe` is a GUI-subsystem binary on Windows: its stdout goes nowhere, so
 * `--term-status-msg` produces nothing and every stream reads as "no frames
 * decoded" however well it played. The app uses `mpv.exe` because it wants the
 * window and reads state over IPC; this reads state off the terminal, so it
 * needs the console front-end that ships beside it.
 */
const MPV =
  (process.platform === 'win32' ? findBinaryExact('mpv.com') : null) ?? findBinary('mpv');
const JAVA = findJava();

// --- arguments -------------------------------------------------------------

const args = process.argv.slice(2);
function flag(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const MAX_PLUGINS = Number(flag('plugins', '14'));
const MAX_LINKS_PER_HIT = Number(flag('links', '2'));
const PLAY_SECONDS = Number(flag('seconds', '8'));
const ONLY = flag('only', '') ? flag('only', '').split(',').map((s) => s.trim().toLowerCase()) : null;
const REPORT_PATH = flag('json', path.join(APPDATA_DIR, 'cs3-native-engine-matrix.json'));

/**
 * The titles, chosen to span the axes that actually change the answer:
 * language, and film versus series.
 *
 * A series is not a longer film here. Television releases are overwhelmingly
 * HDTV and WEB-DL carrying broadcast AC-3 or E-AC-3, where film web-rips
 * usually carry AAC — which is why the silent-audio bug hit series hardest and
 * looked provider-specific for so long. A matrix without episodes would miss
 * the whole category.
 */
const TITLES = [
  { key: 'english-movie', query: 'Inception', language: 'English', kind: 'movie' },
  { key: 'english-series', query: 'Breaking Bad', language: 'English', kind: 'series' },
  { key: 'hindi-movie', query: '3 Idiots', language: 'Hindi', kind: 'movie' },
  { key: 'hindi-movie-2', query: 'Jawan', language: 'Hindi', kind: 'movie' },
  { key: 'hindi-series', query: 'Mirzapur', language: 'Hindi', kind: 'series' },
];

const selectedTitleKeys = flag('titles', '') ? flag('titles', '').split(',').map((s) => s.trim()) : null;
const ACTIVE_TITLES = selectedTitleKeys
  ? TITLES.filter((title) => selectedTitleKeys.includes(title.key))
  : TITLES;

// --- sidecar ---------------------------------------------------------------

class Sidecar {
  constructor() {
    this.proc = null;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = '';
  }

  async start() {
    const classpath = [SIDECAR_JAR, path.join(REPO_ROOT, 'sidecar', 'target', 'lib', '*')].join(
      path.delimiter
    );
    const dataDir = path.join(APPDATA_DIR, 'cs3-native-matrix-data');
    fs.mkdirSync(dataDir, { recursive: true });

    this.proc = spawn(
      JAVA,
      [
        '-Xmx768m',
        '-Dfile.encoding=UTF-8',
        '-cp', classpath,
        'com.cloudstream.desktop.sidecar.Main',
        `--data-dir=${dataDir}`,
        `--runtime-classpath=${RUNTIME_DIR}`,
      ],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
    );

    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk) => {
      this.buffer += chunk;
      let index = this.buffer.indexOf('\n');
      while (index >= 0) {
        const line = this.buffer.slice(0, index).trim();
        this.buffer = this.buffer.slice(index + 1);
        if (line) {
          try {
            const frame = JSON.parse(line);
            const request = this.pending.get(String(frame.id));
            if (request) {
              this.pending.delete(String(frame.id));
              clearTimeout(request.timer);
              request.resolve(frame);
            }
          } catch {
            /* the sidecar contract is one JSON frame per line; anything else is noise */
          }
        }
        index = this.buffer.indexOf('\n');
      }
    });
    // stdout carries RPC frames and nothing else — plugin logs are on stderr.
    this.proc.stderr.resume();

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  call(method, params = {}, timeoutMs = 20000) {
    const id = String(this.nextId++);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, error: `${method} timed out after ${timeoutMs}ms` });
      }, timeoutMs + 2000);
      this.pending.set(id, { resolve, timer });
      this.proc.stdin.write(`${JSON.stringify({ id, method, params: { ...params, timeoutMs } })}\n`);
    });
  }

  stop() {
    this.proc?.kill('SIGKILL');
    this.proc = null;
  }
}

function findInstalledPlugins() {
  const found = new Map();
  if (!fs.existsSync(EXTENSIONS_DIR)) return [];
  for (const repo of fs.readdirSync(EXTENSIONS_DIR)) {
    const repoPath = path.join(EXTENSIONS_DIR, repo);
    if (!fs.statSync(repoPath).isDirectory()) continue;
    for (const file of fs.readdirSync(repoPath)) {
      if (!file.endsWith('.cs3')) continue;
      const id = file.split('.')[0];
      if (!found.has(id)) found.set(id, { id, path: path.join(repoPath, file), repo });
    }
  }
  return [...found.values()];
}

// --- the header-injecting proxy -------------------------------------------

/**
 * Stands in for `MediaProxy`, for the same reason it exists in the app.
 *
 * Provider links routinely answer only when accompanied by the `Referer` the
 * extension supplied, and neither ffprobe nor a media element sends one on its
 * own. Probing the raw URL would report a large fraction of a working corpus as
 * dead, which is precisely the misdiagnosis this harness is meant to prevent.
 */
function startProxy(targetUrl, headers) {
  return new Promise((resolve) => {
    const server = http.createServer((request, response) => {
      let upstream;
      try {
        upstream = new URL(targetUrl);
      } catch {
        response.writeHead(400);
        return response.end('bad url');
      }
      const client = upstream.protocol === 'https:' ? https : http;
      const proxied = client.request(
        upstream,
        {
          method: request.method,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            ...headers,
            ...(request.headers.range ? { Range: request.headers.range } : {}),
          },
        },
        (upstreamResponse) => {
          response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
          upstreamResponse.pipe(response);
        }
      );
      proxied.on('error', () => {
        try {
          response.writeHead(502);
          response.end();
        } catch {
          /* the client has already gone */
        }
      });
      request.on('aborted', () => proxied.destroy());
      proxied.end();
    });

    server.on('clientError', (_error, socket) => socket.destroy());
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}/stream`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

// --- playback verification -------------------------------------------------

/**
 * Plays the stream for real, headlessly, and reports how far it got.
 *
 * `--vo=null --ao=null` still runs the full demux and decode path — the frames
 * are decoded and then discarded — so this measures the thing that matters
 * (can this bitstream be decoded, continuously, from this server) without
 * needing a display. `--untimed` is deliberately **not** passed: decoding as
 * fast as the CPU allows would hide exactly the failure being looked for, which
 * is a stream that cannot sustain realtime.
 */
function playInMpv(url, seconds) {
  return new Promise((resolve) => {
    if (!MPV) return resolve({ ok: false, error: 'mpv is not installed' });

    const started = Date.now();
    const child = spawn(
      MPV,
      [
        '--no-config',
        '--vo=null',
        '--ao=null',
        '--input-terminal=no',
        '--ytdl=no',
        '--load-scripts=no',
        '--hwdec=auto-safe',
        `--length=${seconds}`,
        '--msg-level=all=status',
        '--term-status-msg=CS3 ${=time-pos} ${frame-drop-count} ${hwdec-current} ${video-codec} ${audio-codec-name} ${width}x${height}',
      ],
      { windowsHide: true }
    );

    let position = 0;
    let drops = 0;
    let decoder = 'no';
    let videoCodec = '';
    let audioCodec = '';
    let resolution = '';
    let stderr = '';

    const read = (chunk) => {
      const text = chunk.toString();
      stderr += text.slice(0, 4000);
      for (const line of text.split(/[\r\n]+/)) {
        const match = /^CS3 ([\d.]+) (\d+) (\S+) (.*?) (\S+) (\d+x\d+)$/.exec(line.trim());
        if (!match) continue;
        position = Math.max(position, Number(match[1]) || 0);
        drops = Number(match[2]) || 0;
        decoder = match[3];
        videoCodec = match[4];
        audioCodec = match[5];
        resolution = match[6];
      }
    };
    child.stdout?.on('data', read);
    child.stderr?.on('data', read);

    const killer = setTimeout(() => child.kill('SIGKILL'), (seconds + 25) * 1000);

    child.on('close', (code) => {
      clearTimeout(killer);
      if (process.env.CS3_DEBUG_MPV) console.error(`[dbg] exit=${code} rawLen=${stderr.length} pos=${position} raw=${JSON.stringify(stderr.slice(0,600))}`);
      resolve({
        // "It played" means the playhead moved past the first second, not that
        // the process exited zero: mpv exits zero for a file it opened and could
        // not decode a frame of.
        ok: position >= 1,
        positionSeconds: Number(position.toFixed(2)),
        droppedFrames: drops,
        hardwareDecoder: decoder,
        videoCodec,
        audioCodec,
        resolution,
        wallClockMs: Date.now() - started,
        error: position >= 1 ? undefined : (stderr.split('\n').find((l) => /error|failed|refused/i.test(l)) ?? 'no frames decoded'),
      });
    });
  });
}

// --- the run ---------------------------------------------------------------

/** A software-only host with a plain Chromium build: the machine most people have. */
const HOST_SOFTWARE = { hardware: false, accelerator: 'cpu', logicalCores: os.cpus().length };
const RENDERER_PLAIN = { video: { h264: true, vp8: true, vp9: true, av1: true, hevc: false, hevc10: false } };

const inspector = new MediaInspector(
  () => FFPROBE,
  async (url) => {
    try {
      const response = await fetch(url, {
        headers: { Range: 'bytes=0-65535' },
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok && response.status !== 206) return null;
      return (await response.text()).slice(0, 65536);
    } catch {
      return null;
    }
  }
);

function parseLinks(json) {
  try {
    const parsed = JSON.parse(json);
    return parsed.links ?? [];
  } catch {
    return [];
  }
}

function parseHits(json) {
  try {
    const parsed = JSON.parse(json);
    return parsed.results ?? (Array.isArray(parsed) ? parsed : []);
  } catch {
    return [];
  }
}

const rows = [];
const providerSummary = new Map();

function note(provider, field) {
  const entry = providerSummary.get(provider) ?? {
    provider,
    searched: 0,
    answered: 0,
    linksResolved: 0,
    probed: 0,
    played: 0,
  };
  entry[field] += 1;
  providerSummary.set(provider, entry);
}

async function evaluateLink(context, link) {
  const headers = {
    ...(link.referer ? { Referer: link.referer } : {}),
    ...(link.headers ?? {}),
  };
  const proxy = await startProxy(link.url, headers);

  const row = {
    ...context,
    linkName: link.name ?? link.source ?? '',
    quality: link.quality ?? null,
    url: link.url.slice(0, 140),
    hasReferer: Boolean(link.referer),
  };

  try {
    const inspection = await inspector.inspect(proxy.url, Boolean(link.isM3u8));
    row.transport = inspection.transport;
    row.probeMs = inspection.latencyMs;

    if (!inspection.metadata) {
      row.outcome = 'probe-failed';
      row.detail = (inspection.error ?? 'no metadata').slice(0, 180);
      return row;
    }
    note(context.provider, 'probed');

    const video = inspection.metadata.video;
    const audio = inspection.metadata.audio;
    row.container = inspection.metadata.formatName;
    row.video = video ? `${video.codec}/${video.bitDepth}bit ${video.width}x${video.height}` : 'none';
    row.audio = audio.map((track) => `${track.codec}/${track.channels}ch${track.language ? `:${track.language}` : ''}`);
    row.isHdr = Boolean(video?.isHdr);

    const requiresEme = drmRequiresEme(inspection.drm);

    /**
     * Both verdicts are recorded, and the pair is the actual finding.
     *
     * `withoutEngine` is what this app did before mpv existed; `withEngine` is
     * what it does now. A row where those differ is a stream the product used
     * to re-encode — losing resolution, HDR and channel layout, at a whole CPU
     * core — and now plays untouched. Printing only the new answer would make
     * the change look like a refactor.
     */
    row.withoutEngine = decideStrategy(
      inspection.metadata,
      inspection.transport,
      RENDERER_PLAIN,
      HOST_SOFTWARE,
      requiresEme,
      { available: false, policy: 'off' }
    ).strategy;
    row.withEngine = decideStrategy(
      inspection.metadata,
      inspection.transport,
      RENDERER_PLAIN,
      HOST_SOFTWARE,
      requiresEme,
      { available: Boolean(MPV), policy: 'auto' }
    ).strategy;

    if (requiresEme) {
      // FFmpeg holds no keys and neither does mpv; playing it would be theatre.
      row.outcome = 'drm';
      row.detail = inspection.drm.type;
      return row;
    }

    const playback = await playInMpv(proxy.url, PLAY_SECONDS);
    row.playedSeconds = playback.positionSeconds ?? 0;
    row.droppedFrames = playback.droppedFrames ?? 0;
    row.hardwareDecoder = playback.hardwareDecoder;
    row.outcome = playback.ok ? 'played' : 'play-failed';
    if (!playback.ok) row.detail = String(playback.error ?? '').slice(0, 180);
    if (playback.ok) note(context.provider, 'played');
    return row;
  } catch (error) {
    row.outcome = 'error';
    row.detail = String(error?.message ?? error).slice(0, 180);
    return row;
  } finally {
    await proxy.close();
  }
}

async function main() {
  console.log('='.repeat(78));
  console.log('NATIVE ENGINE & VENDOR STREAMING MATRIX');
  console.log('='.repeat(78));
  console.log(`ffprobe : ${FFPROBE ?? 'MISSING'}`);
  console.log(`ffmpeg  : ${FFMPEG ?? 'MISSING'}`);
  console.log(`mpv     : ${MPV ?? 'MISSING'}`);
  console.log(`java    : ${JAVA ?? 'MISSING'}`);
  console.log(`titles  : ${ACTIVE_TITLES.map((t) => `${t.query} (${t.language} ${t.kind})`).join(', ')}`);
  console.log('');

  if (!FFPROBE || !JAVA) {
    console.error('ffprobe and a JDK are required. Install media components and build the sidecar.');
    process.exit(2);
  }

  /**
   * The same detection `main.ts` runs at startup.
   *
   * Without it `hlsDemuxerOptions()` omits `-extension_picky 0` and every
   * provider serving segments from image URLs — Hdmovie2 is the one in the
   * corpus — is reported as unprobeable. That is the harness measuring its own
   * configuration rather than the vendor, which is the worst kind of red result.
   */
  const picky = await detectExtensionPicky(FFPROBE, (command, cmdArgs, timeoutMs) =>
    runTool(command, cmdArgs, timeoutMs)
  );
  console.log(`ffmpeg -extension_picky: ${picky ? 'supported (image-named segments allowed)' : 'absent'}
`);

  const sidecar = new Sidecar();
  await sidecar.start();

  const status = await sidecar.call('status', {});
  if (!status.result?.canExecute) {
    console.error('The sidecar cannot execute plugins:', JSON.stringify(status).slice(0, 400));
    sidecar.stop();
    process.exit(2);
  }

  let archives = findInstalledPlugins();
  if (ONLY) archives = archives.filter((a) => ONLY.some((name) => a.id.toLowerCase().includes(name)));
  archives = archives.slice(0, MAX_PLUGINS);
  console.log(`Loading ${archives.length} installed extensions…`);

  const providers = [];
  for (const archive of archives) {
    const loaded = await sidecar.call('load', { pluginId: archive.id, path: archive.path }, 45000);
    for (const provider of loaded.result?.providers ?? []) {
      const name = provider.name ?? provider;
      // ExtractorApis register beside providers and have no `search`; asking one
      // reports a failure that belongs to nothing.
      if (typeof name === 'string' && name) providers.push({ name, plugin: archive.id });
    }
  }
  console.log(`${providers.length} providers registered from ${archives.length} archives\n`);

  for (const title of ACTIVE_TITLES) {
    console.log('-'.repeat(78));
    console.log(`${title.query}  [${title.language} ${title.kind}]`);
    console.log('-'.repeat(78));

    const search = await sidecar.call(
      'providerSearch',
      { providers: providers.map((p) => p.name), query: title.query },
      70000
    );
    const byProvider = search.result?.byProvider ?? {};

    for (const provider of providers) {
      note(provider.name, 'searched');
      const hits = parseHits(byProvider[provider.name] ?? '');
      if (hits.length === 0) continue;
      note(provider.name, 'answered');

      const hit = hits[0];
      const context = {
        title: title.query,
        language: title.language,
        kind: title.kind,
        provider: provider.name,
        plugin: provider.plugin,
        hit: String(hit.name ?? hit.title ?? '').slice(0, 90),
      };

      const detail = await sidecar.call('providerLoad', { provider: provider.name, url: hit.url }, 30000);
      if (!detail.result?.json) {
        rows.push({ ...context, outcome: 'detail-failed', detail: String(detail.error ?? '').slice(0, 160) });
        console.log(`  ${provider.name.padEnd(22)} detail load failed`);
        continue;
      }

      let handle = hit.url;
      try {
        const parsed = JSON.parse(detail.result.json);
        handle = parsed.detail?.dataUrl ?? parsed.dataUrl ?? hit.url;
        /**
         * A series detail page carries episodes, and its `dataUrl` is the show
         * rather than anything playable. Asking for links with it returns
         * nothing and reads as a broken provider, when what actually happened is
         * that nobody picked an episode.
         */
        const episodes = parsed.detail?.episodes ?? parsed.episodes ?? [];
        if (Array.isArray(episodes) && episodes.length > 0) {
          handle = episodes[0].data ?? episodes[0].dataUrl ?? handle;
          context.episode = String(episodes[0].name ?? `E${episodes[0].episode ?? 1}`).slice(0, 50);
        }
      } catch {
        /* the fallback handle is the search hit's own URL, which many providers accept */
      }

      const linksResult = await sidecar.call(
        'providerLoadLinks',
        { provider: provider.name, data: handle },
        45000
      );
      const links = parseLinks(linksResult.result?.json ?? '');
      if (links.length === 0) {
        rows.push({ ...context, outcome: 'no-links' });
        console.log(`  ${provider.name.padEnd(22)} 0 links`);
        continue;
      }
      note(provider.name, 'linksResolved');

      const usable = links.filter((link) => /^https?:/i.test(link.url ?? '')).slice(0, MAX_LINKS_PER_HIT);
      for (const link of usable) {
        const row = await evaluateLink(context, link);
        rows.push(row);
        const strategy =
          row.withoutEngine && row.withEngine && row.withoutEngine !== row.withEngine
            ? `${row.withoutEngine} → ${row.withEngine}`
            : row.withEngine ?? '';
        console.log(
          `  ${provider.name.padEnd(22)} ${String(row.outcome).padEnd(13)} ` +
            `${(row.video ?? '').padEnd(30)} ${strategy}` +
            (row.playedSeconds ? `  played ${row.playedSeconds}s [${row.hardwareDecoder}]` : '') +
            (row.detail ? `  — ${row.detail}` : '')
        );
      }
    }
    console.log('');
  }

  sidecar.stop();

  // --- report --------------------------------------------------------------

  const played = rows.filter((r) => r.outcome === 'played');
  const rescued = played.filter((r) => r.withoutEngine !== r.withEngine);

  console.log('='.repeat(78));
  console.log('SUMMARY');
  console.log('='.repeat(78));
  console.log(`providers registered : ${providers.length}`);
  console.log(`candidate streams    : ${rows.length}`);
  console.log(`probed successfully  : ${rows.filter((r) => r.container).length}`);
  console.log(`played by mpv        : ${played.length}`);
  console.log(`rescued by the engine: ${rescued.length}  (would otherwise have been re-encoded)`);

  const byStrategy = new Map();
  for (const row of rows) {
    if (!row.withEngine) continue;
    byStrategy.set(row.withEngine, (byStrategy.get(row.withEngine) ?? 0) + 1);
  }
  console.log('\nstrategy chosen:');
  for (const [strategy, count] of [...byStrategy].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(strategy).padEnd(20)} ${count}`);
  }

  console.log('\nby language:');
  for (const language of ['English', 'Hindi']) {
    const subset = rows.filter((r) => r.language === language);
    const ok = subset.filter((r) => r.outcome === 'played').length;
    console.log(`  ${language.padEnd(10)} ${ok}/${subset.length} streams played`);
  }

  console.log('\nby provider:');
  for (const entry of [...providerSummary.values()].sort((a, b) => b.played - a.played)) {
    if (entry.answered === 0 && entry.played === 0) continue;
    console.log(
      `  ${entry.provider.padEnd(24)} answered ${entry.answered}/${entry.searched}  ` +
        `links ${entry.linksResolved}  probed ${entry.probed}  played ${entry.played}`
    );
  }

  fs.writeFileSync(REPORT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), rows, providers }, null, 2));
  console.log(`\nfull report: ${REPORT_PATH}`);

  // Exit 0 requires at least one stream that actually decoded frames. Search
  // results and resolved links are not the product; a moving playhead is.
  process.exit(played.length > 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('fatal:', error);
  process.exit(2);
});
