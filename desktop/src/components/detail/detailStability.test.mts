/**
 * The detail page holds still while its metadata arrives.
 *
 *   node --experimental-strip-types src/components/detail/detailStability.test.mts
 *
 * Measured in the running app (Chromium's layout-shift API, 2026-10-19): a
 * revisited title scored a cumulative shift of 0.262 before — the poster moved
 * 85px and the text 54px as answers landed, and the ratings row flickered,
 * moving them back and forth a second later — and 0 after; a first visit
 * scored ~0.12 before and 0.0003 after. The causes were each a rule nobody had
 * written down, so each is pinned here: how a slow, failed, partial or
 * out-of-order answer is applied, and where late content may sit.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  emptyRatingsView,
  latestOnly,
  ratingsRequestKey,
  ratingsRowState,
  ratingsWorkKey,
  settleRatings,
} from './ratingsRow.ts';
import { acceptExtendedPush, clearsExtended } from '../../utils/extendedRecord.ts';
import type { MediaRating } from '../../types/ratings.ts';
import type { ExtendedMetadata } from '../../types/metadata.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const imdb = { source: 'imdb', score: 8.1, displayValue: '8.1/10' } as unknown as MediaRating;
const tmdb = { source: 'tmdb', score: 7.9, displayValue: '7.9/10' } as unknown as MediaRating;
const dune = { title: 'Dune', year: 2021, type: 'movie' };

// --- the ratings row ---------------------------------------------------------

test('a slow lookup holds the row with a placeholder rather than nothing', () => {
  const work = ratingsWorkKey(dune);
  assert.equal(ratingsRowState(emptyRatingsView(work), work), 'placeholder');
});

test('a lookup that finds nothing, or fails, omits the row once and for good', () => {
  const work = ratingsWorkKey(dune);
  assert.equal(ratingsRowState(settleRatings(emptyRatingsView(work), work, []), work), 'hidden');
  assert.equal(ratingsRowState(settleRatings(emptyRatingsView(work), work, null), work), 'hidden');
});

test('ratings that arrive replace the placeholder in place', () => {
  const work = ratingsWorkKey(dune);
  const view = settleRatings(emptyRatingsView(work), work, [imdb]);
  assert.equal(ratingsRowState(view, work), 'chips');
  assert.deepEqual(view.ratings, [imdb]);
});

test('a refinement that comes back empty or fails never blanks a filled row', () => {
  const work = ratingsWorkKey(dune);
  const filled = settleRatings(emptyRatingsView(work), work, [imdb]);
  assert.deepEqual(settleRatings(filled, work, []).ratings, [imdb]);
  assert.deepEqual(settleRatings(filled, work, null).ratings, [imdb]);
  assert.deepEqual(settleRatings(filled, work, [imdb, tmdb]).ratings, [imdb, tmdb]);
});

test('an IMDb id arriving refines the request but not the work, so nothing is cleared', () => {
  const later = { ...dune, imdbId: 'tt1160419' };
  assert.equal(ratingsWorkKey(later), ratingsWorkKey(dune));
  assert.notEqual(ratingsRequestKey(later), ratingsRequestKey(dune));
});

test('another work starts empty — one film’s ratings never show under another', () => {
  const duneWork = ratingsWorkKey(dune);
  const filled = settleRatings(emptyRatingsView(duneWork), duneWork, [imdb]);
  const other = ratingsWorkKey({ title: 'Arrival', year: 2016, type: 'movie' });
  assert.equal(ratingsRowState(filled, other), 'placeholder');
  assert.deepEqual(settleRatings(filled, other, []).ratings, []);
});

test('only the newest of two overlapping lookups may answer', () => {
  const tickets = latestOnly();
  const byTitle = tickets.issue();
  const byImdb = tickets.issue();
  // The slower, older one lands last and is dropped.
  assert.equal(tickets.isCurrent(byImdb), true);
  assert.equal(tickets.isCurrent(byTitle), false);
});

test('the identity object being rebuilt every render does not change the request', () => {
  const first = { ...dune, imdbId: 'tt1160419', tmdbId: 438631 };
  const rebuilt = { ...first };
  assert.notEqual(first, rebuilt);
  assert.equal(ratingsRequestKey(first), ratingsRequestKey(rebuilt));
});

// --- the catalogue record ------------------------------------------------------

const record = (url: string, partial: boolean, marker: string): ExtendedMetadata =>
  ({ url, partial, plot: marker }) as unknown as ExtendedMetadata;

test('records fill in progressively, partial after partial', () => {
  const page = 'cs3ext://provider/dune';
  const first = acceptExtendedPush(null, record(page, true, 'wikidata'), page);
  const second = acceptExtendedPush(first, record(page, true, 'wikidata+tvmaze'), page);
  assert.equal((second as unknown as { plot: string }).plot, 'wikidata+tvmaze');
});

test('a late partial never replaces the complete record that came before it', () => {
  const page = 'cs3ext://provider/dune';
  const complete = record(page, false, 'all four');
  assert.equal(acceptExtendedPush(complete, record(page, true, 'one'), page), complete);
});

test('a record for a page already left is ignored', () => {
  const page = 'cs3ext://provider/dune';
  const shown = record(page, false, 'dune');
  assert.equal(acceptExtendedPush(shown, record('cs3ext://provider/arrival', false, 'arrival'), page), shown);
});

test('the same page asked again keeps its record; another page clears it', () => {
  assert.equal(clearsExtended('cs3ext://provider/dune', 'cs3ext://provider/dune'), false);
  assert.equal(clearsExtended('cs3ext://provider/dune', 'cs3ext://provider/arrival'), true);
  assert.equal(clearsExtended(null, 'cs3ext://provider/dune'), true);
});

// --- where late content may sit ------------------------------------------------

const heroSource = fs.readFileSync(path.join(here, 'DetailHero.tsx'), 'utf8');
const css = fs.readFileSync(path.join(here, '../../sources.css'), 'utf8').replace(/\r\n/g, '\n');

test('everything that can arrive late is laid out below the play row', () => {
  const main = heroSource.slice(heroSource.indexOf('export const DetailHero:'), heroSource.indexOf('function useLoadedImage'));
  const cta = main.indexOf('className="detail-hero__cta"');
  assert.ok(cta > 0, 'the play row is drawn');
  for (const late of ['detail-hero__plot-foot', 'detail-hero__tags', '<MediaRatings', 'lateOriginalTitle &&', 'detail-hero__fallback']) {
    const at = main.indexOf(late);
    assert.ok(at > cta, `${late} must come after the play row`);
  }
});

test('the masthead has one frame, with or without a backdrop', () => {
  assert.ok(!css.includes('detail-hero--with-backdrop'), 'no geometry may depend on a backdrop having arrived');
  const rule = css.slice(css.indexOf('.detail-hero--cinema {'), css.indexOf('}', css.indexOf('.detail-hero--cinema {')));
  assert.match(rule, /min-height:\s*440px/);
  const inner = css.slice(css.indexOf('.detail-hero__inner {'), css.indexOf('}', css.indexOf('.detail-hero__inner {')));
  assert.match(inner, /align-items:\s*flex-start/, 'text pinned to the top, so rows added below cannot lift the title');
});
