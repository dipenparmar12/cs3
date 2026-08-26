import http from 'http';
import fs from 'fs';
import path from 'path';
import type { AddressInfo } from 'net';
// `.ts` is load-bearing: the test suite runs under Node's type stripping, which
// is an ESM loader and will not resolve an extensionless specifier. Rollup is
// indifferent and `allowImportingTsExtensions` is already set in both tsconfigs.
import { classifyNetworkError } from './networkResilience.ts';
import type { DiagnosticsSink } from './pluginManager.ts';
import type { SourceLease } from './media/sourceLease.ts';

/**
 * Serves a provider's stream with the headers that provider requires.
 *
 * Extension links routinely only work when accompanied by a `Referer`, and
 * often a specific `User-Agent`. `ExtractorLink` carries both, and until now
 * they reached the download engine and nothing else: playback handed the raw
 * URL to the `<video>` element, which sends neither. A browser cannot be made
 * to — `Referer` is a forbidden header for `fetch` and XHR precisely so pages
 * cannot forge it — so no amount of work in the renderer could fix it.
 *
 * The symptom was two different-looking failures with one cause:
 *
 *  - **HLS**: `manifestLoadError` from hls.js, because the host answered the
 *    playlist request with 403.
 *  - **Progressive**: "could not decode this file", because ffprobe could not
 *    read it either — so the player had no codec information and reported the
 *    generic case.
 *
 * Proxying at the point the stream URL is handed out fixes all three consumers
 * at once — the media element, hls.js, and ffprobe/ffmpeg — because they are
 * given a loopback URL and this is what talks to the origin.
 *
 * **HLS playlists are rewritten**, not merely forwarded. A manifest names its
 * segments, keys and variant playlists by URL, and those requests would go
 * straight from the renderer to the host without headers — succeeding on the
 * manifest and then failing on every segment, which is worse than failing
 * outright. Every URI in the playlist is rewritten to point back here, carrying
 * the same headers.
 *
 * **A stream that dies mid-film is resumed, not surfaced.** Providers sit behind
 * cheap CDNs that reset long connections routinely, and a film is a connection
 * held open for two hours. Because this proxy knows the byte offset it has
 * already delivered, it can re-request the remainder with a `Range` header and
 * carry on writing into the same response — the player sees one uninterrupted
 * stream. This is also where the reported main-process crash lived: the body was
 * piped with no error handler, so a transport failure after the response had
 * been handed over had nothing to catch it.
 *
 * Bound to loopback only. This forwards arbitrary URLs with attacker-influenced
 * headers, and must never be reachable from off the machine.
 */

import os from 'os';

/** Attempts to resume a broken stream before giving up on it. */
const MAX_RESUME_ATTEMPTS = 4;

/** Pause before a resume, so a CDN having a moment is not hammered. */
const RESUME_DELAY_MS = 400;

/** LRU cache limits to prevent memory accumulation in long-running sessions. */
/**
 * Sized for HLS, which was never accounted for: one media playlist mints a
 * route per segment, so a two-hour film at six-second segments is ~1200 from a
 * single rewrite and a multi-variant master with separate audio renditions is
 * several thousand before anything has played. The old cap of 1000 was below
 * the cost of *one* film, so the table thrashed and evicted the playlists that
 * were driving playback. A route is a URL, a small header map and two numbers.
 */
const MAX_ROUTES = 20000;
const ROUTE_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Rate limiting thresholds per stream token to prevent flood loops. */
const RATE_LIMIT_WINDOW_MS = 5000;
const RATE_LIMIT_MAX_REQUESTS = 250;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

interface Route {
  url: string;
  headers: Record<string, string>;
  key?: string;
  /**
   * When this route was minted, or last re-minted by a playlist rewrite.
   *
   * Kept apart from {@link lastAccess} because the two answer different
   * questions and the eviction policy needs both: this one says "a document the
   * player is reading points at me", and `lastAccess` says "the player has
   * actually fetched me". A route can be vital and never yet fetched.
   */
  createdAt?: number;
  /** When this route last served a request. Undefined until it serves one. */
  lastAccess?: number;
  /**
   * Minted while rewriting a playlist, so this is a segment, key or child
   * playlist rather than a URL the app chose. Only these are examined for an
   * image header glued on the front — see {@link unwrapDisguisedSegment}.
   */
  fromPlaylist?: boolean;
  /**
   * Whether this origin honoured a `Range`, once it has been asked one.
   *
   * Remembered per route rather than re-derived per request because a player
   * asks the question once, at open, and every later decision it makes about
   * seeking rests on that first answer.
   */
  rangeSupport?: 'yes' | 'no';
}

interface LocalRoute {
  file: string;
  lastAccess: number;
}

/** Response headers worth passing through; the rest are the proxy's own business. */
const FORWARDED_RESPONSE_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'last-modified',
  'etag',
];

/** Forbidden and hop-by-hop headers that must never be forwarded. */
const FORBIDDEN_REQUEST_HEADERS = new Set([
  'host',
  'content-length',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/** Playlist attributes whose quoted value is a URL. */
const URI_ATTRIBUTE = /URI="([^"]+)"/g;

/**
 * Keeps a `Referer` from getting the whole request thrown away.
 *
 * Chromium refuses to send an `https://` referrer on an `http://` request — the
 * referrer-downgrade rule — and Electron's `net` surfaces that refusal as
 * `net::ERR_BLOCKED_BY_CLIENT`. The request never reaches the network. Measured
 * under Electron 43, holding everything else constant:
 *
 *     http target  + https referer -> ERR_BLOCKED_BY_CLIENT
 *     http target  + http  referer -> 200
 *     https target + https referer -> 200
 *     https target + http  referer -> 200
 *
 * Only the first row fails, and it is a row the app hits routinely: extensions
 * report `Referer` from the page they scraped, which is virtually always
 * `https`, while the media URL that page hands back is quite often plain `http`.
 * Every one of those was dead on arrival, and the failure looked like a network
 * error rather than a header the app chose to send.
 *
 * The scheme is rewritten rather than the header dropped, because what these
 * origins check is the *host* — dropping it fails their hotlink check, which is
 * the problem the referrer was forwarded to solve in the first place.
 */
