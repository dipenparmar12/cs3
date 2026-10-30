import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HEAD_PRIORITY_BYTES, planPieces, type PiecePlan } from './piecePlan.ts';
interface Item { from: number; to: number; priority: number; isStreamSelection: boolean }

// WebTorrent's own selection list, to check what a plan becomes once WebTorrent
// has merged it — that merge is the bug the plan avoids. Untyped internals.
const { Selections } = (await import(
  new URL('../../node_modules/webtorrent/lib/selections.js', import.meta.url).href
)) as {
  Selections: new () => {
    _items: Item[];
    insert(item: Item & { offset: number }): void;
    sort(fn: (a: Item, b: Item) => number): void;
  };
};

const MB = 1024 * 1024;
const PIECE = 4 * MB;
const FILM = { offset: 0, length: 18 * 1024 * MB };
const LAST = FILM.length / PIECE - 1;
const MID = Math.floor(LAST * 0.6);

/** WebTorrent's selection list after the plan, then a player read from `readFrom`. */
function withRead(plan: PiecePlan, readFrom: number): Item[] {
  const list = new Selections();
  const insert = (from: number, to: number, priority: number, isStreamSelection: boolean) => {
    list.insert({ from, to, offset: 0, priority, isStreamSelection });
    list.sort((a: Item, b: Item) => b.priority - a.priority);
  };
  for (const s of plan.selections) insert(s.from, s.to, s.priority, false);
  insert(readFrom, LAST, 1, true);
  return [...list._items];
}

/** Whether the read at `piece` comes first: nothing outranks it there. */
function readComesFirst(items: Item[], piece: number): boolean {
  const first = items.find((s) => s.from <= piece && s.to >= piece);
  return Boolean(first?.isStreamSelection);
}

test('a stream selects a head and an MP4 tail window, never its whole file', () => {
  const plan = planPieces({ pieceLength: PIECE, stream: { ...FILM, tailBytes: 4 * MB }, downloads: [] });
  assert.equal(plan.strategy, 'sequential');
  assert.deepEqual(plan.selections, [
    { from: 0, to: HEAD_PRIORITY_BYTES / PIECE - 1, priority: 10 },
    { from: LAST, to: LAST, priority: 9 },
  ]);
});

test('after WebTorrent merges the plan, a seek read is the first thing fetched mid-file', () => {
  const plan = planPieces({ pieceLength: PIECE, stream: { ...FILM, tailBytes: 4 * MB }, downloads: [] });
  assert.ok(readComesFirst(withRead(plan, MID), MID));
});

test('no tail window for containers without a trailing index', () => {
  const plan = planPieces({ pieceLength: PIECE, stream: { ...FILM, tailBytes: 0 }, downloads: [] });
  assert.equal(plan.selections.length, 1);
});

test('a file smaller than the head window is one window, never an overlapping tail', () => {
  const plan = planPieces({ pieceLength: PIECE, stream: { offset: 0, length: 6 * MB, tailBytes: 4 * MB }, downloads: [] });
  assert.deepEqual(plan.selections, [{ from: 0, to: 1, priority: 10 }]);
});

test('a file inside a pack is planned in the torrent’s piece space', () => {
  const offset = 100 * PIECE + 10;
  const plan = planPieces({ pieceLength: PIECE, stream: { offset, length: 40 * MB, tailBytes: MB }, downloads: [] });
  assert.equal(plan.selections[0].from, 100);
  assert.equal(plan.selections.at(-1)!.to, Math.floor((offset + 40 * MB - 1) / PIECE));
  assert.ok(plan.selections[1].from > plan.selections[0].to);
});

test('a download takes its whole file, rarest first, below any read', () => {
  const plan = planPieces({ pieceLength: PIECE, downloads: [FILM] });
  assert.deepEqual(plan, { strategy: 'rarest', selections: [{ from: 0, to: LAST, priority: 0 }] });
});

test('streaming a file that is also downloading: sequential, and the read still comes first', () => {
  const plan = planPieces({ pieceLength: PIECE, stream: { ...FILM, tailBytes: 4 * MB }, downloads: [FILM] });
  assert.equal(plan.strategy, 'sequential');
  assert.deepEqual(plan.selections, [{ from: 0, to: LAST, priority: 0 }]);
  assert.ok(readComesFirst(withRead(plan, MID), MID));
});

test('two downloads in one pack are both kept selected', () => {
  const plan = planPieces({
    pieceLength: PIECE,
    downloads: [{ offset: 0, length: 40 * MB }, { offset: 80 * MB, length: 40 * MB }],
  });
  assert.deepEqual(plan.selections.map((s) => [s.from, s.to]), [[0, 9], [20, 29]]);
});

test('nothing to plan before the piece length is known, or with no holder', () => {
  assert.deepEqual(planPieces({ pieceLength: 0, stream: { ...FILM, tailBytes: 0 }, downloads: [] }).selections, []);
  assert.deepEqual(planPieces({ pieceLength: PIECE, downloads: [] }).selections, []);
});
