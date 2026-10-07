/**
 * `clearance.fetch`: a request the JVM could not get past a bot wall, re-sent
 * by the browser that earned the clearance.
 *
 * `CloudflareKiller` reaches for this only after a fresh clearance, replayed
 * from OkHttp with the right agent, has been challenged again — the signature
 * of a wall that scores the TLS handshake as well as the cookie. See
 * `WebViewHost.fetchInSession` for why the browser's own stack passes where the
 * JVM's does not.
 *
 * **Only for a host that already holds a clearance.** This is plugin code
 * asking the app to make a request from a session that ignores certificate
 * errors; "fetch any URL through the browser" would be a far larger capability
 * than "finish the request a solved challenge was for". So the relay refuses
 * unless the jar holds a live clearance for that host — which can only be
 * there because a challenge on it was really passed.
 *
 * Free of Electron imports so it is tested with stubs.
 */
import type { ClearanceService } from './clearance.ts';

/** The answer document; the bridge's `HostRelayAnswer` binds to it by name. */
export interface RelayAnswer {
  ok: boolean;
  error?: string;
  status?: number;
  statusText?: string;
  url?: string;
  headers?: Record<string, string[]>;
  bodyBase64?: string;
}

export interface RelayHost {
  userAgent(): string;
  fetchInSession(
    url: string,
    init: { method?: string; headers?: Record<string, string>; body?: Uint8Array; signal?: AbortSignal }
  ): Promise<Response>;
}

/**
 * Bigger than any page a scraper parses, smaller than anything that should
 * cross a stdio pipe base64-encoded. A media file is never relayed — it is
 * fetched afterwards through `MediaProxy`, like every other stream.
 */
export const MAX_RELAY_BYTES = 16 * 1024 * 1024;

/**
 * Headers the relay sets itself. The agent and the cookies have to be the
 * browser's or the request is not the browser's; the rest describe a
 * connection that is not the one being made.
 */
const OWNED_REQUEST_HEADERS = new Set([
  'user-agent',
  'cookie',
  'host',
  'connection',
  'content-length',
  'accept-encoding',
  'transfer-encoding',
]);

/**
 * Chromium decodes the body before handing it over, so these would describe
 * bytes the JVM never receives — OkHttp would try to gunzip plain text.
 */
const STALE_RESPONSE_HEADERS = new Set(['content-encoding', 'content-length', 'transfer-encoding']);

export async function relayInSession(
  params: Record<string, unknown>,
  deps: { clearance: Pick<ClearanceService, 'holds'>; host: RelayHost }
): Promise<RelayAnswer> {
  const url = typeof params.url === 'string' ? params.url : '';
  if (!(await deps.clearance.holds(url))) {
    return { ok: false, error: `No clearance is held for ${url}, so the browser will not send it.` };
  }

  const headers: Record<string, string> = {};
  const given = (params.headers ?? {}) as Record<string, unknown>;
  for (const [name, value] of Object.entries(given)) {
    if (typeof value === 'string' && !OWNED_REQUEST_HEADERS.has(name.toLowerCase())) headers[name] = value;
  }
  headers['User-Agent'] = deps.host.userAgent();

  const timeoutMs = typeof params.timeoutMs === 'number' ? params.timeoutMs : 30_000;
  const body =
    typeof params.bodyBase64 === 'string' && params.bodyBase64
      ? new Uint8Array(Buffer.from(params.bodyBase64, 'base64'))
      : undefined;

  let response: Response;
  try {
    response = await deps.host.fetchInSession(url, {
      method: typeof params.method === 'string' ? params.method : 'GET',
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > MAX_RELAY_BYTES) {
    await response.body?.cancel();
    return { ok: false, error: `The reply is ${declared} bytes; the relay carries pages, not files.` };
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_RELAY_BYTES) {
    return { ok: false, error: `The reply is ${bytes.length} bytes; the relay carries pages, not files.` };
  }

  const out: Record<string, string[]> = {};
  response.headers.forEach((value, name) => {
    if (STALE_RESPONSE_HEADERS.has(name) || name === 'set-cookie') return;
    (out[name] ??= []).push(value);
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) out['set-cookie'] = cookies;

  return {
    ok: true,
    status: response.status,
    statusText: response.statusText,
    url: response.url || url,
    headers: out,
    bodyBase64: bytes.toString('base64'),
  };
}
