import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SearchResponse } from '../types/api.ts';
import {
  cardKeyOf,
  calculateVirtualWindow,
  cardWidth,
  gridColumns,
  rowPitch,
} from './searchVirtualGrid.ts';

// Imports the production module, not a copy. Expected values are worked out from
// the CSS (gap 20px, minmax 180px, poster padding 145%, info 72px, 1px border).

test('column count matches repeat(auto-fill, minmax(180px, 1fr)) with a 20px gap', () => {
  assert.equal(gridColumns(0), 1, 'an unmeasured grid still has one column');
  assert.equal(gridColumns(179), 1);
  assert.equal(gridColumns(180), 1);
  assert.equal(gridColumns(379), 1);
  assert.equal(gridColumns(380), 2);
  assert.equal(gridColumns(800), 4);
  assert.equal(gridColumns(1000), 5);
});

test('card width shares the row across columns, gaps included', () => {
  assert.equal(cardWidth(1000, 5), 184);
  assert.equal(cardWidth(800, 4), 185);
});

test('row pitch follows the poster aspect, info strip, border and gap', () => {
  // 1000px, 5 columns: card 184px, poster 182px wide, 145% tall = 263.9px.
  assert.ok(Math.abs(rowPitch(1000, 5) - (182 * 1.45 + 72 + 2 + 20)) < 1e-9);
  // Two cards in 400px: 190px wide, 188px poster, 272.6px tall.
  assert.ok(Math.abs(rowPitch(400, 2) - (188 * 1.45 + 72 + 2 + 20)) < 1e-9);
});

test('row pitch is never negative, even before the grid is measured', () => {
  assert.ok(rowPitch(0, 1) > 0);
});

test('small collections are not virtualised', () => {
  const res = calculateVirtualWindow({
    itemCount: 8, columns: 4, rowHeight: 350, viewportHeight: 800, scrollTop: 0, gridTop: 0,
  });
  assert.equal(res.shouldVirtualize, false);
  assert.equal(res.endIndex, 8);
  assert.equal(res.paddingTop + res.paddingBottom, 0);
});

test('spacers plus mounted rows account for every row exactly once', () => {
  const pitch = rowPitch(1000, 5);
  const itemCount = 3000;
  for (const scrollTop of [0, 1500, 50000, 10_000_000]) {
    const res = calculateVirtualWindow({
      itemCount, columns: 5, rowHeight: pitch, viewportHeight: 900, scrollTop, gridTop: 120,
    });
    const mounted = (res.endRow - res.startRow) * pitch;
    assert.ok(
      Math.abs(res.paddingTop + mounted + res.paddingBottom - res.totalRows * pitch) < 1e-6,
      `scrollTop ${scrollTop}: total height must equal rows x pitch`
    );
  }
});

test('scrolled to the bottom, the last item is mounted and no bottom spacer remains', () => {
  const pitch = rowPitch(1000, 5);
  const res = calculateVirtualWindow({
    itemCount: 3000, columns: 5, rowHeight: pitch, viewportHeight: 900, scrollTop: 10_000_000, gridTop: 0,
  });
  assert.equal(res.endIndex, 3000);
  assert.equal(res.paddingBottom, 0);
});

test('a focused card stays mounted even when scrolled far away', () => {
  const res = calculateVirtualWindow({
    itemCount: 3000, columns: 5, rowHeight: rowPitch(1000, 5), viewportHeight: 900,
    scrollTop: 40_000, gridTop: 0, focusedIndex: 7,
  });
  assert.ok(res.startIndex <= 7 && 7 < res.endIndex, 'focused index is inside the window');
});

test('card keys come from the provider and the address, never the position', () => {
  const item = { name: 'Dune', url: 'https://x.test/dune', apiName: 'P' } as SearchResponse;
  assert.equal(cardKeyOf(item, 0), cardKeyOf(item, 999));
  assert.equal(cardKeyOf({ name: 'a', url: 'u' } as SearchResponse, 3), 'u');
  assert.equal(cardKeyOf({ name: 'a', url: '' } as SearchResponse, 3), 'item-3');
});
