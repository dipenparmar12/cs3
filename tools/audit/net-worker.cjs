/**
 * The provider audit's network: every byte of every *source* request goes
 * through Chromium's network stack, as `MediaProxy`'s do in the app (Provider
 * Compatibility Audit PRD §5.1, G-03). Node's `fetch` honours neither the
 * system proxy nor the app's DNS, and judges some hosts differently.
 *
 * Headless Electron (S10 opens one hidden window per playback), its own
 * throwaway userData (the first argument) and an in-memory session: nothing
 * it does touches a real profile.
 * It prints one ready line on stdout, `{"id":"ready","port":…,"token":…}`,
 * and then takes requests as JSON POSTs to that loopback port carrying the
 * token in `X-Audit-Token` (Electron's main process gets no usable stdin on
 * Windows, so stdio cannot be the channel):
 *
 *   → {"op":"fetch","url":"…","method":"GET","headers":{…},"cap":65536,"timeoutMs":20000}
 *   ← {"ok":true,"status":206,"headers":{…},"url":"…","redirects":["host",…],
 *      "body":"<base64>","bytes":65536,"truncated":true,"ms":412}
 *   → {"op":"stream","url":"…","method":"GET","headers":{…},"cap":33554432,"timeoutMs":20000}
 *   ← the upstream body itself, as it arrives; status, headers, final URL and
 *     redirects in `x-audit-status`, `x-audit-headers` (base64 JSON),
 *     `x-audit-url`, `x-audit-redirects`. The socket is destroyed, never
 *     ended, when the cap is reached or upstream fails mid-body, so a cut body
 *     never reads as the end of the file; hanging up aborts the upstream.
 *   → {"op":"play","src":"http://127.0.0.1:…","kind":"hls"|"file","wallMs":12000,"enoughSeconds":5}
 *   ← {"ok":true,"playedSeconds":5.1,"startMs":880,"width":1280,…,"error":null,"wallMs":6400}
 *   → {"op":"quit"}
 *
 * It quits when the runner's process (`CS3_AUDIT_PARENT_PID`) is gone.
 *
 * The body is read until `cap` bytes and then the request is cancelled and
 * aborted: the meter stops the transfer, it does not discard the rest of it
 * (AGENTS §9). Redirects are followed by hand (at most 8) so the hops can be
 * counted. Requests carry the app's referrer policy (`unsafe-url`, AGENTS §12)
 * and its Chrome user agent unless the caller sets one or asks for none.
 *
 *   desktop/node_modules/electron/dist/electron tools/audit/net-worker.cjs <userDataDir>
 */
const { app, BrowserWindow, session } = require('electron');
const crypto = require('node:crypto');
const http = require('node:http');
const path = require('node:path');

const CHROME_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const MAX_REDIRECTS = 8;

const userData = process.argv.find((arg, i) => i > 1 && !arg.startsWith('-') && !arg.endsWith('.cjs'));
if (userData) app.setPath('userData', userData);
app.disableHardwareAcceleration();
// S10 plays in a window nobody sees: it must start unprompted and keep playing while hidden.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-media-suspend');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.on('window-all-closed', () => {});

function send(frame) {
  process.stdout.write(`${JSON.stringify(frame)}\n`);
}

function headersOf(response) {
  const out = {};
  response.headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

async function readCapped(response, cap, controller) {
  const chunks = [];
  let bytes = 0;
  let truncated = false;
  if (!response.body || cap <= 0) {
    truncated = Boolean(response.body);
    if (response.body) await response.body.cancel().catch(() => {});
    controller.abort();
    return { body: Buffer.alloc(0), bytes, truncated };
  }
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const room = cap - bytes;
    if (value.byteLength >= room) {
      chunks.push(Buffer.from(value.buffer, value.byteOffset, room));
      bytes += room;
      // At the cap nothing more is read, not even to learn whether the body ended.
      truncated = true;
      await reader.cancel().catch(() => {});
      controller.abort();
      break;
    }
    chunks.push(Buffer.from(value));
    bytes += value.byteLength;
  }
  return { body: Buffer.concat(chunks), bytes, truncated };
}

/**
 * Redirect hops. `session.fetch` refuses `redirect: 'manual'` ("Redirect was
 * cancelled") and its `response.url` still names the first URL, so hops are
 * read from the session's own redirect events: each `from → to` is kept and
 * walked forward from the requested URL once the answer is in, then dropped,
 * since a signed link redirects somewhere new next time.
 */
const forward = new Map();

function noteRedirect(from, to) {
  forward.set(from, to);
  if (forward.size > 5000) forward.delete(forward.keys().next().value);
}

/** The hosts walked from `url`, and where the walk ended. */
function walkRedirects(url) {
  const hosts = [];
  let at = url;
  while (forward.has(at) && hosts.length < MAX_REDIRECTS) {
    const next = forward.get(at);
    forward.delete(at);
    try {
      hosts.push(new URL(next).host);
    } catch {
      hosts.push('<unparseable>');
    }
    at = next;
  }
  return { hosts, finalUrl: at };
}

