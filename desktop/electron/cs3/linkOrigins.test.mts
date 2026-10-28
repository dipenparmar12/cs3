import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LinkOrigins, pickRefreshedLink, type LinkOrigin } from './linkOrigins.ts';

const origin: LinkOrigin = { handle: 'cs3ext://P/abc', source: 'Drive', name: 'Drive 1080p', quality: 1080, part: 0 };
const link = (over: Partial<{ source: string; name: string; url: string; quality: number }> = {}) => ({
  source: 'Drive',
  name: 'Drive 1080p',
  url: 'https://cdn/new?sig=2',
  quality: 1080,
  headers: { Referer: 'https://p/' },
  ...over,
});

test('the same link is found again with its fresh address and headers', () => {
  assert.deepEqual(pickRefreshedLink(origin, [link({ name: 'Drive 720p', quality: 720 }), link()]), {
    url: 'https://cdn/new?sig=2',
    headers: { Referer: 'https://p/' },
  });
});

test('a different release is never swapped in', () => {
  assert.equal(pickRefreshedLink(origin, []), null);
  assert.equal(pickRefreshedLink(origin, [link({ quality: 720 })]), null);
  assert.equal(pickRefreshedLink(origin, [link({ name: 'Drive 1080p Hindi' })]), null);
  assert.equal(pickRefreshedLink(origin, [link({ source: 'Other' })]), null);
  assert.equal(pickRefreshedLink(origin, [link({ url: '' })]), null);
});

test('a playlist part is refreshed as the same part', () => {
  const parts = { ...link({ url: '' }), playlist: [{ url: 'p1' }, { url: 'p2' }] };
  assert.equal(pickRefreshedLink({ ...origin, part: 2 }, [parts])?.url, 'p2');
  assert.equal(pickRefreshedLink({ ...origin, part: 3 }, [parts]), null);
});

test('origins are kept by URL, newest last, and bounded', () => {
  const origins = new LinkOrigins(2);
  origins.remember('a', origin);
  origins.remember('b', origin);
  origins.remember('a', { ...origin, quality: 720 });
  origins.remember('c', origin);
  assert.equal(origins.get('b'), undefined);
  assert.equal(origins.get('a')?.quality, 720);
  assert.ok(origins.get('c'));
  origins.remember('', origin);
  origins.remember('d', { ...origin, handle: '' });
  assert.equal(origins.get(''), undefined);
  assert.equal(origins.get('d'), undefined);
});
