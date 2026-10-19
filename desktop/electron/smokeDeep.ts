/**
 * The deep half of the release smoke check: one community extension installed
 * and used end to end — install, load, search, details, links, playback and a
 * download — through `window.cloudstream`, the bridge the UI itself calls.
 *
 * Through the bridge on purpose. Every step then crosses all four layers of an
 * IPC call (renderer → preload → `ipcMain.handle` → service), on the packaged
 * build, on the OS under test, which is what a viewer's first evening with the
 * app does and what no unit test reaches.
 *
 * Opt-in (`CS3_SMOKE_DEEP=1`, `smoke-package.mjs --deep`) because every step
 * depends on a third-party site: a provider that is down, geo-blocked or behind
 * a new bot wall fails this without the package being at fault. So it is a tool
 * for proving a build on a real machine, not a release gate. The target is
 * configurable (`CS3_SMOKE_DEEP_REPO`, `_PLUGIN`, `_QUERY`); the default is one
 * this project's own analytics measured working (MovieBox: 81 % of 306
 * searches, 79 % of 238 link resolutions, 55 of 55 plays, as of 2026-10-16).
 *
 * The second launch checks the extension survived the restart — installed,
 * registered and loadable without being installed again.
 */

import type { BrowserWindow } from 'electron';
import type { CloudStreamElectronAPI } from './preload.ts';
import type { TorrentResult } from '../src/types/torrent';
import { buildDownloadTask } from '../src/utils/downloadIdentity.ts';

export interface DeepStep {
  id: string;
  timeoutMs: number;
  run: () => Promise<{ ok: boolean; detail: string }>;
}

export interface DeepTarget {
  repository: string;
  plugin: string;
  query: string;
}

export function deepTarget(env: NodeJS.ProcessEnv = process.env): DeepTarget {
  return {
    repository:
      env.CS3_SMOKE_DEEP_REPO?.trim() ||
      'https://raw.githubusercontent.com/phisher98/cloudstream-extensions-phisher/builds/repo.json',
    plugin: env.CS3_SMOKE_DEEP_PLUGIN?.trim() || 'MovieBoxProvider',
    query: env.CS3_SMOKE_DEEP_QUERY?.trim() || 'Interstellar',
  };
}

type Api = CloudStreamElectronAPI;
type AsyncMethod = {
  [K in keyof Api]: Api[K] extends (...args: never[]) => Promise<unknown> ? K : never;
}[keyof Api];
type Args<K extends AsyncMethod> = Api[K] extends (...args: infer P) => unknown ? P : never;
type Result<K extends AsyncMethod> = Api[K] extends (...args: never[]) => Promise<infer R> ? R : never;

/** One bridge call, made from the page exactly as the UI makes it. */
function bridge<K extends AsyncMethod>(win: BrowserWindow, method: K, ...args: Args<K>): Promise<Result<K>> {
  return win.webContents.executeJavaScript(
    `window.cloudstream[${JSON.stringify(method)}](...${JSON.stringify(args)})`,
    true
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls until `probe` answers something truthy, or the deadline passes. */
async function until<T>(probe: () => Promise<T | null | undefined | false>, timeoutMs: number, everyMs = 1_000): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) return value;
    await sleep(everyMs);
  }
  return null;
}

/**
 * Plays a prepared stream for two seconds in a muted, detached `<video>` —
 * the element the player itself uses, so the codecs it accepts are this
 * machine's real ones.
 */
const ELEMENT_PLAYS = `(async (src) => {
  const v = document.createElement('video');
  v.muted = true;
  v.preload = 'auto';
  try {
    v.src = src;
    v.play().catch(() => {});
    const started = Date.now();
    while (Date.now() - started < 45000) {
      if (v.currentTime >= 2) return { ok: true, detail: v.videoWidth + 'x' + v.videoHeight + ', ' + v.currentTime.toFixed(1) + 's played' };
      if (v.error) return { ok: false, detail: 'the element refused it: ' + (v.error.message || 'MediaError ' + v.error.code) };
      await new Promise((r) => setTimeout(r, 250));
    }
    const buffered = v.buffered.length ? v.buffered.end(v.buffered.length - 1).toFixed(1) + 's' : 'nothing';
    return { ok: false, detail: 'nothing played in 45s (currentTime ' + v.currentTime.toFixed(1) + ', readyState ' + v.readyState + ', networkState ' + v.networkState + ', buffered ' + buffered + ')' };
  } finally {
    v.pause();
    v.removeAttribute('src');
    v.load();
  }
})`;

