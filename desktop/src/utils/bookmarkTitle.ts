/**
 * A saved page always has something to call it by.
 *
 * A provider can return a detail page with no name (Binged did, for a series
 * page), and the page was saved with `title: ""`. In the Library that row had an
 * empty title button, and opening it drew a detail page with no title. The
 * search that found it, or failing that its address, still names it.
 */
export function titleFromAddress(address: string): string {
  let target = address;
  // `cs3ext://Provider/<encoded page address>` carries the page address encoded.
  const wrapped = /^cs3(?:ext|native|meta):\/\/[^/]+\/(.+)$/.exec(address);
  if (wrapped) {
    try {
      target = decodeURIComponent(wrapped[1]);
    } catch {
      target = wrapped[1];
    }
  }
  const path = target.replace(/[?#].*$/, '').replace(/^[a-z]+:\/\/[^/]*/i, '');
  const segment = path.split('/').filter(Boolean).pop() ?? '';
  const words = segment
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[-_+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // An id like `tt0133093` or `14064` names nothing.
  return /[a-z]{3}/i.test(words) && !/^tt\d+$/i.test(words) ? words.slice(0, 80) : '';
}

export function bookmarkTitle(bookmark: {
  title?: string;
  mediaUrl: string;
  origin?: { searchQuery?: string };
}): string {
  const own = bookmark.title?.trim();
  if (own) return own;
  const query = bookmark.origin?.searchQuery?.trim();
  if (query) return query;
  return titleFromAddress(bookmark.mediaUrl) || 'Saved page';
}
