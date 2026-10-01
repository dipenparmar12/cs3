import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatVideoDate,
  formatVideoDuration,
  mergeVideos,
  youTubeIdFrom,
  youTubeThumbnail,
} from './videoGallery.ts';
import { parseDurationSeconds } from '../../electron/metadata/youtube.ts';
import { MetadataSource, TitleVideoKind, type TitleVideo } from '../types/metadata.ts';

test('youTubeIdFrom extracts 11-char ID from all common YouTube URL formats', () => {
  const id = 'dQw4w9WgXcQ';
  assert.equal(youTubeIdFrom(id), id);
  assert.equal(youTubeIdFrom(`https://www.youtube.com/watch?v=${id}`), id);
  assert.equal(youTubeIdFrom(`https://youtube.com/watch?v=${id}&feature=shared`), id);
  assert.equal(youTubeIdFrom(`https://youtu.be/${id}`), id);
  assert.equal(youTubeIdFrom(`https://www.youtube.com/embed/${id}`), id);
  assert.equal(youTubeIdFrom(`https://www.youtube.com/shorts/${id}`), id);
  assert.equal(youTubeIdFrom(`https://www.youtube-nocookie.com/embed/${id}`), id);

  assert.equal(youTubeIdFrom('https://vimeo.com/123456789'), null);
  assert.equal(youTubeIdFrom('not-a-valid-id'), null);
  assert.equal(youTubeIdFrom(''), null);
  assert.equal(youTubeIdFrom(undefined), null);
});

test('youTubeThumbnail constructs correct image URL', () => {
  assert.equal(
    youTubeThumbnail('dQw4w9WgXcQ'),
    'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'
  );
});

test('parseDurationSeconds converts standard YouTube time strings to seconds', () => {
  assert.equal(parseDurationSeconds('2:35'), 155);
  assert.equal(parseDurationSeconds('0:45'), 45);
  assert.equal(parseDurationSeconds('1:02:10'), 3730);
  assert.equal(parseDurationSeconds('59'), 59);

  assert.equal(parseDurationSeconds(undefined), undefined);
  assert.equal(parseDurationSeconds(''), undefined);
  assert.equal(parseDurationSeconds('invalid:time'), undefined);
  assert.equal(parseDurationSeconds('1:2:3:4'), undefined);
});

test('mergeVideos deduplicates by id while retaining richer metadata and merging sources', () => {
  const video1: TitleVideo = {
    id: 'youtube:dQw4w9WgXcQ',
    title: 'Teaser',
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    kind: TitleVideoKind.Teaser,
    label: 'Teaser',
    host: 'youtube',
    sources: [MetadataSource.Cinemeta],
  };

  const video2: TitleVideo = {
    id: 'youtube:dQw4w9WgXcQ',
    title: 'Official Trailer (Rich)',
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    kind: TitleVideoKind.Trailer,
    label: 'Official Trailer',
    host: 'youtube',
    publisher: 'Warner Bros.',
    durationSeconds: 145,
    publishedAt: '2024-03-01T00:00:00Z',
    sources: [MetadataSource.YouTube],
  };

  const video3: TitleVideo = {
    id: 'youtube:other123456',
    title: 'Behind the Scenes',
    url: 'https://www.youtube.com/watch?v=other123456',
    kind: TitleVideoKind.BehindTheScenes,
    label: 'Featurette',
    host: 'youtube',
    sources: [MetadataSource.Provider],
  };

  const merged = mergeVideos([[video1], [video2, video3]]);
  assert.equal(merged.length, 2);

  const primary = merged.find((v) => v.id === 'youtube:dQw4w9WgXcQ');
  assert.ok(primary);
  assert.equal(primary.publisher, 'Warner Bros.');
  assert.equal(primary.durationSeconds, 145);
  assert.equal(primary.publishedAt, '2024-03-01T00:00:00Z');
  assert.deepEqual(primary.sources, [MetadataSource.Cinemeta, MetadataSource.YouTube]);

  const secondary = merged.find((v) => v.id === 'youtube:other123456');
  assert.ok(secondary);
  assert.equal(secondary.sources?.[0], MetadataSource.Provider);
});

test('formatVideoDuration formats seconds into M:SS correctly', () => {
  assert.equal(formatVideoDuration(142), '2:22');
  assert.equal(formatVideoDuration(59), '0:59');
  assert.equal(formatVideoDuration(3600), '60:00');
  assert.equal(formatVideoDuration(0), null);
  assert.equal(formatVideoDuration(-10), null);
  assert.equal(formatVideoDuration(undefined), null);
});

test('formatVideoDate extracts 4-digit year from ISO date', () => {
  assert.equal(formatVideoDate('2024-05-12T10:00:00Z'), '2024');
  assert.equal(formatVideoDate('1999-12-31'), '1999');
  assert.equal(formatVideoDate('invalid'), null);
  assert.equal(formatVideoDate(undefined), null);
});