/**
 * An HLS answer is played by hls.js inside the player, which a smoke page does
 * not have; what can be proved without it is that the manifest the pipeline
 * serves leads to media bytes: playlist → variant → first segment.
 */
async function hlsDeliversMedia(manifestUrl: string): Promise<{ ok: boolean; detail: string }> {
  let url = manifestUrl;
  for (let depth = 0; depth < 3; depth++) {
    const text = await (await fetch(url)).text();
    const next = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith('#'));
    if (!next) return { ok: false, detail: `playlist at depth ${depth} names no media` };
    const resolved = new URL(next, url).toString();
    if (/#EXT-X-STREAM-INF/.test(text)) {
      url = resolved;
      continue;
    }
    const segment = await fetch(resolved, { headers: { Range: 'bytes=0-262143' } });
    const bytes = (await segment.arrayBuffer()).byteLength;
    return bytes > 0
      ? { ok: true, detail: `HLS: first segment delivered ${bytes} bytes` }
      : { ok: false, detail: `the first segment answered ${segment.status} with no bytes` };
  }
  return { ok: false, detail: 'more than three levels of playlists' };
}

/** How much the main process itself can read from a loopback stream in 20 s. */
async function bytesFrom(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  let bytes = 0;
  try {
    const response = await fetch(url, { signal: controller.signal });
    const reader = response.body?.getReader();
    while (reader && bytes < 1048576) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
    }
    await reader?.cancel().catch(() => undefined);
    return `read directly: HTTP ${response.status}, ${bytes} bytes`;
  } catch (error) {
    return `read directly: ${bytes} bytes before ${error instanceof Error ? error.name : 'failure'}`;
  } finally {
    clearTimeout(timer);
  }
}

/** Prepares one link through `media:prepare` and proves it plays on the engine the app chose for it. */
async function playOne(
  win: BrowserWindow,
  source: TorrentResult,
  options: { inApp?: boolean } = {}
): Promise<{ ok: boolean; detail: string; strategy: string }> {
  const prepared = await bridge(win, 'preparePlaybackStream', {
    url: source.directUrl!,
    headers: source.directHeaders,
    isM3u8: source.isM3u8,
    isDash: source.isDash,
    drm: source.drm,
    provider: source.providerName,
    // Exactly the player's "Play in this window" request (VideoPlayer): the
    // engine honours `avoidNativeEngine` on the forced path only — without
    // `force` it still routes to mpv, whatever the field's comment says.
    ...(options.inApp ? { refresh: true, force: true, avoidNativeEngine: true } : {}),
  });
  const strategy = prepared.capability?.requiredStrategy ?? 'unknown';
  if (!prepared.ok) return { ok: false, detail: `${strategy}: ${prepared.error}`, strategy };
  if (options.inApp && strategy === 'NATIVE_MPV') {
    if (prepared.sessionId) await bridge(win, 'closePlaybackStream', prepared.sessionId).catch(() => undefined);
    return { ok: false, detail: 'asked for the in-app player and was handed to mpv', strategy };
  }
  let outcome: { ok: boolean; detail: string };
  try {
    if (strategy === 'NATIVE_MPV') {
      const opened = await bridge(win, 'openInNativeEngine', { url: prepared.playbackUrl, title: 'CS3 smoke test' });
      const position = opened.ok
        ? await until(async () => {
            const { snapshot } = await bridge(win, 'getMpvSnapshot');
            return snapshot.positionSeconds >= 2 ? snapshot : null;
          }, 45_000, 500)
        : null;
      await bridge(win, 'mpvStop');
      outcome = position
        ? { ok: true, detail: `mpv played ${position.positionSeconds.toFixed(1)}s (${position.videoCodec}, ${position.hardwareDecoder || 'software'})` }
        : { ok: false, detail: opened.ok ? 'mpv opened it and played nothing in 45s' : `mpv refused it: ${opened.error}` };
    } else if (strategy === 'HLS_NATIVE') {
      outcome = await hlsDeliversMedia(prepared.playbackUrl);
    } else if (strategy === 'EME_NATIVE' || strategy === 'DASH_NATIVE') {
      outcome = { ok: false, detail: "needs the player's own pipeline" };
    } else {
      outcome = (await win.webContents.executeJavaScript(
        `${ELEMENT_PLAYS}(${JSON.stringify(prepared.playbackUrl)})`,
        true
      )) as { ok: boolean; detail: string };
      // Which side failed: a conversion that produces nothing, or an element
      // that cannot play what it produces.
      if (!outcome.ok) outcome = { ok: false, detail: `${outcome.detail}; ${await bytesFrom(prepared.playbackUrl)}` };
    }
  } finally {
    if (prepared.sessionId) await bridge(win, 'closePlaybackStream', prepared.sessionId).catch(() => undefined);
  }
  return { ...outcome, detail: `${strategy} — ${outcome.detail}`, strategy };
}

