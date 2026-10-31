import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyNonMedia, looksLikeHtml } from './nonMediaResponse.ts';

test('media is not a web page, whatever its first bytes', () => {
  assert.equal(classifyNonMedia('video/mp4', '\u0000\u0000\u0000\u0018ftypisom'), null);
  assert.equal(classifyNonMedia('application/vnd.apple.mpegurl', '#EXTM3U\n#EXT-X-VERSION:3'), null);
  assert.equal(classifyNonMedia(null, '#EXTM3U'), null);
});

test('an update notice is recognised, even when it also offers to log in', () => {
  const page = '<!doctype html><html><body><h1>Please update the app</h1><a href="/login">Log in</a></body></html>';
  assert.equal(classifyNonMedia('text/html; charset=utf-8', page), 'update-required');
});

test('a sign-in page is recognised by its words or a password field', () => {
  assert.equal(classifyNonMedia('text/html', '<html><body><h2>Sign in to continue</h2></body></html>'), 'login');
  assert.equal(classifyNonMedia(null, '<html><form><input type="password" name="p"></form></html>'), 'login');
});

test('any other page is a web page, not a video; script text is ignored', () => {
  assert.equal(classifyNonMedia('text/html', '<html><script>var login=1</script><h1>Movies online</h1></html>'), 'html');
  assert.equal(looksLikeHtml('application/octet-stream', '  <!DOCTYPE html><html>'), true, 'sniffed when mislabelled');
});
