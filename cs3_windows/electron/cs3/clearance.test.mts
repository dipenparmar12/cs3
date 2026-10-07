import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CLEARANCE_COOKIE,
  ClearanceService,
  FAILURE_COOLDOWN_MS,
  browserUserAgent,
  type ClearanceDeps,
  type JarCookie,
} from './clearance.ts';
import { relayInSession } from './clearanceRelay.ts';

const URL_A = 'https://protected.example/page';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

/** A jar keyed by hostname, and a browser whose solve writes into it. */
function harness(options: { solveWorks?: boolean; gate?: Promise<void> } = {}) {
  let now = 1_000_000;
  const jar = new Map<string, JarCookie[]>();
  let solves = 0;
  const host = (url: string) => new URL(url).hostname;
  const deps: ClearanceDeps = {
    readCookies: async (url) => jar.get(host(url)) ?? [],
    removeCookie: async (url, name) => {
      jar.set(host(url), (jar.get(host(url)) ?? []).filter((c) => c.name !== name));
    },
    solve: async (url) => {
      solves++;
      await options.gate;
      if (options.solveWorks === false) return { ok: false, error: 'challenge timed out' };
      jar.set(host(url), [
        { name: CLEARANCE_COOKIE, value: `clear-${solves}`, expirationDate: now / 1000 + 3600 },
        { name: '__cf_bm', value: 'bm' },
      ]);
      return { ok: true };
    },
    userAgent: () => UA,
    now: () => now,
  };
  return {
    service: new ClearanceService(deps),
    jar,
    solves: () => solves,
    advance: (ms: number) => (now += ms),
    nowSeconds: () => now / 1000,
  };
}

test('a clearance already in the jar is answered without opening a browser', async () => {
  const h = harness();
  h.jar.set('protected.example', [{ name: CLEARANCE_COOKIE, value: 'held', expirationDate: h.nowSeconds() + 600 }]);
  const answer = await h.service.get(URL_A);
  assert.ok(answer.ok);
  assert.equal(answer.ok && answer.source, 'jar');
  assert.equal(answer.ok && answer.cookies[CLEARANCE_COOKIE], 'held');
  assert.equal(h.solves(), 0);
});

test('concurrent callers share one browser solve', async () => {
  let release!: () => void;
  const h = harness({ gate: new Promise<void>((resolve) => (release = resolve)) });
  const answers = Promise.all([h.service.get(URL_A), h.service.get(URL_A), h.service.get(URL_A)]);
  release();
  const settled = await answers;
  assert.equal(h.solves(), 1);
  assert.ok(settled.every((answer) => answer.ok && answer.cookies[CLEARANCE_COOKIE] === 'clear-1'));
});

test('a host the browser cannot clear is left alone for the cooldown, then retried', async () => {
  const h = harness({ solveWorks: false });
  const first = await h.service.get(URL_A);
  assert.equal(first.ok, false);
  const second = await h.service.get(URL_A);
  assert.equal(second.ok, false);
  assert.ok(!second.ok && second.retryAfterMs! > 0);
  assert.equal(h.solves(), 1, 'the second request must not open another window');
  h.advance(FAILURE_COOLDOWN_MS + 1);
  await h.service.get(URL_A);
  assert.equal(h.solves(), 2);
});

test('a clearance about to expire is not handed out', async () => {
  const h = harness();
  h.jar.set('protected.example', [{ name: CLEARANCE_COOKIE, value: 'dying', expirationDate: h.nowSeconds() + 10 }]);
  const answer = await h.service.get(URL_A);
  assert.ok(answer.ok && answer.source === 'solved');
  assert.equal(h.solves(), 1);
});

test('invalidating a refused clearance makes the next get solve again', async () => {
  const h = harness();
  h.jar.set('protected.example', [{ name: CLEARANCE_COOKIE, value: 'stale', expirationDate: h.nowSeconds() + 600 }]);
  await h.service.invalidate(URL_A);
  const answer = await h.service.get(URL_A);
  assert.ok(answer.ok && answer.cookies[CLEARANCE_COOKIE] === 'clear-1');
});

test('peeking never opens a browser', async () => {
  const h = harness();
  const answer = await h.service.get(URL_A, { solve: false });
  assert.equal(answer.ok, false);
  assert.equal(h.solves(), 0);
});

test('a solve that reports success without issuing a clearance is a failure', async () => {
  const h = harness();
  // The page loaded, but no clearance cookie was ever written.
  const service = new ClearanceService({
    readCookies: async () => [],
    removeCookie: async () => {},
    solve: async () => ({ ok: true }),
    userAgent: () => UA,
  });
  const answer = await service.get(URL_A);
  assert.equal(answer.ok, false);
  assert.equal(h.solves(), 0);
});

test('the browser agent loses the tokens real Chrome never sends', () => {
  const raw =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'cloudstream-3-desktop/1.0.0 Chrome/134.0.6998.205 Electron/35.1.0 Safari/537.36';
  // Electron puts the app token before Chrome on some builds and after it on
  // others; both must come out clean.
  const after =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/134.0.6998.205 cloudstream-3-desktop/1.0.0 Electron/35.1.0 Safari/537.36';
  assert.equal(browserUserAgent(after), UA);
  assert.equal(browserUserAgent(raw), UA);
  assert.equal(browserUserAgent('curl/8.0'), 'curl/8.0', 'unrecognised agents are left alone');
});

test('the relay refuses a host that holds no clearance', async () => {
  let fetched = false;
  const answer = await relayInSession(
    { url: 'https://anything.example/' },
    {
      clearance: { holds: async () => false },
      host: {
        userAgent: () => UA,
        fetchInSession: async () => {
          fetched = true;
          return new Response('');
        },
      },
    }
  );
  assert.equal(answer.ok, false);
  assert.equal(fetched, false, 'the request must never leave');
});

test('the relay sends the browser agent, not the caller cookie, and reports decoded bytes', async () => {
  let sent: Record<string, string> | undefined;
  const answer = await relayInSession(
    { url: URL_A, headers: { Cookie: 'cf_clearance=okhttp', 'User-Agent': 'okhttp/4', Referer: 'https://ref/' } },
    {
      clearance: { holds: async () => true },
      host: {
        userAgent: () => UA,
        fetchInSession: async (_url, init) => {
          sent = init.headers;
          return new Response('<html>ok</html>', {
            status: 200,
            headers: { 'content-type': 'text/html', 'content-encoding': 'br' },
          });
        },
      },
    }
  );
  assert.equal(sent?.['User-Agent'], UA);
  assert.equal(sent?.Cookie, undefined, 'the jar supplies the cookies');
  assert.equal(sent?.Referer, 'https://ref/');
  assert.ok(answer.ok);
  assert.equal(Buffer.from(answer.bodyBase64!, 'base64').toString(), '<html>ok</html>');
  assert.equal(answer.headers?.['content-encoding'], undefined, 'the body arrives decoded');
});
