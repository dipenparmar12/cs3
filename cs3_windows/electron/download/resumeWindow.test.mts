/**
 * The boundary-window probe, against real sockets.
 *
 *   bun run test:resume-window
 *   node --experimental-strip-types electron/download/resumeWindow.test.mts
 *
 * Not a mock, deliberately. Everything worth catching here lives in the seam
 * between an HTTP client and a server that does not behave: a host answering a
 * ranged request with `200` and the whole file, a redirect chain, a body longer
 * than the range promised. A stub written from our own assumptions would assert
 * those assumptions back at us.
 *
 * The `200`-to-a-ranged-request case is the one that matters most, and it is
 * checked twice over — once for the answer it returns, and once for the thing
 * this repository has been bitten by twice: an abandoned probe that keeps
 * pulling a multi-gigabyte body long after the function returned. The endless
 * server below never finishes its response, so a probe that drains rather than
 * destroys hangs the test instead of passing it.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fetchRemoteWindow, readLocalWindow } from './resumeWindow.ts';

const tests: Array<[string, () => Promise<void>]> = [];
const test = (name: string, fn: () => Promise<void>) => tests.push([name, fn]);

const BODY = crypto.randomBytes(200_000);

/** Serves `BODY`, honouring Range the way a well-behaved CDN does. */
function rangeServer(): Promise<{ url: string; close: () => void }> {
  const server = http.createServer((req, res) => {
    const match = /bytes=(\d+)-(\d+)?/.exec(String(req.headers.range ?? ''));
    if (!match) {
      res.writeHead(200, { 'Content-Length': String(BODY.length) });
      res.end(BODY);
      return;
    }
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : BODY.length - 1;
    if (start >= BODY.length) {
      res.writeHead(416, { 'Content-Range': `bytes */${BODY.length}` });
      res.end();
      return;
    }
    const slice = BODY.subarray(start, end + 1);
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${BODY.length}`,
      'Content-Length': String(slice.length),
      'Accept-Ranges': 'bytes',
    });
    res.end(slice);
  });
  return listen(server);
}

function listen(server: http.Server): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}/file.mkv`,
        close: () => server.close(),
      });
    });
  });
}

// --- the well-behaved case --------------------------------------------------

test('a 206 gives the bytes, the total, and proof of range support', async () => {
  const server = await rangeServer();
  try {
    const window = await fetchRemoteWindow(server.url, {}, 100, 199);
    assert.equal(window.satisfiedRange, true);
    assert.equal(window.totalBytes, BODY.length);
    assert.ok(window.bytes);
    assert.ok(window.bytes!.equals(BODY.subarray(100, 200)));
  } finally {
    server.close();
  }
});

test('the total is read from Content-Range, not from the slice length', async () => {
  // The trap: `Content-Length` on a 206 is the *window*, not the file. Reading
  // it as the total would make every resume look like a size mismatch.
  const server = await rangeServer();
  try {
    const window = await fetchRemoteWindow(server.url, {}, 0, 9);
    assert.equal(window.totalBytes, BODY.length);
    assert.notEqual(window.totalBytes, 10);
  } finally {
    server.close();
  }
});

// --- the host that ignores Range -------------------------------------------

test('a 200 to a ranged request is reported as unresumable, with the length', async () => {
  /**
   * The measured shape of `video-downloads.googleusercontent.com`: a ranged
   * request answered with the whole file from byte zero. The bytes must not be
   * returned — they are the head of the file, not the window asked for, and
   * comparing them against the tail of a partial would fail confusingly rather
   * than saying the server cannot resume.
   */
  const server = await listen(
    http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Length': String(BODY.length) });
      res.end(BODY);
    })
  );
  try {
    const window = await fetchRemoteWindow(server.url, {}, 100, 199);
    assert.equal(window.satisfiedRange, false);
    assert.equal(window.status, 200);
    assert.equal(window.totalBytes, BODY.length);
    assert.equal(window.bytes, undefined);
  } finally {
    server.close();
  }
});

