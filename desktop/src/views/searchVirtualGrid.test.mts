import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SearchResponse } from '../types/api.ts';

// Pure logic mirror for testing the virtual calculations
function cardKeyOf(item: SearchResponse, fallbackIndex: number): string {
  if (item.apiName && item.url) return `${item.apiName}:${item.url}`;
  if (item.url) return item.url;
  return `item-${fallbackIndex}`;
}

function calculateVirtualWindow({
  itemCount,
  columns,
  rowHeight,
  viewportHeight,
  scrollTop,
  gridTop,
  overscanRows = 2,
  focusedIndex,
}: {
  itemCount: number;
  columns: number;
  rowHeight: number;
  viewportHeight: number;
  scrollTop: number;
  gridTop: number;
  overscanRows?: number;
  focusedIndex?: number;
}) {
  const totalRows = Math.ceil(itemCount / columns);
  const shouldVirtualize = itemCount > columns * 3;

  if (!shouldVirtualize) {
    return {
      shouldVirtualize: false,
      startIndex: 0,
      endIndex: itemCount,
      paddingTop: 0,
      paddingBottom: 0,
    };
  }

  const relativeTop = Math.max(0, scrollTop - gridTop);
  const relativeBottom = relativeTop + viewportHeight;

  let startRow = Math.max(0, Math.floor(relativeTop / rowHeight) - overscanRows);
  let endRow = Math.min(totalRows, Math.ceil(relativeBottom / rowHeight) + overscanRows);

  if (focusedIndex !== undefined && focusedIndex >= 0 && focusedIndex < itemCount) {
    const focusedRow = Math.floor(focusedIndex / columns);
    startRow = Math.min(startRow, focusedRow);
    endRow = Math.max(endRow, focusedRow + 1);
  }

  const startIndex = startRow * columns;
  const endIndex = Math.min(itemCount, endRow * columns);
  const paddingTop = startRow * rowHeight;
  const paddingBottom = Math.max(0, (totalRows - endRow) * rowHeight);

  return {
    shouldVirtualize: true,
    startRow,
    endRow,
    startIndex,
    endIndex,
    paddingTop,
    paddingBottom,
  };
}

test('cardKeyOf generates stable deterministic identities', () => {
  const itemWithApi: SearchResponse = {
    name: 'Dune',
    url: 'https://example.com/dune',
    apiName: 'SuperProvider',
  };
  assert.equal(cardKeyOf(itemWithApi, 0), 'SuperProvider:https://example.com/dune');
  assert.equal(cardKeyOf(itemWithApi, 42), 'SuperProvider:https://example.com/dune');

  const itemUrlOnly: SearchResponse = {
    name: 'Avatar',
    url: 'https://example.com/avatar',
    apiName: '',
  };
  assert.equal(cardKeyOf(itemUrlOnly, 10), 'https://example.com/avatar');

  const fallbackItem: SearchResponse = {
    name: 'Untitled',
    url: '',
    apiName: '',
  };
  assert.equal(cardKeyOf(fallbackItem, 5), 'item-5');
});

test('calculateVirtualWindow leaves small collections unvirtualized', () => {
  const res = calculateVirtualWindow({
    itemCount: 8,
    columns: 4,
    rowHeight: 340,
    viewportHeight: 800,
    scrollTop: 0,
    gridTop: 100,
  });

  assert.equal(res.shouldVirtualize, false);
  assert.equal(res.startIndex, 0);
  assert.equal(res.endIndex, 8);
  assert.equal(res.paddingTop, 0);
  assert.equal(res.paddingBottom, 0);
});

test('calculateVirtualWindow windows large collections and preserves total height', () => {
  const itemCount = 2000;
  const columns = 5;
  const rowHeight = 340;
  const totalRows = Math.ceil(itemCount / columns); // 400 rows
  const totalHeight = totalRows * rowHeight; // 136,000 px

  // User scrolled down to 10,000px
  const res = calculateVirtualWindow({
    itemCount,
    columns,
    rowHeight,
    viewportHeight: 800,
    scrollTop: 10000,
    gridTop: 0,
    overscanRows: 2,
  });

  assert.equal(res.shouldVirtualize, true);
  // ~10,000 / 340 = row 29.4 -> floor is 29. Overscan 2 -> startRow = 27
  assert.equal(res.startRow, 27);
  // Mounted cards count: (endRow - startRow) * columns
  const mountedCards = (res.endRow! - res.startRow!) * columns;
  assert.ok(mountedCards < 50, `Mounted cards should be small (<50), was ${mountedCards}`);

  // Total height check: paddingTop + (renderedRows * rowHeight) + paddingBottom == totalHeight
  const renderedHeight = (res.endRow! - res.startRow!) * rowHeight;
  assert.equal(res.paddingTop + renderedHeight + res.paddingBottom, totalHeight);
});

test('calculateVirtualWindow keeps focused card mounted even when outside overscan', () => {
  const itemCount = 500;
  const columns = 5;
  const rowHeight = 340;

  // Viewport at row 20..26, but focus is at item 2 (row 0)
  const res = calculateVirtualWindow({
    itemCount,
    columns,
    rowHeight,
    viewportHeight: 800,
    scrollTop: 7000,
    gridTop: 0,
    overscanRows: 2,
    focusedIndex: 2, // Row 0
  });

  assert.equal(res.shouldVirtualize, true);
  assert.equal(res.startRow, 0, 'startRow expanded to include focused item at row 0');
  assert.ok(res.startIndex <= 2 && res.endIndex > 2, 'Item 2 is included in rendered range');
});
