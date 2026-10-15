import assert from 'node:assert/strict';
import { test } from 'node:test';
import { byteStringHeaders, isElectronHeaderByteStringError, toByteString } from './headerBytes.ts';

test('a value outside Latin-1 becomes its UTF-8 bytes, losslessly', () => {
  const value = 'attachment; filename="【Movie】.mkv"';
  const safe = toByteString(value);
  assert.ok([...safe].every((c) => c.charCodeAt(0) <= 0xff));
  assert.equal(Buffer.from(safe, 'latin1').toString('utf8'), value);
  // What the crash needed: Headers accepts it.
  assert.doesNotThrow(() => new Headers().set('content-disposition', safe));
  assert.throws(() => new Headers().set('content-disposition', value));
});

test('ordinary and Latin-1 headers are untouched, and say so', () => {
  assert.equal(toByteString('video/mp4'), 'video/mp4');
  assert.equal(toByteString('café'), 'café');
  assert.equal(byteStringHeaders({ 'content-type': ['video/mp4'], server: 'nginx' }), null);
  assert.equal(byteStringHeaders(undefined), null);
});

test('only the offending values change; multi-value headers keep their order', () => {
  const out = byteStringHeaders({ 'content-type': ['text/plain'], 'x-name': ['a', '【b】'] });
  assert.ok(out);
  assert.deepEqual(out['content-type'], ['text/plain']);
  assert.equal(out['x-name'][0], 'a');
  assert.equal(Buffer.from(out['x-name'][1], 'latin1').toString('utf8'), '【b】');
});

test('only Electron’s own ByteString failure is recognised', () => {
  const electron = new TypeError('Cannot convert argument to a ByteString because the character at index 22 has a value of 12304 which is greater than 255.');
  electron.stack = `${electron.message}\n    at Headers.set (node:internal/deps/undici/undici:11434:35)\n    at ClientRequest.<anonymous> (node:electron/js2c/browser_init:2:55558)`;
  assert.equal(isElectronHeaderByteStringError(electron), true);

  const ours = new TypeError(electron.message);
  ours.stack = `${ours.message}\n    at Headers.set (x)\n    at buildRequest (D:/projects/cs3/desktop/electron/mediaProxy.ts:10:1)`;
  assert.equal(isElectronHeaderByteStringError(ours), false);
  assert.equal(isElectronHeaderByteStringError(new Error('boom')), false);
});
