import { handle, } from './channel.ts';
import type { RegisterHandlers } from './services.ts';
import { BookmarkStore } from '../cs3/bookmarkStore';

/**
 * Saved detail pages.
 *
 * Moved out of `main.ts` unchanged; see `services.ts` for why the dependencies
 * are named rather than reached for.
 */
export const registerBookmarkHandlers: RegisterHandlers = (services) => {
  const {
    bookmarks,
  } = services;

  // --- saved detail pages (bookmarks) --------------------------------------------
  handle('bookmarks:list', async () => ({
    bookmarks: bookmarks.list(),
    facets: bookmarks.originFacets(),
  }));

  handle('bookmarks:get', async (mediaUrl: string) => ({
    bookmark: bookmarks.get(mediaUrl),
  }));

  /**
   * One channel for save and unsave.
   *
   * The control is a single toggle on the page and modelling it as two calls
   * invites the two to disagree — the button reads "Saved" while the store has
   * already dropped it, because one of the pair failed and the UI only checked
   * the other.
   */
  handle(
    'bookmarks:toggle',
    async (input: Parameters<BookmarkStore['toggle']>[0]) => {
      return { ...bookmarks.toggle(input) };
    },
    { saved: false, bookmark: null }
  );

  handle('bookmarks:remove', async (mediaUrl: string) => ({
    removed: bookmarks.remove(mediaUrl),
  }));

  handle('bookmarks:setNote', async (mediaUrl: string, note?: string) => ({
    bookmark: bookmarks.setNote(mediaUrl, note),
  }));

  handle('bookmarks:markOpened', async (mediaUrl: string) => {
    bookmarks.markOpened(mediaUrl);
    return {};
  });
};
