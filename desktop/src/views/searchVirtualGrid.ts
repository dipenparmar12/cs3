import type { SearchResponse } from '../types/api.ts';

export const ROW_GAP = 20; // 1.25rem = 20px
export const MIN_CARD_WIDTH = 180;
export const ESTIMATED_ROW_HEIGHT = 340;
export const OVERSCAN_ROWS = 2;

/**
 * Deterministic identity key for a search result card.
 * Prefers `apiName:url` so cards never remount or lose state during reorders.
 */
export function cardKeyOf(item: SearchResponse, fallbackIndex: number): string {
  if (item.apiName && item.url) return `${item.apiName}:${item.url}`;
  if (item.url) return item.url;
  return `item-${fallbackIndex}`;
}

export interface VirtualWindowParams {
  itemCount: number;
  columns: number;
  rowHeight: number;
  viewportHeight: number;
  scrollTop: number;
  gridTop: number;
  overscanRows?: number;
  focusedIndex?: number;
}

export interface VirtualWindowResult {
  shouldVirtualize: boolean;
  totalRows: number;
  startRow: number;
  endRow: number;
  startIndex: number;
  endIndex: number;
  paddingTop: number;
  paddingBottom: number;
}

/**
 * Calculates the visible row window, indices, and spacing for a virtualized grid.
 * Keeps focused cards mounted even if scrolled outside overscan bounds.
 */
export function calculateVirtualWindow({
  itemCount,
  columns,
  rowHeight,
  viewportHeight,
  scrollTop,
  gridTop,
  overscanRows = OVERSCAN_ROWS,
  focusedIndex,
}: VirtualWindowParams): VirtualWindowResult {
  const safeColumns = Math.max(1, columns);
  const totalRows = Math.ceil(itemCount / safeColumns);
  const shouldVirtualize = itemCount > safeColumns * 3;

  if (!shouldVirtualize) {
    return {
      shouldVirtualize: false,
      totalRows,
      startRow: 0,
      endRow: totalRows,
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
    const focusedRow = Math.floor(focusedIndex / safeColumns);
    startRow = Math.min(startRow, focusedRow);
    endRow = Math.max(endRow, focusedRow + 1);
  }

  const startIndex = startRow * safeColumns;
  const endIndex = Math.min(itemCount, endRow * safeColumns);
  const paddingTop = startRow * rowHeight;
  const paddingBottom = Math.max(0, (totalRows - endRow) * rowHeight);

  return {
    shouldVirtualize: true,
    totalRows,
    startRow,
    endRow,
    startIndex,
    endIndex,
    paddingTop,
    paddingBottom,
  };
}
