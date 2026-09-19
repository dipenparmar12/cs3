import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CardBadge,
  badgeTooltip,
  cardStateFor,
  primaryBadge,
  shouldRetryOnOpen,
} from './cardState.ts';
import type { TitleInteraction } from '../types/interactions.ts';

/**
 * The card rule, pinned.
 *
 * Every assertion here is about a failure that would be *invisible*: a card
 * says something plausible about a title and the viewer believes it. The two
 * that matter most are the staleness rules — a warning that survives the viewer
 * disproving it, and a retry that never fires — because both look exactly like
 * the feature working.
 */

const HOUR = 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

function interaction(patch: Partial<TitleInteraction> = {}): TitleInteraction {
  return { url: 'cs3ext://Prov/abc', key: 'dune:2021', ...patch };
}

test('nothing known draws nothing', () => {
  const state = cardStateFor(null);
  assert.equal(state.visited, false);
  assert.deepEqual(state.badges, []);
  assert.equal(primaryBadge(state), null);
});

test('a visit dims the card and is never a badge', () => {
  const state = cardStateFor(
    interaction({ visited: { firstAt: NOW - HOUR, lastAt: NOW, count: 3 } })
  );
  assert.equal(state.visited, true);
  assert.deepEqual(state.badges, [], 'visited must not compete for the corner');
});

test('a played outcome is not badged — only failures are marked', () => {
  const state = cardStateFor(
    interaction({ outcome: { kind: 'played', at: NOW } })
  );
  assert.deepEqual(state.badges, []);
});

test('our failure and the source having nothing are different badges', () => {
  const ours = cardStateFor(interaction({ outcome: { kind: 'app-error', at: NOW } }));
  const theirs = cardStateFor(interaction({ outcome: { kind: 'no-sources', at: NOW } }));
  assert.equal(primaryBadge(ours), CardBadge.Failed);
  assert.equal(primaryBadge(theirs), CardBadge.NoSources);
  assert.notEqual(
    primaryBadge(ours),
    primaryBadge(theirs),
    'folding these together blames the content for our bug'
  );
});

test('watching the title since the failure retires the warning', () => {
  const state = cardStateFor(
    interaction({
      outcome: { kind: 'no-sources', at: NOW - HOUR },
      watch: { percent: 40, completed: false, updatedAt: NOW },
    })
  );
  assert.equal(
    state.badges.includes(CardBadge.NoSources),
    false,
    'the viewer disproved it by watching it'
  );
  assert.equal(primaryBadge(state), CardBadge.Continue);
});

test('a completed download also retires the warning', () => {
  const state = cardStateFor(
    interaction({
      outcome: { kind: 'no-sources', at: NOW - HOUR },
      download: { state: 'completed', variants: 1 },
    })
  );
  assert.equal(primaryBadge(state), CardBadge.Downloaded);
});

test('watch progress older than the failure leaves the warning standing', () => {
  const state = cardStateFor(
    interaction({
      outcome: { kind: 'no-sources', at: NOW },
      watch: { percent: 40, completed: false, updatedAt: NOW - HOUR },
    })
  );
  assert.equal(primaryBadge(state), CardBadge.NoSources);
});

test('a running transfer outranks everything — it is the state that moves', () => {
  const state = cardStateFor(
    interaction({
      outcome: { kind: 'no-sources', at: NOW },
      download: { state: 'downloading', percent: 12, variants: 2 },
      watch: { percent: 40, completed: false, updatedAt: NOW - HOUR },
    })
  );
  assert.equal(primaryBadge(state), CardBadge.Downloading);
  assert.equal(
    state.badges.includes(CardBadge.NoSources),
    true,
    'the other states stay in the list even though only one is drawn'
  );
});

test('a queued transfer reads as downloading from outside the queue', () => {
  const state = cardStateFor(interaction({ download: { state: 'queued', variants: 1 } }));
  assert.equal(primaryBadge(state), CardBadge.Downloading);
});

test('a paused transfer is not badged', () => {
  const state = cardStateFor(interaction({ download: { state: 'paused', variants: 1 } }));
  assert.deepEqual(state.badges, [], 'the viewer paused it, on a screen that shows it');
});

test('partly watched beats finished, and supplies the bar', () => {
  const state = cardStateFor(
    interaction({ watch: { percent: 38, completed: false, updatedAt: NOW } })
  );
  assert.equal(primaryBadge(state), CardBadge.Continue);
  assert.equal(state.progressPercent, 38);
});

test('a finished title has no bar', () => {
  const state = cardStateFor(
    interaction({ watch: { percent: 100, completed: true, updatedAt: NOW } })
  );
  assert.equal(primaryBadge(state), CardBadge.Watched);
  assert.equal(state.progressPercent, undefined, 'a full bar on every watched card is noise');
});

test('ready is shown only when nothing more specific is true', () => {
  const alone = cardStateFor(interaction({ sources: { ready: 12, expired: false } }));
  assert.equal(primaryBadge(alone), CardBadge.Ready);

  const beside = cardStateFor(
    interaction({
      sources: { ready: 12, expired: false },
      download: { state: 'completed', variants: 1 },
    })
  );
  assert.equal(
    beside.badges.includes(CardBadge.Ready),
    false,
    '"ready" beside "downloaded" is two ways of saying one thing'
  );
});

test('an entry whose links have all expired is not ready', () => {
  const state = cardStateFor(interaction({ sources: { ready: 0, expired: true } }));
  assert.deepEqual(
    state.badges,
    [],
    'badging this ready is how a readiness claim comes to mean nothing'
  );
});

test('tooltips say a whole sentence and never an internal word', () => {
  const record = interaction({
    download: { state: 'downloading', percent: 41.6, variants: 1 },
  });
  assert.equal(badgeTooltip(CardBadge.Downloading, record), 'Downloading — 42%');
  assert.equal(badgeTooltip(CardBadge.NoSources), 'No playable source found last time');
  assert.equal(
    badgeTooltip(CardBadge.Failed, interaction({ outcome: { kind: 'app-error', at: NOW, reason: 'HTTP 403' } })),
    'Playback failed last time: HTTP 403'
  );
});

test('opening a failed title retries, and a working one does not', () => {
  assert.equal(shouldRetryOnOpen(interaction({ outcome: { kind: 'no-sources', at: NOW } })), true);
  assert.equal(shouldRetryOnOpen(interaction({ outcome: { kind: 'app-error', at: NOW } })), true);
  assert.equal(shouldRetryOnOpen(interaction({ outcome: { kind: 'played', at: NOW } })), false);
  assert.equal(shouldRetryOnOpen(interaction()), false);
  assert.equal(shouldRetryOnOpen(null), false);
});

test('a failure the viewer has since disproved does not retry either', () => {
  assert.equal(
    shouldRetryOnOpen(
      interaction({
        outcome: { kind: 'no-sources', at: NOW - HOUR },
        watch: { percent: 12, completed: false, updatedAt: NOW },
      })
    ),
    false,
    'a full fan-out on every open of something that works is the cost of getting this wrong'
  );
});
