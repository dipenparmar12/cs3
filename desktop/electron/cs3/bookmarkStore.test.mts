/**
 * A saved page always has a title.
 *
 * The Binged series page was saved with `title: ""`; the Library drew an empty
 * row, and opening it drew a detail page with no title.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BookmarkStore, type Bookmark } from './bookmarkStore.ts';

const ADDRESS =
  'cs3ext://Binged/https%3A%2F%2Fwww.binged.com%2Fstreaming-premiere-dates%2Fthe-discovery-of-india-hindi-web-series-streaming-online-watch%2F';

function datastore(initial: Bookmark[] = []) {
  const values = new Map<string, unknown>([['saved_detail_pages', initial]]);
  return {
    getObject: <T,>(key: string, fallback: T) => (values.has(key) ? (values.get(key) as T) : fallback),
    setObject: (key: string, value: unknown) => void values.set(key, value),
  } as never;
}

type Input = Omit<Bookmark, 'id' | 'savedAt' | 'openCount'>;

const input = (over: Partial<Input> = {}): Input => ({
  mediaUrl: ADDRESS,
  title: '',
  type: 'TvSeries',
  genres: [],
  origin: { provider: 'Binged', searchQuery: 'The Discovery of India 1988' },
  ...over,
});

test('a page saved without a name is named after the search that found it', () => {
  const store = new BookmarkStore(datastore());
  assert.equal(store.save(input()).title, 'The Discovery of India 1988');
  assert.equal(store.list()[0].title, 'The Discovery of India 1988');
});

test('a row already stored with an empty title is repaired when read', () => {
  const legacy = { ...input(), id: ADDRESS, savedAt: 1, openCount: 0 } as Bookmark;
  const store = new BookmarkStore(datastore([legacy]));
  assert.equal(store.list()[0].title, 'The Discovery of India 1988');
  assert.equal(store.get(ADDRESS)?.title, 'The Discovery of India 1988');
});

test('saving again without a name does not blank the name the page already had', () => {
  const store = new BookmarkStore(datastore());
  store.save(input({ title: 'The Discovery of India' }));
  assert.equal(store.save(input({ title: '' })).title, 'The Discovery of India');
});

test('a name that is there is never replaced by a fallback', () => {
  const store = new BookmarkStore(datastore());
  assert.equal(store.save(input({ title: 'Bharat Ek Khoj' })).title, 'Bharat Ek Khoj');
});

test('a placeholder title ("Unknown Title") is repaired when read and never overwrites a real one', () => {
  const stored = { ...input({ title: 'Unknown Title' }), id: ADDRESS, savedAt: 1, openCount: 0 } as Bookmark;
  const store = new BookmarkStore(datastore([stored]));
  assert.equal(store.list()[0].title, 'The Discovery of India 1988');

  const fresh = new BookmarkStore(datastore());
  fresh.save(input({ title: 'The Discovery of India' }));
  assert.equal(fresh.save(input({ title: 'Unknown Title' })).title, 'The Discovery of India');
});
