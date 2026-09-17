import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isLookingUp,
  metadataSectionState,
  shouldShowStatus,
} from './metadataSection.ts';
import { CreditRole, MetadataSource, type ExtendedMetadata } from '../../types/metadata.ts';

/**
 * What the metadata section draws, and when.
 *
 * Reported as: "we do not know what is happening unless the metadata is found".
 * The section rendered `null` for the whole lookup — five third-party hosts,
 * Wikidata alone measured at 11.3s on Breaking Bad — so a slow fetch and a
 * title no catalogue has ever heard of produced the identical screen, which is
 * exactly the distinction `MetadataSourceOutcome` exists to preserve.
 *
 * Every case below is silent when it goes wrong: a spinner that never clears
 * and a blank section during a fetch look like nothing at all until somebody
 * sits and waits, which is why this rule is a plain module and not logic inside
 * the `.tsx` that Node cannot load.
 */

const empty = (over: Partial<ExtendedMetadata> = {}): ExtendedMetadata => ({
  url: 'cs3ext://HDO/abc',
  ids: {},
  outcomes: [],
  fetchedAt: 0,
  ...over,
});

const withCast = (over: Partial<ExtendedMetadata> = {}): ExtendedMetadata =>
  empty({
    people: [{ name: 'Bryan Cranston', role: CreditRole.Cast, sources: [MetadataSource.TvMaze] }],
    ...over,
  });

// --- the four states -------------------------------------------------------

test('a lookup that has not started producing anything says it is running', () => {
  // The case the whole change exists for: no record at all, because the id is
  // still being resolved from the title.
  assert.equal(metadataSectionState({ metadata: null, pending: true }), 'looking');
  assert.equal(shouldShowStatus({ metadata: null, pending: true }), true);
});

test('a settled lookup that found nothing draws nothing', () => {
  // The original rule, unchanged: an empty "Cast" heading on a title none of
  // the catalogues carries would be permanent and wrong.
  assert.equal(metadataSectionState({ metadata: null, pending: false }), 'nothing');
  assert.equal(metadataSectionState({ metadata: empty(), pending: false }), 'nothing');
  assert.equal(shouldShowStatus({ metadata: empty(), pending: false }), false);
});

test('the provider names outrank a sentence about a lookup', () => {
  // Names already on screen beat an announcement that more may arrive.
  const input = { metadata: null, fallbackActors: ['Bryan Cranston'], pending: true };
  assert.equal(metadataSectionState(input), 'fallback');
  assert.equal(
    shouldShowStatus(input),
    true,
    'and the flat list still says faces and characters are coming'
  );
});

test('anything found outranks everything else', () => {
  assert.equal(metadataSectionState({ metadata: withCast(), pending: true }), 'content');
  assert.equal(
    metadataSectionState({ metadata: withCast(), fallbackActors: ['X'], pending: false }),
    'content'
  );
});

// --- the two independent reasons to be waiting -----------------------------

test('the record reports its own partial state', () => {
  // `partial` is what the push channel sets while sources are still landing.
  assert.equal(isLookingUp({ metadata: withCast({ partial: true }) }), true);
  assert.equal(isLookingUp({ metadata: withCast({ partial: undefined }) }), false);
});

test('and the caller reports the window before a record exists', () => {
  // `partial` cannot cover this: there is no record to carry it while the IMDb
  // id is being resolved from the title, which is the longest part of the wait
  // for exactly the pages that used to show nothing.
  assert.equal(isLookingUp({ metadata: null, pending: true }), true);
  assert.equal(isLookingUp({ metadata: null, pending: false }), false);
});

test('a finished record ends the wait even while the caller still says pending', () => {
  // The push channel delivers the completed record before the awaited call
  // returns for a title already being fetched for someone else. The status must
  // not outlive the data it was describing.
  assert.equal(shouldShowStatus({ metadata: withCast({ partial: true }), pending: false }), true);
  assert.equal(
    shouldShowStatus({ metadata: withCast(), pending: false }),
    false,
    'complete record, nothing pending — the line goes'
  );
});

test('a status is never shown over a section that will draw nothing', () => {
  // A spinner that outlives its request is worse than no spinner. `nothing` is
  // the one state where the section is absent, so a status line there would be
  // the only thing on screen and would describe work that has stopped.
  assert.equal(
    shouldShowStatus({ metadata: null, pending: false }),
    false,
    'settled and empty'
  );
});