async function fetchOnce(ses, request) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs ?? 20_000);
  const headers = { ...(request.headers ?? {}) };
  const hasUa = Object.keys(headers).some((k) => k.toLowerCase() === 'user-agent');
  if (!hasUa && !request.noUserAgent) headers['User-Agent'] = CHROME_USER_AGENT;
  try {
    const response = await ses.fetch(request.url, {
      method: request.method ?? 'GET',
      headers,
      redirect: 'follow',
      referrerPolicy: 'unsafe-url',
      signal: controller.signal,
      bypassCustomProtocolHandlers: true,
    });
    const read =
      request.method === 'HEAD'
        ? { body: Buffer.alloc(0), bytes: 0, truncated: false }
        : await readCapped(response, request.cap ?? 65536, controller);
    const { hosts, finalUrl } = walkRedirects(request.url);
    return {
      ok: true,
      status: response.status,
      headers: headersOf(response),
      url: finalUrl,
      redirects: hosts,
      body: read.body.toString('base64'),
      bytes: read.bytes,
      truncated: read.truncated,
      ms: Date.now() - started,
    };
  } catch (error) {
    const timedOut = controller.signal.aborted;
    return { ok: false, error: timedOut ? 'timed out' : String(error?.message ?? error), redirects: [], ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch, but hand the body through as it arrives (the app's proxy streams; a slice that must fill first does not). */
async function stream(ses, request, res) {
  const controller = new AbortController();
  const headersTimer = setTimeout(() => controller.abort(), request.timeoutMs ?? 20_000);
  let idle;
  const stall = () => {
    clearTimeout(idle);
    idle = setTimeout(() => controller.abort(), request.timeoutMs ?? 20_000);
  };
  // The consumer hung up: stop the transfer, do not finish it (AGENTS §9).
  res.on('close', () => {
    if (!res.writableFinished) controller.abort();
  });
  const headers = { ...(request.headers ?? {}) };
  const hasUa = Object.keys(headers).some((k) => k.toLowerCase() === 'user-agent');
  if (!hasUa && !request.noUserAgent) headers['User-Agent'] = CHROME_USER_AGENT;
  let response;
  try {
    response = await ses.fetch(request.url, {
      method: request.method ?? 'GET',
      headers,
      redirect: 'follow',
      referrerPolicy: 'unsafe-url',
      signal: controller.signal,
      bypassCustomProtocolHandlers: true,
    });
  } catch (error) {
    clearTimeout(headersTimer);
    const message = controller.signal.aborted ? 'timed out' : String(error?.message ?? error);
    res.writeHead(502, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: false, error: message }));
    return;
  }
  clearTimeout(headersTimer);
  const { hosts, finalUrl } = walkRedirects(request.url);
  res.writeHead(200, {
    'content-type': 'application/octet-stream',
    'x-audit-status': String(response.status),
    'x-audit-headers': Buffer.from(JSON.stringify(headersOf(response))).toString('base64'),
    'x-audit-url': encodeURI(finalUrl),
    'x-audit-redirects': hosts.join(','),
  });
  if (!response.body || request.method === 'HEAD') {
    res.end();
    return;
  }
  const reader = response.body.getReader();
  const cap = request.cap ?? 65536;
  let bytes = 0;
  try {
    stall();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      stall();
      const room = cap - bytes;
      const chunk = value.byteLength > room ? value.subarray(0, room) : value;
      bytes += chunk.byteLength;
      if (!res.write(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength))) {
        await new Promise((resolve) => res.once('drain', resolve).once('close', resolve));
      }
      if (bytes >= cap) throw new Error('cap reached');
    }
    res.end();
  } catch {
    await reader.cancel().catch(() => {});
    controller.abort();
    res.destroy();
  } finally {
    clearTimeout(idle);
  }
}

/**
 * S10's element tier: `play.html` in a hidden window, read every 250 ms
 * until the playhead has moved `enoughSeconds`, the element reports an
 * error, or `wallMs` runs out. The window is destroyed either way.
 */
async function play(ses, request) {
  const started = Date.now();
  const window = new BrowserWindow({
    show: false,
    width: 640,
    height: 360,
    webPreferences: { session: ses, backgroundThrottling: false, contextIsolation: true, sandbox: true },
  });
  let last = null;
  try {
    const page = path.join(__dirname, 'play.html');
    const hash = encodeURIComponent(JSON.stringify({ src: request.src, kind: request.kind }));
    await window.loadFile(page, { hash });
    while (Date.now() - started < request.wallMs) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      last = await window.webContents.executeJavaScript('window.__auditRead()');
      if (last.error || last.playedSeconds >= request.enoughSeconds) break;
    }
    return { ok: true, ...last, wallMs: Date.now() - started };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error), wallMs: Date.now() - started, ...(last ? { last } : {}) };
  } finally {
    window.destroy();
  }
}

app.whenReady().then(() => {
  const ses = session.fromPartition(`audit-${process.pid}`);
  ses.webRequest.onBeforeRedirect((details) => noteRedirect(details.url, details.redirectURL));
  const token = crypto.randomBytes(16).toString('hex');
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.headers['x-audit-token'] !== token) {
      res.writeHead(403).end();
      return;
    }
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      let request;
      try {
        request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        res.writeHead(400).end();
        return;
      }
      const reply = (frame) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(frame));
      if (request.op === 'quit') {
        reply({ ok: true });
        setImmediate(() => app.quit());
      } else if (request.op === 'stream') {
        void stream(ses, request, res);
      } else if (request.op === 'play') {
        void play(ses, request).then(reply);
      } else if (request.op === 'fetch') {
        void fetchOnce(ses, request).then(reply);
      } else {
        reply({ ok: false, error: `unknown op ${request.op}` });
      }
    });
  });
  // Loopback only, and the token travels on the ready line alone.
  server.listen(0, '127.0.0.1', () => {
    send({ id: 'ready', ok: true, electron: process.versions.electron, port: server.address().port, token });
  });
  // The runner is the only reason to exist: when it goes, so does the worker.
  const parent = Number(process.env.CS3_AUDIT_PARENT_PID);
  if (parent) {
    setInterval(() => {
      try {
        process.kill(parent, 0);
      } catch {
        app.quit();
      }
    }, 2000).unref();
  }
});
