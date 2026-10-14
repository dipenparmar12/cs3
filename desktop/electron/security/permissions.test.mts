import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appMayUse, isAppOrigin } from './permissions.ts';

const DEV = 'http://localhost:5173/';

test('the app gets exactly what it uses', () => {
  assert.equal(appMayUse('clipboard-sanitized-write', 'file:///C:/app/dist/index.html'), true);
  assert.equal(appMayUse('fullscreen', 'http://localhost:5173/', DEV), true);
  assert.equal(appMayUse('mediaKeySystem', 'file:///C:/app/dist/index.html'), true);
});

test('nothing else, even for the app', () => {
  for (const permission of ['media', 'geolocation', 'notifications', 'display-capture', 'clipboard-read', 'openExternal']) {
    assert.equal(appMayUse(permission, 'file:///C:/app/dist/index.html'), false, permission);
  }
});

test('third-party pages get nothing — provider and challenge pages included', () => {
  assert.equal(appMayUse('fullscreen', 'https://provider.example/watch'), false);
  assert.equal(appMayUse('clipboard-sanitized-write', 'https://challenges.cloudflare.com/'), false);
});

test('the dev server is matched by origin, not by prefix', () => {
  assert.equal(isAppOrigin('http://localhost:5173.evil.example/', DEV), false);
  assert.equal(isAppOrigin('http://localhost:5174/', DEV), false);
  assert.equal(isAppOrigin('http://localhost:5173/x', undefined), false);
  assert.equal(isAppOrigin('not a url', DEV), false);
});
