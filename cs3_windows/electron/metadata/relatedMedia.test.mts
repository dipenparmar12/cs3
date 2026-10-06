import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyRelatedMediaCategory } from './relatedMedia/classifier.ts';
import { buildRelatedMediaQueries, normalizeMediaTitle } from './relatedMedia/queryBuilder.ts';
import {
  deduplicateRelatedMedia,
  rankRelatedMedia,
} from './relatedMedia/ranking.ts';
import { RelatedMediaService } from './relatedMedia/relatedMediaService.ts';
import type {
  RelatedMediaProvider,
  RelatedMediaResult,
  RelatedMediaSearchRequest,
} from '../../src/types/relatedMedia.ts';

test('classifyRelatedMediaCategory classifies accurately', () => {
  assert.equal(
    classifyRelatedMediaCategory('Inception Ending Explained and Breakdown'),
    'explanation'
  );
  assert.equal(
    classifyRelatedMediaCategory('Interstellar Movie Explained: What really happened'),
    'explanation'
  );
  assert.equal(
    classifyRelatedMediaCategory('Dune Part Two Honest Review'),
    'review'
  );
  assert.equal(
    classifyRelatedMediaCategory('The Batman Film Review & Rating'),
    'review'
  );
  assert.equal(
    classifyRelatedMediaCategory('Breaking Bad Season 5 Recap in 10 minutes'),
    'recap'
  );
  assert.equal(
    classifyRelatedMediaCategory('Oppenheimer Deep Dive and Hidden Details You Missed'),
    'analysis'
  );
  assert.equal(
    classifyRelatedMediaCategory('Christopher Nolan Cast Interview on Inception'),
    'interview'
  );
  assert.equal(
    classifyRelatedMediaCategory('Spoilers Discussion Podcast on Dune Part Two'),
    'discussion'
  );
  assert.equal(
    classifyRelatedMediaCategory('Random clip about sound design'),
    'other'
  );
});

test('normalizeMediaTitle strips dirty torrent release noise', () => {
  assert.equal(
    normalizeMediaTitle('The Dark Knight 2008 1080p BluRay Hindi x264'),
    'The Dark Knight 2008'
  );
  assert.equal(
    normalizeMediaTitle('Inception.2010.2160p.UHD.Remux.HDR.HEVC'),
    'Inception 2010 Remux HDR'
  );
  assert.equal(
    normalizeMediaTitle('Breaking.Bad.S05E14.720p.HDTV.x264'),
    'Breaking Bad HDTV'
  );
});

test('buildRelatedMediaQueries creates target queries based on request', () => {
  const movieQueries = buildRelatedMediaQueries({
    title: 'Inception',
    year: 2010,
    type: 'explanation',
  });
  assert.ok(movieQueries.includes('Inception 2010 ending explained'));

  const tvQueries = buildRelatedMediaQueries({
    title: 'Breaking Bad',
    season: 5,
    episode: 14,
    type: 'recap',
  });
  assert.ok(tvQueries.includes('Breaking Bad S05E14 recap'));

  const allQueries = buildRelatedMediaQueries({
    title: 'The Dark Knight',
    year: 2008,
    type: 'all',
  });
  assert.ok(allQueries.some((q) => q.includes('review')));
  assert.ok(allQueries.some((q) => q.includes('ending explained')));
});

test('deduplicateRelatedMedia eliminates duplicate urls, externalIds, and titles', () => {
  const items: RelatedMediaResult[] = [
    {
      id: 'youtube:123',
      title: 'Inception Review',
      source: { provider: 'YouTube', url: 'https://www.youtube.com/watch?v=123', externalId: '123' },
      type: 'video',
      category: 'review',
    },
    {
      id: 'youtube:123-dup',
      title: 'Inception Review 2',
      source: { provider: 'YouTube', url: 'https://youtube.com/watch?v=123&utm_source=share', externalId: '123' },
      type: 'video',
      category: 'review',
    },
    {
      id: 'dailymotion:456',
      title: 'Inception Review',
      source: { provider: 'Dailymotion', url: 'https://dailymotion.com/video/456', externalId: '456' },
      type: 'video',
      category: 'review',
    },
  ];

  const deduped = deduplicateRelatedMedia(items);
  // Item 2 has duplicate externalId and URL, item 3 has identical title
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].id, 'youtube:123');
});

test('rankRelatedMedia scores exact title and year match higher', () => {
  const req: RelatedMediaSearchRequest = {
    title: 'Inception',
    year: 2010,
    type: 'explanation',
  };

  const items: RelatedMediaResult[] = [
    {
      id: '1',
      title: 'Random Movie ending explained',
      source: { provider: 'YouTube', url: 'https://youtube.com/watch?v=1' },
      type: 'video',
      category: 'explanation',
    },
    {
      id: '2',
      title: 'Inception 2010 Ending Explained in Depth',
      source: { provider: 'YouTube', url: 'https://youtube.com/watch?v=2' },
      type: 'video',
      category: 'explanation',
      durationSeconds: 900,
    },
    {
      id: '3',
      title: 'Inception Quick Thoughts',
      source: { provider: 'YouTube', url: 'https://youtube.com/watch?v=3' },
      type: 'video',
      category: 'discussion',
    },
  ];

  const ranked = rankRelatedMedia(items, req);
  assert.equal(ranked[0].id, '2');
});

test('RelatedMediaService isolates provider failures and caches results', async () => {
  const mockHealthyProvider: RelatedMediaProvider = {
    id: 'mock-healthy',
    name: 'Mock Healthy',
    async search() {
      return [
        {
          id: 'mock:1',
          title: 'Inception Review',
          source: { provider: 'Mock Healthy', url: 'https://mock.test/1' },
          type: 'review',
          category: 'review',
        },
      ];
    },
  };

  const mockFailingProvider: RelatedMediaProvider = {
    id: 'mock-failing',
    name: 'Mock Failing',
    async search() {
      throw new Error('Network failure');
    },
  };

  const service = new RelatedMediaService([mockHealthyProvider, mockFailingProvider]);

  // First call fetches from providers
  const res1 = await service.search({ title: 'Inception', year: 2010 });
  assert.equal(res1.ok, true);
  assert.equal(res1.cached, false);
  assert.equal(res1.results.length, 1);
  assert.equal(res1.results[0].id, 'mock:1');

  // Second call returns from cache
  const res2 = await service.search({ title: 'Inception', year: 2010 });
  assert.equal(res2.ok, true);
  assert.equal(res2.cached, true);

  // forceRefresh bypasses cache
  const res3 = await service.search({ title: 'Inception', year: 2010, forceRefresh: true });
  assert.equal(res3.ok, true);
  assert.equal(res3.cached, false);
});
