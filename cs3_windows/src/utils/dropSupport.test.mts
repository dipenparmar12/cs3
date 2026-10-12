import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyDroppedPaths, droppedLinkKind, isSupportedDrag } from './dropSupport.ts';

const file = (type: string) => ({ kind: 'file', type });
const text = (type: string) => ({ kind: 'string', type });

test('a video or a torrent from outside lights the drop zone', () => {
  assert.equal(isSupportedDrag(['Files'], [file('video/x-matroska')], false), true);
  assert.equal(isSupportedDrag(['Files'], [file('audio/mpeg')], false), true);
  assert.equal(isSupportedDrag(['Files'], [file('application/x-bittorrent')], false), true);
});

test('a file the system has no type for counts — that is how a .torrent often arrives', () => {
  assert.equal(isSupportedDrag(['Files'], [file('')], false), true);
});

test('images, documents and programs stay quiet', () => {
  assert.equal(isSupportedDrag(['Files'], [file('image/png')], false), false);
  assert.equal(isSupportedDrag(['Files'], [file('application/pdf')], false), false);
  assert.equal(isSupportedDrag(['Files'], [file('application/zip')], false), false);
  assert.equal(isSupportedDrag(['Files'], [file('application/x-msdownload')], false), false);
});

test('an image dragged off a web page is not a link drop', () => {
  // Browsers attach the image's address as text/uri-list beside the file.
  assert.equal(
    isSupportedDrag(['Files', 'text/uri-list', 'text/html'], [file('image/jpeg'), text('text/uri-list')], false),
    false,
  );
});

test('one supported file among others is enough', () => {
  assert.equal(isSupportedDrag(['Files'], [file('image/png'), file('video/mp4')], false), true);
});

test('a link counts; plain selected text does not', () => {
  assert.equal(isSupportedDrag(['text/uri-list', 'text/plain'], [text('text/uri-list'), text('text/plain')], false), true);
  assert.equal(isSupportedDrag(['text/plain', 'text/html'], [text('text/plain'), text('text/html')], false), false);
});

test("the app's own drags never count", () => {
  assert.equal(isSupportedDrag(['Files'], [file('video/mp4')], true), false);
  assert.equal(isSupportedDrag(['application/x-ott-platform', 'text/uri-list'], [], false), false);
});

test('files announced without item detail are given the benefit of the doubt', () => {
  assert.equal(isSupportedDrag(['Files'], [], false), true);
});

test('the drop sorts by real file name', () => {
  const sorted = classifyDroppedPaths([
    'C:\\Users\\me\\Downloads\\Dune.2021.torrent',
    '/home/me/Videos/Dune.MKV',
    '/home/me/notes.txt',
    '/home/me/no-extension',
  ]);
  assert.deepEqual(sorted.torrents, ['C:\\Users\\me\\Downloads\\Dune.2021.torrent']);
  assert.deepEqual(sorted.media, ['/home/me/Videos/Dune.MKV']);
  assert.deepEqual(sorted.other, ['/home/me/notes.txt', '/home/me/no-extension']);
});

test('dropped links: magnets open, pages are searched, anything else is ignored', () => {
  assert.equal(droppedLinkKind('magnet:?xt=urn:btih:abc'), 'magnet');
  assert.equal(droppedLinkKind('  https://example.org/watch?v=1 '), 'page');
  assert.equal(droppedLinkKind('just some words'), null);
  assert.equal(droppedLinkKind('javascript:alert(1)'), null);
  assert.equal(droppedLinkKind(undefined), null);
});