export function deepSteps(win: BrowserWindow, launch: number, target: DeepTarget = deepTarget()): DeepStep[] {
  let providers: string[] = [];

  const loaded: DeepStep = {
    id: launch === 1 ? 'ext-load' : 'ext-kept',
    timeoutMs: 180_000,
    run: async () => {
      const names = await until(async () => {
        const answer = await bridge(win, 'getExtensionProviders');
        const mine = (answer.providers ?? []).filter((p) => p.pluginInternalName === target.plugin).map((p) => p.name);
        return mine.length > 0 ? mine : null;
      }, 170_000, 2_000);
      if (!names) return { ok: false, detail: `${target.plugin} registered no provider` };
      providers = names;
      return { ok: true, detail: `${target.plugin} registered ${names.join(', ')}` };
    },
  };

  let picked: { url: string; name: string; type?: string; year?: number } | null = null;

  const search: DeepStep = {
    id: launch === 1 ? 'search' : 'search-again',
    timeoutMs: 90_000,
    run: async () => {
      const answer = await bridge(win, 'searchAll', target.query, { providers });
      const results = (answer.results ?? []).filter((r) => !r.adult);
      if (results.length === 0) return { ok: false, detail: answer.error ?? `no results for "${target.query}"` };
      const movie = results.find((r) => /movie/i.test(String(r.type ?? ''))) ?? results[0];
      picked = { url: movie.url, name: movie.name, type: movie.type, year: movie.year };
      return { ok: true, detail: `${results.length} results; using "${movie.name}"${movie.year ? ` (${movie.year})` : ''}` };
    },
  };

  // After a restart the provider list is answered from the registry without
  // starting the JVM, so being listed proves the record survived; a search
  // proves the archive on disk still loads and works.
  if (launch !== 1) return [loaded, search];

  let episode: { url: string; season?: number; episode?: number } | null = null;
  let sources: TorrentResult[] = [];
  let played: TorrentResult | null = null;

  return [
    {
      id: 'ext-install',
      timeoutMs: 240_000,
      run: async () => {
        const listing = await bridge(win, 'fetchRepository', target.repository);
        const plugin = listing.repository?.plugins.find((p) => p.internalName === target.plugin);
        if (!plugin) return { ok: false, detail: listing.error ?? `${target.plugin} is not in ${target.repository}` };
        const installed = await bridge(win, 'installPlugin', plugin, target.repository);
        const tier = installed.report ? `, ${installed.report.recommendedTier}` : '';
        return { ok: installed.ok, detail: `${plugin.name} v${plugin.version}${tier}: ${installed.message}` };
      },
    },
    loaded,
    search,
    {
      id: 'details',
      timeoutMs: 90_000,
      run: async () => {
        const answer = await bridge(win, 'loadMedia', picked!.url);
        if (!answer.detail) return { ok: false, detail: answer.error ?? 'no details' };
        const first = answer.detail.episodes?.[0];
        episode = first ? { url: first.url, season: first.season, episode: first.episode } : null;
        const count = answer.detail.episodes?.length ?? 0;
        return { ok: true, detail: `${answer.detail.name} — ${answer.detail.type}${count ? `, ${count} episodes` : ''}` };
      },
    },
    {
      id: 'links',
      timeoutMs: 150_000,
      run: async () => {
        const answer = await bridge(win, 'getSources', {
          mediaUrl: episode?.url ?? picked!.url,
          ...(episode?.season !== undefined ? { season: episode.season } : {}),
          ...(episode?.episode !== undefined ? { episode: episode.episode } : {}),
        });
        sources = (answer.sources ?? []).filter((s) => Boolean(s.directUrl));
        if (sources.length === 0) return { ok: false, detail: answer.emptyReason ?? answer.error ?? 'no direct links' };
        const kinds = sources.filter((s) => s.isM3u8).length;
        return { ok: true, detail: `${sources.length} links (${kinds} HLS) from ${[...new Set(sources.map((s) => s.providerName))].join(', ')}` };
      },
    },
    {
      id: 'play',
      timeoutMs: 240_000,
      run: async () => {
        const tried: string[] = [];
        for (const source of sources.slice(0, 4)) {
          const outcome = await playOne(win, source);
          if (outcome.ok) {
            played = source;
            return outcome;
          }
          tried.push(outcome.detail);
        }
        return { ok: false, detail: tried.join(' | ') || 'no link to try' };
      },
    },
    {
      // Whatever played first, the same link once more as "Play in this
      // window" sends it: ffmpeg converts, the app's own <video> plays. A live
      // ffmpeg conversion is the OS-sensitive half of the media pipeline, and
      // a link that plays directly or in mpv never reaches it.
      id: 'play-in-app',
      timeoutMs: 180_000,
      run: () => playOne(win, played!, { inApp: true }),
    },
    {
      id: 'download',
      timeoutMs: 180_000,
      run: async () => {
        // A progressive link downloads with the transfer engine alone; an HLS one
        // also needs ffmpeg or yt-dlp, which is a different test.
        const source = sources.find((s) => !s.isM3u8 && !s.isDash) ?? played ?? sources[0];
        const task = buildDownloadTask(source, {
          title: `CS3 smoke ${picked!.name}`,
          mediaUrl: picked!.url,
          providerName: source.providerName,
          mediaType: picked!.type,
          year: picked!.year,
          ...(episode?.season !== undefined ? { season: episode.season } : {}),
          ...(episode?.episode !== undefined ? { episode: episode.episode } : {}),
        });
        if (!task) return { ok: false, detail: 'no download task could be built for the link' };
        const request = await bridge(win, 'requestDownload', task);
        if (!request.ok || !request.taskId) return { ok: false, detail: request.error ?? request.message };
        const id = request.taskId;
        try {
          const progress = await until(async () => {
            const queue = await bridge(win, 'getDownloadQueue');
            const mine = queue.find((t) => t.id === id);
            if (!mine) return { failed: 'the task left the queue' };
            if (mine.state === 'Failed') return { failed: mine.errorMessage ?? 'failed' };
            return mine.state === 'Completed' || mine.bytesDownloaded >= 2 * 1024 * 1024 ? { task: mine } : null;
          }, 170_000, 1_000);
          if (!progress) return { ok: false, detail: 'under 2 MB arrived in 170s' };
          if ('failed' in progress) return { ok: false, detail: String(progress.failed) };
          const mb = (progress.task.bytesDownloaded / 1048576).toFixed(1);
          return { ok: true, detail: `${mb} MB of ${source.isM3u8 ? 'an HLS' : 'a progressive'} link (${progress.task.state})` };
        } finally {
          await bridge(win, 'removeDownload', id, true).catch(() => undefined);
        }
      },
    },
  ];
}