test('an endless 200 body is destroyed rather than drained', async () => {
  /**
   * The bug this repository has been bitten by twice: `res.resume()` discards
   * the data but leaves the transfer running, so an abandoned probe keeps
   * pulling a multi-gigabyte body long after the function returned.
   *
   * The first version of this test asserted that the probe *resolved* quickly
   * and that few chunks had been written. Both are true with the bug present —
   * the promise settles either way — so it passed against the broken code and
   * measured nothing. What distinguishes the two is whether the **connection**
   * ends: destroying it fires `close` on the server's response, and draining it
   * does not. Verified by mutation: restore `response.resume()` in place of the
   * two `destroy()` calls and this fails.
   */
  let closed = false;
  const server = await listen(
    http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Length': '9999999999' });
      const pump = setInterval(() => {
        if (res.writableEnded || res.destroyed) {
          clearInterval(pump);
          return;
        }
        res.write(Buffer.alloc(16 * 1024));
      }, 5);
      res.on('close', () => {
        closed = true;
        clearInterval(pump);
      });
    })
  );
  try {
    const window = await fetchRemoteWindow(server.url, {}, 100, 199);
    assert.equal(window.satisfiedRange, false);

    // Give the socket a moment to actually tear down, then insist it did.
    const deadline = Date.now() + 3_000;
    while (!closed && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.equal(closed, true, 'the connection was left open and still transferring');
  } finally {
    server.close();
  }
});

// --- misbehaviour -----------------------------------------------------------

test('a body longer than the range promised is truncated to the window', async () => {
  const server = await listen(
    http.createServer((_req, res) => {
      res.writeHead(206, {
        'Content-Range': `bytes 100-199/${BODY.length}`,
        'Accept-Ranges': 'bytes',
      });
      res.end(BODY); // Far more than the 100 bytes it just claimed.
    })
  );
  try {
    const window = await fetchRemoteWindow(server.url, {}, 100, 199);
    assert.equal(window.satisfiedRange, true);
    assert.equal(window.bytes?.length, 100);
  } finally {
    server.close();
  }
});

test('a redirect is followed and the range travels with it', async () => {
  const target = await rangeServer();
  const front = await listen(
    http.createServer((_req, res) => {
      res.writeHead(302, { Location: target.url });
      res.end();
    })
  );
  try {
    const window = await fetchRemoteWindow(front.url, {}, 100, 199);
    assert.equal(window.satisfiedRange, true);
    assert.ok(window.bytes!.equals(BODY.subarray(100, 200)));
  } finally {
    front.close();
    target.close();
  }
});

test('a 416 is not a window, and carries the real length', async () => {
  const server = await rangeServer();
  try {
    const window = await fetchRemoteWindow(server.url, {}, BODY.length + 10, BODY.length + 20);
    assert.equal(window.satisfiedRange, false);
    assert.equal(window.status, 416);
    assert.equal(window.totalBytes, BODY.length);
  } finally {
    server.close();
  }
});

test('an unreachable host answers rather than throwing', async () => {
  // A failed probe is a reason to restart, not an exception for the caller to
  // handle on a separate path.
  const window = await fetchRemoteWindow('http://127.0.0.1:1/file.mkv', {}, 0, 9);
  assert.equal(window.satisfiedRange, false);
  assert.ok(window.error);
});

// --- the local half ---------------------------------------------------------

test('the local window is read at the right offset', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cs3-resume-')), 'part');
  fs.writeFileSync(file, BODY);
  try {
    const local = readLocalWindow(file, 100, 199);
    assert.ok(local);
    assert.ok(local!.equals(BODY.subarray(100, 200)));
  } finally {
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }
});

test('a short read is null rather than a half-filled buffer', async () => {
  /**
   * A buffer padded with zeroes would compare unequal and read as a corrupt
   * download, when what actually happened is the part file shrank underneath
   * us. Null routes it to "could not be checked", which is the truth.
   */
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cs3-resume-')), 'part');
  fs.writeFileSync(file, BODY.subarray(0, 150));
  try {
    assert.equal(readLocalWindow(file, 100, 199), null);
    assert.equal(readLocalWindow(path.join(path.dirname(file), 'missing'), 0, 9), null);
  } finally {
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }
});

// --- runner ----------------------------------------------------------------

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
console.log(failed === 0 ? `\n${tests.length} passed` : `\n${failed} of ${tests.length} FAILED`);
process.exit(failed === 0 ? 0 : 1);
