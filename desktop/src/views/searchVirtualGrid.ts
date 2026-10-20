import type { SearchResponse } from '../types/api.ts';

/**
 * Geometry of the search result grid, derived from the same numbers the CSS
 * uses so that a row's height is known before any card is measured.
 *
 * Must match: `.search-grid` (gap 1.25rem, `repeat(auto-fill, minmax(180px, 1fr))`),
 * `.poster-card` (1px border), `.poster-container` (padding-top 145% of its
 * width) and `.poster-info` (height 72px). Change them together.
 */
export const ROW_GAP = 20; // 1.25rem
export const MIN_CARD_WIDTH = 180;
export const CARD_BORDER = 2; // 1px top and bottom
export const POSTER_ASPECT_PADDING = 1.45; // padding-top 145% of the poster width
export const POSTER_INFO_HEIGHT = 72;
export const OVERSCAN_ROWS = 2;

/** Columns `repeat(auto-fill, minmax(MIN_CARD_WIDTH, 1fr))` produces in `width` px. */
export function gridColumns(width: number): number {
  return Math.max(1, Math.floor((width + ROW_GAP) / (MIN_CARD_WIDTH + ROW_GAP)));
}

/** Width of one card border-box when `columns` cards share `width` px. */
export function cardWidth(width: number, columns: number): number {
  return Math.max(0, (width - ROW_GAP * (columns - 1)) / columns);
}

/** Vertical distance from one row's top to the next, gap included. */
export function rowPitch(width: number, columns: number): number {
  const posterWidth = Math.max(0, cardWidth(width, columns) - CARD_BORDER);
  return posterWidth * POSTER_ASPECT_PADDING + POSTER_INFO_HEIGHT + CARD_BORDER + ROW_GAP;
}

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
  /** Exact row pitch from `rowPitch`; a guess here moves every row below it. */
  rowHeight: number;
  viewportHeight: number;
  scrollTop: number;
  /** Offset of the grid's top edge inside the scroller's content. */
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
 * Rows to mount for the current scroll position, and spacers that stand in for
 * the rows above and below so the scrollbar reflects the whole result set.
 * A focused card's row is always mounted, even outside the overscan.
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

  let startRow = Math.max(0, Math.min(totalRows - 1, Math.floor(relativeTop / rowHeight) - overscanRows));
  let endRow = Math.max(startRow + 1, Math.min(totalRows, Math.ceil(relativeBottom / rowHeight) + overscanRows));

  if (focusedIndex !== undefined && focusedIndex >= 0 && focusedIndex < itemCount) {
    const focusedRow = Math.floor(focusedIndex / safeColumns);
    startRow = Math.min(startRow, focusedRow);
    endRow = Math.max(endRow, focusedRow + 1);
  }

  return {
    shouldVirtualize: true,
    totalRows,
    startRow,
    endRow,
    startIndex: startRow * safeColumns,
    endIndex: Math.min(itemCount, endRow * safeColumns),
    paddingTop: startRow * rowHeight,
    paddingBottom: Math.max(0, (totalRows - endRow) * rowHeight),
  };
}
