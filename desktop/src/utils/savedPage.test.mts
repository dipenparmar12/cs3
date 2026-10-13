import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detailFromSnapshot, mergeDetail, savedCopyAge } from './savedPage.ts';
import type { SavedPageDetail } from './savedPage.ts';
import type { PageSnapshot } from '../../electron/cs3/pageSnapshot.ts';
import { TvType } from '../types/api.ts';

const NOW = 1_700_000_000_000;

function snapshot(patch: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    url: 'cs3ext://Provider/dune',
    key: 'dune:2021',
    title: 'Dune',
    year: 2021,
    type: TvType.Movie,
    posterUrl: 'https://example.test/poster.jpg',
    plot: 'A noble family becomes embroiled in a war.',
    tags: ['Sci-Fi'],
    rating: 82,
    actors: ['Rebecca Ferguson'],
    imdbId: 'tt1160419',
    routes: ['cs3ext://Provider/dune', 'cs3ext://Other/dune'],
    origin: { provider: 'Provider', searchQuery: 'dune' },
    capturedAt: NOW,
    verifiedAt: NOW,
    lastUsedAt: NOW,
    ...patch,
  };
}

function live(patch: Partial<SavedPageDetail> = {}): SavedPageDetail {
  return { name: 'Dune', url: 'cs3ext://Provider/dune', type: TvType.Movie, ...patch };
}

test('detailFromSnapshot draws a complete page with no provider involved', () => {
  const page = detailFromSnapshot(snapshot(), 'fallback');
  assert.equal(page.name, 'Dune');
  assert.equal(page.posterUrl, 'https://example.test/poster.jpg');
  assert.equal(page.plot, 'A noble family becomes embroiled in a war.');
  assert.equal(page.year, 2021);
  assert.equal(page.imdbId, 'tt1160419');
  // The first remembered route, which is the address that last worked.
  assert.equal(page.url, 'cs3ext://Provider/dune');
});

test('detailFromSnapshot falls back to the row address when no route was kept', () => {
  const page = detailFromSnapshot(snapshot({ routes: [], url: '' }), 'cs3ext://Row/x');
  assert.equal(page.url, 'cs3ext://Row/x');
});

/**
 * The rule this whole feature turns on. A provider that answers with a title
 * and nothing else has told us nothing about the poster; treating its silence
 * as "there is no poster" is what makes a complete page degrade a little every
 * time it is opened.
 */
test('mergeDetail never blanks a field the saved copy has', () => {
  const merged = mergeDetail(live({ plot: '', tags: [], posterUrl: undefined }), snapshot());

  assert.equal(merged.posterUrl, 'https://example.test/poster.jpg');
  assert.equal(merged.plot, 'A noble family becomes embroiled in a war.');
  assert.deepEqual(merged.tags, ['Sci-Fi']);
  assert.deepEqual(merged.actors, ['Rebecca Ferguson']);
  assert.equal(merged.year, 2021);
  assert.equal(merged.rating, 82);
  assert.equal(merged.imdbId, 'tt1160419');
});

test('mergeDetail lets a real answer win', () => {
  const merged = mergeDetail(
    live({ plot: 'Corrected plot.', posterUrl: 'https://example.test/new.jpg', rating: 90 }),
    snapshot()
  );
  assert.equal(merged.plot, 'Corrected plot.');
  assert.equal(merged.posterUrl, 'https://example.test/new.jpg');
  assert.equal(merged.rating, 90);
});

test('mergeDetail keeps the live URL, which is the route that actually answered', () => {
  const merged = mergeDetail(live({ url: 'cs3ext://Other/dune' }), snapshot());
  assert.equal(merged.url, 'cs3ext://Other/dune');
});

test('mergeDetail takes an episode listing whole or not at all', () => {
  const stored = snapshot({
    episodes: [
      { name: 'One', url: 'e1', season: 1, episode: 1 },
      { name: 'Two', url: 'e2', season: 1, episode: 2 },
    ],
  });

  assert.equal(mergeDetail(live({ episodes: [] }), stored).episodes?.length, 2);
  assert.deepEqual(
    mergeDetail(live({ episodes: [{ name: 'New', url: 'e9', season: 1, episode: 1 }] }), stored)
      .episodes?.map((e) => e.url),
    ['e9']
  );
});

test('mergeDetail with no saved copy is the identity', () => {
  const page = live({ plot: 'only' });
  assert.deepEqual(mergeDetail(page, null), page);
});

test('savedCopyAge tells recent from ancient, which is what decides the next move', () => {
  assert.equal(savedCopyAge(null), 'Saved earlier');
  assert.equal(savedCopyAge(snapshot({ verifiedAt: NOW }), NOW), 'Saved today');
  assert.equal(savedCopyAge(snapshot({ verifiedAt: NOW - 86_400_000 }), NOW), 'Saved yesterday');
  assert.equal(savedCopyAge(snapshot({ verifiedAt: NOW - 5 * 86_400_000 }), NOW), 'Saved 5 days ago');
  assert.equal(
    savedCopyAge(snapshot({ verifiedAt: NOW - 40 * 86_400_000 }), NOW),
    'Saved last month'
  );
  assert.equal(
    savedCopyAge(snapshot({ verifiedAt: NOW - 240 * 86_400_000 }), NOW),
    'Saved 8 months ago'
  );
});