export function alignRefererScheme(
  targetUrl: string,
  headers: Record<string, string>
): Record<string, string> {
  if (!/^http:\/\//i.test(targetUrl)) return headers;

  const out = { ...headers };
  for (const [name, value] of Object.entries(out)) {
    if (name.toLowerCase() !== 'referer') continue;
    if (/^https:\/\//i.test(value)) out[name] = value.replace(/^https:/i, 'http:');
  }
  return out;
}

/** Our own servers, which need no header injection and no extra hop. */
function isLoopback(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
  } catch {
    return false;
  }
}

/** First byte of `bytes 40000-99999/1000000`, which is where a resume continues. */
function offsetFromContentRange(value: string | null): number | null {
  const match = value?.match(/bytes\s+(\d+)-/i);
  return match ? Number(match[1]) : null;
}

/** First byte of a request's own `bytes=40000-` — a seek, before any reply. */
function offsetFromRange(value: string | undefined): number | null {
  const match = value?.match(/bytes=(\d+)-/i);
  return match ? Number(match[1]) : null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `\x89PNG\r\n\x1a\n` — the signature a disguised segment opens with. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** MPEG-TS packets are 188 bytes and each starts with this. */
const TS_PACKET_SIZE = 188;
const TS_SYNC_BYTE = 0x47;
/** How far into a segment a disguising header may plausibly run. */
const MAX_DISGUISE_PREFIX = 4096;

/**
 * Where the real MPEG-TS starts inside a segment wearing an image header, or 0.
 *
 * Deliberately hard to satisfy by accident: the run of sync bytes at the exact
 * packet stride is the real test, and the signature is only what makes it worth
 * looking. A genuine image cannot pass it, so a mis-detection would take a file
 * that is simultaneously a valid PNG and a valid transport stream.
 */
function disguisedTsOffset(head: Uint8Array): number {
  if (head.length < PNG_SIGNATURE.length) return 0;
  if (!PNG_SIGNATURE.every((byte, i) => head[i] === byte)) return 0;

  const limit = Math.min(head.length - TS_PACKET_SIZE * 3, MAX_DISGUISE_PREFIX);
  for (let offset = PNG_SIGNATURE.length; offset < limit; offset++) {
    if (
      head[offset] === TS_SYNC_BYTE &&
      head[offset + TS_PACKET_SIZE] === TS_SYNC_BYTE &&
      head[offset + TS_PACKET_SIZE * 2] === TS_SYNC_BYTE
    ) {
      return offset;
    }
  }
  return 0;
}

/**
 * Peels an image header off a segment, passing everything else through untouched.
 *
 * The first chunks are buffered only until there is enough to decide — the
 * header is tens of bytes and the decision needs three packets — and the body is
 * then re-emitted with nothing copied that did not have to be.
 */
async function unwrapDisguisedSegment(
  source: ReadableStream<Uint8Array<ArrayBuffer>>
): Promise<{ body: ReadableStream<Uint8Array<ArrayBuffer>>; stripped: number }> {
  const reader = source.getReader();
  const chunks: Uint8Array[] = [];
  let buffered = 0;
  const needed = PNG_SIGNATURE.length + MAX_DISGUISE_PREFIX + TS_PACKET_SIZE * 3;

  let done = false;
  while (buffered < needed) {
    const next = await reader.read();
    if (next.done) {
      done = true;
      break;
    }
    if (!next.value) continue;
    chunks.push(next.value);
    buffered += next.value.byteLength;
    // A body that does not start with the signature can never match, so there
    // is no reason to hold more of it while finding that out.
    if (chunks.length === 1 && disguisedTsOffset(next.value) === 0 &&
        next.value.byteLength >= PNG_SIGNATURE.length &&
        !PNG_SIGNATURE.every((byte, i) => next.value![i] === byte)) {
      break;
    }
  }

  const head = new Uint8Array(buffered);
  let at = 0;
  for (const chunk of chunks) {
    head.set(chunk, at);
    at += chunk.byteLength;
  }

  const stripped = disguisedTsOffset(head);
  const prelude = stripped > 0 ? head.subarray(stripped) : head;

  const body = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      if (prelude.byteLength > 0) controller.enqueue(prelude);
      if (done) controller.close();
    },
    async pull(controller) {
      if (done) return;
      const next = await reader.read();
      if (next.done) {
        done = true;
        controller.close();
        return;
      }
      if (next.value) controller.enqueue(next.value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });

  return { body, stripped };
}

function looksLikeHls(url: string, contentType: string | null): boolean {
  if (contentType) {
    const type = contentType.toLowerCase();
    if (type.includes('mpegurl') || type.includes('m3u8')) return true;
  }
  const clean = url.split(/[?#]/)[0].toLowerCase();
  return (
    clean.endsWith('.m3u8') ||
    clean.endsWith('.m3u') ||
    /\/(getm3u8|m3u8|hls)\b/i.test(clean) ||
    /[?&]format=m3u8/i.test(url)
  );
}

/**
 * Whether this reply is a DASH manifest.
 *
 * The body is consulted, not just the URL, for the same reason the compatibility
 * engine reads manifests rather than matching extensions: providers serve `.mpd`
 * documents as `application/octet-stream` and from addresses with no extension
 * at all. `<MPD` in the first bytes is unambiguous where the URL is not.
 */
function looksLikeDash(url: string, contentType: string | null, body?: string): boolean {
  if (body && /^\s*(<\?xml[^>]*\?>\s*)?<MPD[\s>]/i.test(body.slice(0, 512))) return true;
  if (contentType && contentType.toLowerCase().includes('dash+xml')) return true;
  const clean = url.split(/[?#]/)[0].toLowerCase();
  return clean.endsWith('.mpd');
}

/**
 * The largest body the proxy will read into memory to identify it.
 *
 * A DASH manifest is kilobytes; a film is gigabytes. Anything above this is
 * streamed without being looked at.
 */
const MAX_SNIFF_BYTES = 4 * 1024 * 1024;

/** `<BaseURL>…</BaseURL>`, and the three attributes that name a segment. */
const DASH_BASE_URL = /<BaseURL([^>]*)>([^<]*)<\/BaseURL>/gi;
const DASH_URL_ATTRIBUTE = /\b(media|initialization|sourceURL|initializationSegmentURL)="([^"]*)"/gi;

export class MediaProxy {
  private server: http.Server | null = null;
  private port = 0;
  private routes = new Map<string, Route>();
  /** Directory routes, for DASH — see {@link prefixRouteFor}. */
  private prefixes = new Map<string, Route>();
  /** Leases held by token, for signed URL re-resolution per PRD-40.1 §4.1. */
  private leases = new Map<string, SourceLease>();
  /** Reverse index so a playlist's hundred segments do not mint a token each. */
  private tokensByKey = new Map<string, string>();
  /** Files served from disk, and the reverse map that keeps tokens stable. */
  private localRoutes = new Map<string, LocalRoute>();
  private localTokensByPath = new Map<string, string>();
  /** Allowed directory paths for local file serving. */
  private allowedDirectories = new Set<string>();
  /** Request rate tracking for flood protection. */
  private rateLimits = new Map<string, { count: number; windowStart: number }>();
  private nextToken = 1;
  private fetchImpl: FetchLike;
  private diagnostics: DiagnosticsSink | null = null;

  constructor(fetchImpl: FetchLike) {
    this.fetchImpl = fetchImpl;
    // Default safe directory whitelist
    this.allowedDirectories.add(path.resolve(os.tmpdir()));
    try {
      this.allowedDirectories.add(path.resolve(process.cwd()));
    } catch {}
  }

  /**
   * Adds an allowed base directory for serving local files (e.g. userData, downloads).
   */
  public addAllowedDirectory(dirPath: string): void {
    if (!dirPath) return;
    this.allowedDirectories.add(path.resolve(dirPath));
  }

  /**
   * Validates whether a path is located within allowed directory trees.
   */
  public isPathAllowed(filePath: string): boolean {
    if (!filePath || filePath.includes('\0')) return false;
    const resolved = path.resolve(filePath);
    for (const allowed of this.allowedDirectories) {
      const normalizedAllowed = allowed.endsWith(path.sep) ? allowed : allowed + path.sep;
      if (resolved === allowed || resolved.startsWith(normalizedAllowed)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Where stream failures are reported.
   *
   * These are the most valuable network records the app produces: a stream that
   * breaks at 40 minutes is invisible everywhere else, because the request
   * succeeded and the failure happened long after anything was watching.
   */
  public setDiagnostics(sink: DiagnosticsSink): void {
    this.diagnostics = sink;
  }

  /**
   * Returns a loopback URL that fetches `url` with `headers` applied.
   *
   * ALWAYS proxy direct HTTP/HTTPS URLs so all media requests pass through loopback proxy with
   * standard Chrome User-Agent, origin referer, CORS headers, and range request handling.
   */
  public async wrap(url: string, headers?: Record<string, string>): Promise<string> {
    if (!/^https?:\/\//i.test(url)) return url;
    /**
     * A loopback URL is already ours and is returned untouched.
     *
     * Everything that serves media locally — the torrent engine, this proxy, the
     * transcoder — hands back `http://127.0.0.1:…`, which matches the scheme test
     * above. Without this guard the compatibility engine wraps a torrent stream in
     * a second proxy hop that copies every byte for no reason, and re-wrapping this
     * proxy's own output builds a chain that grows by one hop per call.
     *
     * There is nothing to gain either way: header injection exists to satisfy a
     * third-party CDN's hotlink check, and our own servers set what they need.
     */
    if (isLoopback(url)) return url;
    const cleaned = this.clean(headers);

    await this.ensureServer();
    return this.routeFor(url, cleaned);
  }

  /**
   * PRD-40.1 §4.1: Wraps a SourceLease with stable loopback endpoint.
   *
   * The proxy holds the lease, not just the raw URL. When token expiration occurs,
   * the proxy re-resolves the fresh URL beneath the same loopback token.
   */
  public async wrapLease(lease: SourceLease): Promise<string> {
    const loopbackUrl = await this.wrap(lease.url, lease.headers);
    const token = loopbackUrl.match(/\/stream\/(\d+)/)?.[1];
    if (token) {
      this.leases.set(token, lease);
    }
    return loopbackUrl;
  }

  /**
   * Returns the underlying target URL and headers for a loopback stream token.
   */
  public getTargetRoute(loopbackUrl: string): Route | null {
    if (!isLoopback(loopbackUrl)) return null;
    const direct = loopbackUrl.match(/\/stream\/(\d+)/)?.[1];
    if (direct) {
      const route = this.routes.get(direct);
      if (route) return { url: route.url, headers: { ...route.headers } };
    }
    return null;
  }

  /**
   * Serves a file from disk over the same loopback origin.
   *
   * A finished download used to be handed to `shell.openPath` — the OS default
   * player — so the viewer lost resume position, subtitle search, track
   * selection, the next-episode flow and the compatibility engine, all for a
   * file already sitting on their disk.
   *
   * Routed through HTTP rather than handed over as a `file://` URL because
   * every consumer downstream already speaks this origin: ffprobe, the media
   * element, hls.js and mpv all take a loopback URL today, and `file://` in a
   * `contextIsolation` renderer does not. Range support is what makes seeking
   * work, and it is the whole reason this cannot be a plain `readFile`.
   */
  public async serveFile(filePath: string): Promise<string> {
    if (!filePath || filePath.includes('\0')) {
      throw new Error(`Invalid file path: ${filePath}`);
    }

    const resolved = path.resolve(filePath);

    // Whitelist path verification to prevent path traversal
    if (this.allowedDirectories.size > 0 && !this.isPathAllowed(resolved)) {
      throw new Error(`Access denied: path outside allowed directories: ${resolved}`);
    }

    // Checked here rather than at play time so a moved or deleted file is a
    // clear failure now instead of an empty player later.
    const stat = await fs.promises.stat(resolved);
    if (!stat.isFile()) throw new Error(`Not a file: ${resolved}`);

    await this.ensureServer();
    this.evictExpiredRoutes();

    const existing = this.localTokensByPath.get(resolved);
    const token = existing ?? String(this.nextToken++);
    this.localTokensByPath.set(resolved, token);
    this.localRoutes.set(token, { file: resolved, lastAccess: Date.now() });
    return `http://127.0.0.1:${this.port}/local/${token}`;
  }

  /**
   * Answers a range request over a local file.
   *
   * Kept apart from `stream()` deliberately: that method exists to survive a
   * flaky origin mid-transfer — resuming, re-requesting, counting bytes — and
   * none of that applies to a local disk, where a short read is a real error
   * rather than something to paper over.
   */
  private serveLocal(req: http.IncomingMessage, res: http.ServerResponse, file: string): void {
    let size: number;
    try {
      size = fs.statSync(file).size;
    } catch {
      res.writeHead(404).end('That file is no longer on disk.');
      return;
    }

    const match = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
    const start = match && match[1] ? Number(match[1]) : 0;
    const end = match && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;

    if (start >= size || start > end) {
      // The header the spec requires with a 416; without it a player retries
      // the same bad range forever instead of correcting itself.
      res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
      return;
    }

    const partial = Boolean(match);
    res.writeHead(partial ? 206 : 200, {
      'Content-Type': 'video/mp4',
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
      ...(partial ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
      'Access-Control-Allow-Origin': '*',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    const stream = fs.createReadStream(file, { start, end });
    stream.on('error', () => res.destroy());
    // Seeking abandons the response mid-flight, and an undestroyed read stream
    // holds the file handle open for the life of the process.
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  }

  /**
   * Drops headers the proxy sets itself or must not forward, and sanitizes against header injection.
   *
   * `Host` and `Content-Length` describe the hop, not the request, and
   * forwarding a provider's stale values produces requests the origin rejects.
   */
  private clean(headers?: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers ?? {})) {
      if (!value) continue;
      // Sanitize header key & value against CRLF / null-byte injection
      const cleanKey = key.replace(/[\r\n\0]/g, '').trim();
      const cleanValue = value.replace(/[\r\n\0]/g, '').trim();
      if (!cleanKey || !cleanValue) continue;

      const name = cleanKey.toLowerCase();
      if (FORBIDDEN_REQUEST_HEADERS.has(name)) continue;
      out[cleanKey] = cleanValue;
    }
    return out;
  }

  /**
   * Evicts expired or excess routes to maintain bounded memory consumption.
   */
  private evictExpiredRoutes(): void {
    const now = Date.now();

    /** How long a route has been idle: since it last served, else since it was minted. */
    const idleSince = (route: Route): number => route.lastAccess ?? route.createdAt ?? 0;

    // 1. Evict expired routes
    for (const [token, route] of this.routes.entries()) {
      if (now - idleSince(route) > ROUTE_TTL_MS) {
        if (route.key) this.tokensByKey.delete(route.key);
        this.routes.delete(token);
      }
    }

    for (const [token, prefix] of this.prefixes.entries()) {
      if (now - idleSince(prefix) > ROUTE_TTL_MS) {
        if (prefix.key) this.tokensByKey.delete(prefix.key);
        this.prefixes.delete(token);
      }
    }

    for (const [token, local] of this.localRoutes.entries()) {
      if (now - local.lastAccess > ROUTE_TTL_MS) {
        this.localTokensByPath.delete(local.file);
        this.localRoutes.delete(token);
      }
    }

    /**
     * 2. Trim excess, oldest first — but a route nobody has fetched yet goes last.
     *
     * A plain LRU over `lastAccess` is what broke HLS, and it broke it in the
     * least visible way available. Rewriting one media playlist mints a route
     * per segment, so a two-hour film with two audio renditions minted ~1300 in
     * a single burst against a 1000 cap. The routes evicted to make room were
     * the *oldest*, which are the master playlist and the video variant
     * playlists the master had just handed the player — structural routes that
     * are referenced constantly and fetched rarely. mpv read the master, asked
     * for the video variant it named, and got `404 Unknown stream` from us.
     *
     * Measured on HDHub4U's `hdstream4u.com` playlist: tokens 4 and 5, the two
     * video variants, were gone before the first request for either, and the
     * route table held segments 306–1305.
     *
     * Never-fetched routes are therefore evicted only once every fetched route
     * has been, because "handed to the player and not yet requested" describes
     * something about to be needed, not something finished with. They stay
     * bounded by the pass above: they carry a `createdAt`, so the TTL reaps them
     * whether or not anything ever asked.
     *
     * **And among those, the newest go first — LRU's assumption is inverted
     * here.** For a route that has never served anything, age is not staleness;
     * it is position in the document that minted it. A playlist is rewritten
     * top to bottom, so the oldest unserved routes are the master's variants and
     * the opening segments — the ones needed first — while the newest are the
     * end of the film. Dropping the tail is free: if playback ever reaches it,
     * the player re-reads the playlist and the routes are minted again.
     */
    if (this.routes.size > MAX_ROUTES) {
      const entries = [...this.routes.entries()];
      const served = entries.filter(([, r]) => r.lastAccess !== undefined);
      const unserved = entries.filter(([, r]) => r.lastAccess === undefined);
      served.sort((a, b) => idleSince(a[1]) - idleSince(b[1]));
      unserved.sort((a, b) => idleSince(b[1]) - idleSince(a[1]));

      const toRemove = [...served, ...unserved].slice(0, this.routes.size - MAX_ROUTES);
      for (const [token, route] of toRemove) {
        if (route.key) this.tokensByKey.delete(route.key);
        this.routes.delete(token);
      }
    }
  }

  private routeFor(url: string, headers: Record<string, string>, fromPlaylist = false): string {
    this.evictExpiredRoutes();
    const key = `${url} ${JSON.stringify(headers)}`;
    let token = this.tokensByKey.get(key);
    if (!token) {
      token = String(this.nextToken++);
      this.tokensByKey.set(key, token);
      this.routes.set(token, { url, headers, key, createdAt: Date.now(), fromPlaylist });
    } else {
      // Re-minting is a playlist saying it still points here, which is a reason
      // to keep the route but not evidence anything has fetched it.
      const existing = this.routes.get(token);
      if (existing) existing.createdAt = Date.now();
    }
    return `http://127.0.0.1:${this.port}/stream/${token}`;
  }

  /**
   * A token standing for a *directory* rather than one file.
   *
   * DASH needs this and HLS does not, which is why it did not exist before. An
   * HLS playlist names every segment it has, so each one can be given its own
   * exact route; a DASH `SegmentTemplate` names them with `$Number$` and
   * `$Time$` placeholders the *player* expands, so there is no list of URLs to
   * rewrite — only a base to point somewhere else. `<BaseURL>` becomes one of
   * these, and every relative segment the player derives resolves through it.
   *
   * The base always ends in `/` so `new URL(rest, base)` appends rather than
   * replacing the last path element.
   */
  private prefixRouteFor(baseUrl: string, headers: Record<string, string>): string {
    this.evictExpiredRoutes();
    const normalised = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    const key = `base ${normalised} ${JSON.stringify(headers)}`;
    let token = this.tokensByKey.get(key);
    if (!token) {
      token = String(this.nextToken++);
      this.tokensByKey.set(key, token);
      this.prefixes.set(token, { url: normalised, headers, key, createdAt: Date.now() });
    } else {
      const existing = this.prefixes.get(token);
      if (existing) existing.createdAt = Date.now();
    }
    return `http://127.0.0.1:${this.port}/base/${token}/`;
  }

  /**
   * Resolves `/base/<token>/<rest>` against the base that token stands for.
   *
   * Returns null when the result would leave the base's origin. The suffix
   * arrives from the renderer and a `..` in it would otherwise turn a
   * directory route into the arbitrary-URL fetcher `wrap` already is — which is
   * fine when *we* chose the URL and is not when a manifest did.
   */
  private resolvePrefixed(token: string, rest: string): Route | null {
    const prefix = this.prefixes.get(token);
    if (!prefix) return null;
    prefix.lastAccess = Date.now();
    try {
      const target = new URL(rest, prefix.url);
      const base = new URL(prefix.url);
      if (target.origin !== base.origin) return null;
      if (!target.pathname.startsWith(base.pathname)) return null;
      return { url: target.toString(), headers: prefix.headers };
    } catch {
      return null;
    }
  }

  private isRateLimited(key: string): boolean {
    const now = Date.now();
    const tracker = this.rateLimits.get(key);
    if (!tracker || now - tracker.windowStart > RATE_LIMIT_WINDOW_MS) {
      this.rateLimits.set(key, { count: 1, windowStart: now });
      return false;
    }
    tracker.count++;
    return tracker.count > RATE_LIMIT_MAX_REQUESTS;
  }

  private async ensureServer(): Promise<void> {
    if (this.server) return;
    this.server = http.createServer((req, res) => {
      void this.handle(req, res);
    });
    await new Promise<void>((resolve) => {
      // Loopback only: see the class comment.
      this.server!.listen(0, '127.0.0.1', () => {
        this.port = (this.server!.address() as AddressInfo).port;
        resolve();
      });
    });
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      });
      res.end();
      return;
    }

    /**
     * Two shapes: `/stream/<token>` is one file, `/base/<token>/<rest>` is a
     * path inside a directory route. Only DASH mints the second kind.
     */
    const local = req.url?.match(/^\/local\/(\d+)/)?.[1];
    if (local) {
      if (this.isRateLimited(`local_${local}`)) {
        res.writeHead(429, { 'Retry-After': '1' }).end('Too Many Requests');
        return;
      }
      const entry = this.localRoutes.get(local);
      if (!entry) {
        res.writeHead(404).end('Unknown file');
        return;
      }
      entry.lastAccess = Date.now();
      this.serveLocal(req, res, entry.file);
      return;
    }

    const direct = req.url?.match(/^\/stream\/(\d+)/)?.[1];
    const prefixed = req.url?.match(/^\/base\/(\d+)\/(.*)$/);
    const routeToken = direct ?? prefixed?.[1];
    if (routeToken && this.isRateLimited(`route_${routeToken}`)) {
      res.writeHead(429, { 'Retry-After': '1' }).end('Too Many Requests');
      return;
    }

    const route = direct
      ? this.routes.get(direct)
      : prefixed
        ? this.resolvePrefixed(prefixed[1], decodeURIComponent(prefixed[2]))
        : undefined;
    if (!route) {
      res.writeHead(404).end('Unknown stream');
      return;
    }
    route.lastAccess = Date.now();

    const CHROME_USER_AGENT =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

    const hasUserAgent = Object.keys(route.headers).some(
      (k) => k.toLowerCase() === 'user-agent'
    );

    const requestHeaders: Record<string, string> = alignRefererScheme(route.url, {
      ...(hasUserAgent ? {} : { 'User-Agent': CHROME_USER_AGENT }),
      ...route.headers,
      ...(req.headers.range ? { Range: String(req.headers.range) } : {}),
    });

    try {
      let upstream = await this.fetchImpl(route.url, {
        method: req.method === 'HEAD' ? 'HEAD' : 'GET',
        headers: requestHeaders,
        redirect: 'follow',
      });

      const lease = direct ? this.leases.get(direct) : undefined;

      // PRD-40.1 §4.1: Signed-URL token expiry pattern detection and refresh.
      if (
        lease &&
        (upstream.status === 401 || upstream.status === 403) &&
        lease.shouldTriggerRefresh(upstream.status)
      ) {
        try {
          const fresh = await lease.refreshSource();
          route.url = fresh.url;
          route.headers = this.clean(fresh.headers);
          // A refreshed link can land on a different host in the same CDN pool,
          // and the two halves of that pool do not always agree about ranges.
          // The old verdict describes a URL that is gone.
          route.rangeSupport = undefined;
          const freshHasUserAgent = Object.keys(route.headers).some(
            (k) => k.toLowerCase() === 'user-agent'
          );
          const refreshedHeaders = alignRefererScheme(route.url, {
            ...(freshHasUserAgent ? {} : { 'User-Agent': CHROME_USER_AGENT }),
            ...route.headers,
            ...(req.headers.range ? { Range: String(req.headers.range) } : {}),
          });
          upstream = await this.fetchImpl(route.url, {
            method: req.method === 'HEAD' ? 'HEAD' : 'GET',
            headers: refreshedHeaders,
            redirect: 'follow',
          });
        } catch (refreshErr) {
          this.recordFailure(
            route.url,
            refreshErr,
            `SourceLease refresh failed on token ${direct} (status ${upstream.status})`
          );
        }
      }

      const contentType = upstream.headers.get('content-type');

      if (looksLikeHls(route.url, contentType)) {
        const body = await upstream.text();
        const rewritten = this.rewritePlaylist(body, upstream.url || route.url, route.headers);
        res.writeHead(upstream.status, {
          'Content-Type': contentType ?? 'application/vnd.apple.mpegurl',
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        });
        res.end(rewritten);
        return;
      }

      /**
       * DASH manifests are rewritten for the same reason playlists are, and it
       * had never been done.
       *
       * A manifest names its segments relative to its own address. Serving one
       * unmodified from loopback means the player resolves them against
       * `http://127.0.0.1:PORT/stream/<token>` and asks this proxy for paths it
       * has no route for — so every segment 404s. It is not only the new Shaka
       * path that needed this: ffmpeg's DASH demuxer resolves relative segments
       * exactly the same way, so the existing remux path was broken for every
       * manifest that did not spell its segments out in full.
       *
       * The manifest is fetched as text before the check because a provider
       * serving `application/octet-stream` is routine; `looksLikeDash` reads the
       * body when the headers will not say.
       */
      if (looksLikeDash(route.url, contentType)) {
        const body = await upstream.text();
        const rewritten = this.rewriteDashManifest(body, upstream.url || route.url, route.headers);
        res.writeHead(upstream.status, {
          'Content-Type': 'application/dash+xml',
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        });
        res.end(rewritten);
        return;
      }

      /**
       * The body-sniffed case: nothing in the URL or the content type said
       * "manifest", so it is only recognisable from its first bytes.
       *
       * **Bounded by declared length, and that bound is load-bearing.** Reading
       * the body to look at it means buffering it, and a provider serving a
       * 5 GB MKV as `application/octet-stream` with no content type is not
       * unusual. Sniffing that would hold the whole film in memory and delay
       * the first byte until the last one arrived. So a body is only read when
       * the origin said how big it is and it is manifest-sized, or when the
       * content type already says XML.
       */
      const declaredLength = Number(upstream.headers.get('content-length') ?? NaN);
      const sniffable =
        (Number.isFinite(declaredLength) && declaredLength > 0 && declaredLength <= MAX_SNIFF_BYTES) ||
        /application\/xml|text\/xml/i.test(contentType ?? '');

      if (sniffable && !req.headers.range) {
        /**
         * Read as bytes, and decoded only to look at.
         *
         * This used to be `await upstream.text()` followed by `res.end(body)`,
         * which silently destroyed every binary body small enough to reach it:
         * the bytes were decoded as UTF-8, and anything that is not valid UTF-8
         * became U+FFFD and came back out as three bytes where one went in. A
         * 704 KB HLS segment left here 1.27 MB long and no longer a media file.
         * It survived because media requests almost always carry a `Range`,
         * which skips this branch — so only the occasional un-ranged first
         * fetch of a small segment was corrupted, and it read as a bad source.
         */
        const raw = Buffer.from(await upstream.arrayBuffer());
        const body = raw.toString('utf8');
        if (looksLikeDash(route.url, contentType, body)) {
          const rewritten = this.rewriteDashManifest(body, upstream.url || route.url, route.headers);
          res.writeHead(upstream.status, {
            'Content-Type': 'application/dash+xml',
            'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          });
          res.end(rewritten);
          return;
        }
        // A disguised segment can arrive here too, when the player's first
        // fetch of it carries no Range.
        const stripped = route.fromPlaylist ? disguisedTsOffset(raw) : 0;
        res.writeHead(upstream.status, {
          'Content-Type': stripped > 0 ? 'video/mp2t' : contentType ?? 'application/octet-stream',
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(stripped > 0 ? raw.subarray(stripped) : raw);
        return;
      }

      /**
       * Whether the origin honours `Range`, decided from what it just did.
       *
       * This proxy is the only component that ever sees the origin's answer, so
       * it is the only one that can tell the player the truth — and passing the
       * origin's headers through unexamined told it two different lies.
       *
       * The hosts in the corpus fall into three shapes and only one of them
       * describes itself correctly:
       *
       *  - `206` + `Content-Range` + `Accept-Ranges: bytes` (sssrr.org) — honest.
       *  - `206` + `Content-Range` and **no** `Accept-Ranges` (the gdflix
       *    `workers.dev` mirrors) — seekable, but nothing in the reply says so,
       *    so a player reading only `Accept-Ranges` concludes it cannot seek.
       *  - `200` + the whole file from byte zero whatever was asked for
       *    (`video-downloads.googleusercontent.com`, the GDFlix "Instant
       *    Download" link) — **not** seekable, and it does not say that either;
       *    it simply ignores the header and sends 3.2 GB from the start.
       *
       * A reply carrying `Content-Range` proves the origin honoured the range.
       * A ranged request answered `200` proves it did not. Either way the client
       * is told explicitly, so it never has to guess and never has to be forced.
       */
      const rangeRequested = offsetFromRange(requestHeaders.Range) !== null;
      const honouredRange =
        upstream.status === 206 || Boolean(upstream.headers.get('content-range'));
      if (rangeRequested) {
        route.rangeSupport = honouredRange ? 'yes' : 'no';
      }

      /**
       * The origin ignored a seek, so the body it is holding starts at byte zero
       * while the client is expecting byte `requestedOffset`.
       *
       * Forwarding it is the silent-corruption case: the player is handed the
       * opening of the film labelled as its middle, and every byte after that is
       * misattributed. `416` says the one true thing — this offset cannot be
       * served — and leaves the player to carry on from where it already is
       * rather than resyncing onto rubbish.
       */
      const requestedOffset = offsetFromRange(String(req.headers.range ?? '')) ?? 0;
      if (requestedOffset > 0 && !honouredRange && upstream.status === 200) {
        this.recordFailure(
          route.url,
          new Error(`origin ignored Range: bytes=${requestedOffset}- and answered HTTP 200`),
          'Refused to serve byte-zero data as a mid-file range'
        );
        try {
          await upstream.body?.cancel();
        } catch {
          // The origin hung up first; nothing left to release.
        }
        const total = upstream.headers.get('content-length');
        res.writeHead(416, {
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
          'Accept-Ranges': 'none',
          ...(total ? { 'Content-Range': `bytes */${total}` } : {}),
        }).end();
        return;
      }

      const headers: Record<string, string> = {
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      };
      for (const name of FORWARDED_RESPONSE_HEADERS) {
        const value = upstream.headers.get(name);
        if (value) headers[name] = value;
      }

      /**
       * Stated rather than forwarded, and stated in both directions.
       *
       * Saying `bytes` for the `workers.dev` shape is what restores seeking on a
       * source that always supported it; saying `none` for the googleusercontent
       * shape is what stops a player attempting a seek that can only be answered
       * by reading the file from the beginning — which on a 3.2 GB link is the
       * frozen timeline this whole path was reported for.
       */
      const support = route.rangeSupport ?? (honouredRange ? 'yes' : undefined);
      if (support) headers['Accept-Ranges'] = support === 'yes' ? 'bytes' : 'none';

      if (req.method === 'HEAD' || !upstream.body) {
        res.writeHead(upstream.status, headers);
        res.end();
        return;
      }

      /**
       * Segments disguised as images are unwrapped before the demuxer sees them.
       *
       * HDHub4U's `hdstream4u.com` playlists point at TikTok's image CDN, which
       * serves only images — so each segment is a **real 70-byte PNG header with
       * the MPEG-TS glued on behind it**, `Content-Type: image/png` and all. This
       * is a step beyond the `.png`-named segments `-extension_picky` was added
       * for: there the bytes were already TS and only the name lied, so opening
       * the extension allow-list was enough. Here the bytes lie too, and no
       * demuxer option helps — FFmpeg reads a PNG, finds no elementary stream and
       * stops, with nothing in the log naming the cause.
       *
       * Only segments minted by a playlist rewrite are examined, and only bytes
       * that are unambiguous: the PNG signature, then a run of TS sync bytes at
       * the 188-byte stride, with the remaining length an exact multiple of 188.
       * Measured on a real segment — 704,318 bytes in, 3,745 aligned packets and
       * a clean `h264 + aac` after the strip.
       */
      let body = upstream.body;
      if (route.fromPlaylist) {
        const unwrapped = await unwrapDisguisedSegment(body);
        body = unwrapped.body;
        if (unwrapped.stripped > 0) {
          const declared = Number(headers['content-length']);
          if (Number.isFinite(declared)) {
            headers['content-length'] = String(Math.max(0, declared - unwrapped.stripped));
          }
          // The container is decided by the bytes, and the bytes are TS now.
          headers['content-type'] = 'video/mp2t';
        }
      }

      res.writeHead(upstream.status, headers);

      await this.stream(
        new Response(body, { status: upstream.status, headers: upstream.headers }),
        res,
        route,
        requestHeaders,
        lease
      );
    } catch (error) {
      this.recordFailure(route.url, error, 'Upstream request failed before any body was sent');
      if (!res.headersSent) res.writeHead(502);
      res.end(error instanceof Error ? error.message : 'Upstream request failed');
    }
  }

  /**
   * Forwards a body, counting it, and resumes it if the transport fails.
   *
   * Read explicitly rather than piped. `Readable.fromWeb(body).pipe(res)` — what
   * this replaces — has two faults that only appear once something goes wrong:
   * `pipe` does not forward errors, so a failure on the source stream reached an
   * `EventEmitter` with no `error` listener and took the whole process down with
   * it; and it leaves nobody counting bytes, so there is no offset to resume
   * from even if the failure were caught.
   *
   * Reading in a loop fixes both. The failure lands inside a `try`, and `sent`
   * is exact, so the remainder can be re-requested with a `Range` header and
   * written into the same response. The player never learns anything happened.
   */
  private async stream(
    first: Response,
    res: http.ServerResponse,
    route: Route,
    requestHeaders: Record<string, string>,
    lease?: SourceLease
  ): Promise<void> {
    /**
     * Where this response started in the file.
     *
     * A resume has to ask for `startedAt + sent`, not `sent`: the client may
     * itself have asked for a range — every seek does — and resuming a request
     * that began at 40 MB from byte zero would splice the start of the film into
     * the middle of it.
     */
    const startedAt = offsetFromContentRange(first.headers.get('content-range')) ??
      offsetFromRange(requestHeaders.Range) ??
      0;

    // Resuming is only sound when the origin honours ranges. Several of the
    // hosts these links point at answer a range request with a 200 and the whole
    // file, and re-requesting one of those would restart the film rather than
    // continue it.
    const resumable =
      first.status === 206 || (first.headers.get('accept-ranges') ?? '').toLowerCase().includes('bytes');

    let response = first;
    let sent = 0;
    let clientGone = false;
    res.on('close', () => {
      clientGone = true;
    });

    for (let attempt = 0; attempt <= MAX_RESUME_ATTEMPTS; attempt++) {
      try {
        await this.pump(response, res, () => clientGone, (n) => {
          sent += n;
          if (sent > 0 && lease) {
            lease.markStreamSuccess();
          }
        });
        res.end();
        return;
      } catch (error) {
        // The viewer closed the player or seeked elsewhere. Not a failure, and
        // resuming would fetch a film nobody is watching.
        if (clientGone || res.writableEnded) return;

        const failure = classifyNetworkError(error);
        const canResume = resumable && failure.retryable && attempt < MAX_RESUME_ATTEMPTS;

        if (lease && canResume) {
          lease.recordReconnect();
        }

        this.recordFailure(
          route.url,
          error,
          canResume
            ? `Stream failed after ${sent} byte(s); resuming from ${startedAt + sent}`
            : `Stream failed after ${sent} byte(s) and could not be resumed`,
          {
            attempt: attempt + 1,
            resumable,
            offset: startedAt + sent,
          }
        );

        if (!canResume) {
          // Ending rather than destroying: a short read is something the player
          // and ffmpeg both understand, and it lets the failover in
          // `playbackSession` see a source that stopped rather than a hang.
          res.end();
          return;
        }

        await delay(RESUME_DELAY_MS * (attempt + 1));
        if (clientGone || res.writableEnded) return;

        response = await this.fetchImpl(route.url, {
          method: 'GET',
          headers: { ...requestHeaders, Range: `bytes=${startedAt + sent}-` },
          redirect: 'follow',
        });

        // An origin that answers a resume with 200 is about to send the file
        // from the beginning, which would corrupt what has already been written.
        if (response.status !== 206 || !response.body) {
          this.recordFailure(
            route.url,
            new Error(`resume answered HTTP ${response.status}`),
            'Origin ignored the resume range; ending the stream instead of corrupting it'
          );
          res.end();
          return;
        }
      }
    }
  }

  /**
   * Copies one response body into the client, respecting backpressure.
   *
   * The `drain` wait is also watched for the socket closing, because a client
   * that disappears mid-write never drains and the await would otherwise hang
   * for the lifetime of the app.
   */
  private async pump(
    response: Response,
    res: http.ServerResponse,
    cancelled: () => boolean,
    onBytes: (count: number) => void
  ): Promise<void> {
    if (!response.body) return;
    const reader = response.body.getReader();

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        if (cancelled() || res.writableEnded) return;
        if (!value) continue;

        onBytes(value.byteLength);
        if (!res.write(Buffer.from(value.buffer, value.byteOffset, value.byteLength))) {
          await new Promise<void>((resolve) => {
            const finish = () => {
              res.off('drain', finish);
              res.off('close', finish);
              resolve();
            };
            res.once('drain', finish);
            res.once('close', finish);
          });
        }
      }
    } finally {
      // Releasing the lock lets the underlying connection be torn down; without
      // it a cancelled stream holds its socket until GC.
      try {
        reader.releaseLock();
      } catch {
        // Already released by the error that brought us here.
      }
    }
  }

  private recordFailure(
    url: string,
    error: unknown,
    message: string,
    extra: Record<string, unknown> = {}
  ): void {
    const failure = classifyNetworkError(error);
    if (failure.aborted) return;

    this.diagnostics?.record({
      level: 'warn',
      stage: 'playback',
      source: 'MediaProxy',
      url,
      message: `${failure.code ?? 'network error'}: ${message}`,
      detail: [
        `code:   ${failure.code ?? 'none'}`,
        `raw:    ${failure.message}`,
        ...Object.entries(extra).map(([key, value]) => `${key.padEnd(7)}: ${String(value)}`),
      ].join('\n'),
    });
  }

  /**
   * Points every URL in a playlist back at this proxy.
   *
   * Covers both forms a playlist uses them in: bare lines (segments and variant
   * playlists) and quoted `URI="…"` attributes (encryption keys, init segments,
   * alternate renditions). Missing either means the request that uses it goes
   * direct and arrives without headers.
   *
   * Relative URIs are resolved against the *final* upstream URL rather than the
   * requested one, so a playlist reached through a redirect still resolves its
   * segments against where it actually came from.
   */
  private rewritePlaylist(body: string, baseUrl: string, headers: Record<string, string>): string {
    const absolute = (uri: string): string => {
      try {
        return this.routeFor(new URL(uri, baseUrl).toString(), headers, true);
      } catch {
        return uri;
      }
    };

    return body
      .split('\n')
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed) return line;

        if (trimmed.startsWith('#')) {
          return trimmed.includes('URI="')
            ? line.replace(URI_ATTRIBUTE, (_, uri: string) => `URI="${absolute(uri)}"`)
            : line;
        }
        return absolute(trimmed);
      })
      .join('\n');
  }

  /**
   * Points a DASH manifest's segments back at this proxy.
   *
   * Three things name a URL in an MPD and all three are handled, because
   * missing any one sends those requests direct and they arrive without the
   * provider's `Referer`:
   *
   * - **`<BaseURL>`** — the element every relative segment resolves against. It
   *   is replaced with a *directory* route, which is the whole reason
   *   {@link prefixRouteFor} exists: `SegmentTemplate` names segments with
   *   `$Number$` placeholders the player expands at request time, so there is no
   *   list of URLs to rewrite, only a base to redirect.
   * - **Absolute `media` / `initialization` / `sourceURL` attributes** — rewritten
   *   by pointing their *directory* at a route and leaving the filename, which
   *   keeps any placeholder in the filename intact.
   * - **No `<BaseURL>` at all** — one is inserted, pointing at the manifest's own
   *   directory. Without it the player resolves relative segments against the
   *   loopback manifest URL and asks for paths this proxy has no route for.
   *
   * Rewritten with regular expressions rather than an XML parser, matching how
   * the compatibility engine already sniffs manifests. The trade is deliberate:
   * an unparseable manifest is passed through slightly wrong rather than
   * throwing, and no XML dependency joins the main process for one document
   * type.
   */
  private rewriteDashManifest(
    body: string,
    manifestUrl: string,
    headers: Record<string, string>
  ): string {
    const directoryOf = (url: string): string => url.slice(0, url.lastIndexOf('/') + 1);
    const manifestBase = directoryOf(manifestUrl);

    const proxiedDirectory = (absolute: string): string =>
      this.prefixRouteFor(directoryOf(absolute), headers);

    let sawBaseUrl = false;
    let rewritten = body.replace(DASH_BASE_URL, (match, attrs: string, value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return match;
      sawBaseUrl = true;
      try {
        const absolute = new URL(trimmed, manifestBase).toString();
        return `<BaseURL${attrs}>${this.prefixRouteFor(absolute, headers)}</BaseURL>`;
      } catch {
        return match;
      }
    });

    rewritten = rewritten.replace(DASH_URL_ATTRIBUTE, (match, name: string, value: string) => {
      // Relative values are handled by BaseURL; only absolute ones escape it.
      if (!/^https?:\/\//i.test(value)) return match;
      try {
        const directory = proxiedDirectory(value);
        const file = value.slice(value.lastIndexOf('/') + 1);
        return `${name}="${directory}${file}"`;
      } catch {
        return match;
      }
    });

    if (!sawBaseUrl) {
      const base = this.prefixRouteFor(manifestBase, headers);
      rewritten = rewritten.replace(
        /(<MPD[^>]*>)/i,
        (match) => `${match}\n  <BaseURL>${base}</BaseURL>`
      );
    }

    return rewritten;
  }

  /** Wired into app shutdown, like every other socket owner. */
  public shutdown(): void {
    this.routes.clear();
    this.prefixes.clear();
    this.tokensByKey.clear();
    this.localRoutes.clear();
    this.localTokensByPath.clear();
    this.rateLimits.clear();
    this.server?.close();
    this.server = null;
  }
}
