import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { FastChunkDownloader, isFirstPartyMirror, usableMirrors } from './fastDownloader.ts';

test('publishers are first-party; a proxy mirror is not', () => {
  assert.equal(isFirstPartyMirror('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'), true);
  assert.equal(isFirstPartyMirror('https://objects.githubusercontent.com/x'), true);
  assert.equal(isFirstPartyMirror('https://www.gyan.dev/ffmpeg/builds/x.zip'), true);
  assert.equal(isFirstPartyMirror('https://ghproxy.net/https://github.com/a/b'), false);
  assert.equal(isFirstPartyMirror('http://github.com/a'), false); // no TLS, no trust
  assert.equal(isFirstPartyMirror('https://github.com.evil.example/a'), false);
});

test('an unpinned third-party mirror is dropped; a pinned one is kept', () => {
  const kept = usableMirrors([
    'https://github.com/a/b.zip',
    'https://ghproxy.net/https://github.com/a/b.zip',
    { url: 'https://ghproxy.net/https://github.com/a/c.zip', sha256: 'AB'.repeat(32) },
  ]);
  assert.deepEqual(kept.map((m) => m.url), ['https://github.com/a/b.zip', 'https://ghproxy.net/https://github.com/a/c.zip']);
  assert.equal(kept[1].sha256, 'ab'.repeat(32));
});

test('bytes that do not match the pinned digest are deleted, never kept (real HTTP)', async () => {
  const payload = Buffer.from('not the binary you were promised');
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Length': payload.length });
    res.end(payload);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs3-dl-'));
  const target = path.join(dir, 'tool.exe');
  try {
    // A loopback "mirror" stands in for a third-party one; it is pinned, so it is tried.
    await assert.rejects(
      FastChunkDownloader.download({
        mirrors: [{ url: `http://127.0.0.1:${port}/tool.exe`, sha256: '0'.repeat(64) }],
        targetPath: target,
      }),
      /Integrity check failed/
    );
    assert.equal(fs.existsSync(target), false);

    const good = createHash('sha256').update(payload).digest('hex');
    assert.equal(
      await FastChunkDownloader.download({ mirrors: [{ url: `http://127.0.0.1:${port}/tool.exe`, sha256: good }], targetPath: target }),
      true
    );
    assert.deepEqual(fs.readFileSync(target), payload);
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('with nothing verifiable, nothing is downloaded', async () => {
  await assert.rejects(
    FastChunkDownloader.download({ mirrors: ['https://ghproxy.net/https://github.com/a/b.zip'], targetPath: path.join(os.tmpdir(), 'never') }),
    /can be verified/
  );
});
