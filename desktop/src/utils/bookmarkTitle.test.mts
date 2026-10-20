import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bookmarkTitle, titleFromAddress } from './bookmarkTitle.ts';

// The saved page that opened a detail page with no title (Binged, 2026-10-20).
const BINGED =
  'cs3ext://Binged/https%3A%2F%2Fwww.binged.com%2Fstreaming-premiere-dates%2Fthe-discovery-of-india-hindi-web-series-streaming-online-watch%2F';

test('a title the page has is kept exactly as saved', () => {
  assert.equal(bookmarkTitle({ title: 'Dhobi Ghat (Hindi)', mediaUrl: BINGED }), 'Dhobi Ghat (Hindi)');
});

test('an empty or blank title falls back to the search that found the page', () => {
  const origin = { searchQuery: 'The Discovery of India 1988' };
  assert.equal(bookmarkTitle({ title: '', mediaUrl: BINGED, origin }), 'The Discovery of India 1988');
  assert.equal(bookmarkTitle({ title: '   ', mediaUrl: BINGED, origin }), 'The Discovery of India 1988');
  assert.equal(bookmarkTitle({ mediaUrl: BINGED, origin }), 'The Discovery of India 1988');
});

test('with no search either, the address names it', () => {
  assert.equal(
    bookmarkTitle({ title: '', mediaUrl: BINGED }),
    'the discovery of india hindi web series streaming online watch'
  );
});

test('an address that names nothing still gives a readable label, never an empty string', () => {
  assert.equal(bookmarkTitle({ title: '', mediaUrl: 'cs3meta://cinemeta/movie/tt0133093' }), 'Saved page');
  assert.equal(bookmarkTitle({ title: '', mediaUrl: 'cs3ext://Pikashow/https%3A%2F%2Fmanoda.co%2F14064' }), 'Saved page');
  assert.equal(titleFromAddress(''), '');
});

test('an undecodable address does not throw', () => {
  assert.doesNotThrow(() => titleFromAddress('cs3ext://P/%E0%A4%A'));
});
