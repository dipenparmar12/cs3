import { test } from 'node:test';
import assert from 'node:assert/strict';

import { historyEventMatches } from './historyStore.ts';
import type { HistoryEvent } from '../../src/types/history';

const event = (overrides: Partial<HistoryEvent> = {}): HistoryEvent => ({
  id: '1',
  mediaKey: 'severance:2022',
  title: 'Good News About Hell',
  parentTitle: 'Severance',
  year: 2022,
  type: 'TvSeries',
  mediaUrl: 'cs3ext://Provider/handle',
  season: 1,
  episode: 1,
  action: 'Play' as HistoryEvent['action'],
  status: 'Failed' as HistoryEvent['status'],
  timestamp: 0,
  source: { providerName: 'Hindmoviez', resolution: 1080, quality: 'WEB-DL' },
  failureReason: 'HTTP 403 from origin',
  ...overrides,
});

test('the series name finds its episodes, not only the episode title', () => {
  assert.equal(historyEventMatches(event(), 'severance'), true);
  assert.equal(historyEventMatches(event(), 'good news'), true);
});

test('every word must match somewhere, across fields', () => {
  assert.equal(historyEventMatches(event(), 'severance 2022'), true);
  assert.equal(historyEventMatches(event(), 'severance hindmoviez 1080p'), true);
  assert.equal(historyEventMatches(event(), 'severance 720p'), false);
});

test('an episode is found by its usual spellings', () => {
  for (const query of ['s01e01', 's1e1', '1x01', 'severance s1e1']) {
    assert.equal(historyEventMatches(event(), query), true, query);
  }
  assert.equal(historyEventMatches(event(), 's01e02'), false);
});

test('status and failure reason are searchable', () => {
  assert.equal(historyEventMatches(event(), 'failed 403'), true);
  assert.equal(historyEventMatches(event({ status: 'Played' as HistoryEvent['status'], failureReason: undefined }), '403'), false);
});
