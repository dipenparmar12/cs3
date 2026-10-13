import type { SearchResponse } from '../types/api';

/**
 * The home row opened with "Show all", and how far it has been scrolled.
 *
 * Held by `App`, not by the grid, for `searchUiState`'s reason: opening a title
 * replaces the home screen with the detail page, so anything the grid kept for
 * itself — every page scrolled into it — would be gone when the viewer pressed
 * Back, and they would be dropped at the top of a row they had scrolled four
 * hundred posters into. Its own module so `App` holds the value without
 * importing the view.
 */
export interface HomeCategoryState {
  id: string;
  title: string;
  subtitle?: string;
  items: SearchResponse[];
  /** Items the provider has returned so far, before de-duplication: the next offset. */
  skip: number;
  /** Pages read so far, the first included. */
  page: number;
  /** Set once a page adds nothing new. */
  done: boolean;
  /** Where the home rows were scrolled to when "Show all" was pressed, for Back. */
  returnScroll: number;
}
