import React, { useEffect, useState } from 'react';

/**
 * Artwork that degrades to something, instead of to a broken-image glyph.
 *
 * `PosterCard` already handled a *missing* `posterUrl` — the lettered
 * placeholder below is its own — and had no `onError`, so it handled the case
 * that almost never happens and not the one that happens constantly. Poster URLs
 * in this app come from community scrapers pointing at third-party CDNs: they
 * expire, they 403 on hotlink checks, and they go away when a host does. The
 * result was Chromium's broken-image icon inside the most-repeated card in the
 * product — on the home rows, the search results and the library.
 *
 * `HistoryView` had noticed and answered it with `style.display = 'none'`, which
 * swaps a broken icon for an empty bordered box. That is not better; it just
 * fails more quietly.
 *
 * The initial is deliberate rather than a generic film glyph: in a grid where
 * several posters are missing, a row of identical icons is unreadable, and the
 * first letter still tells you which card is which.
 */
interface PosterProps {
  src?: string | null;
  /** Alt text, and the source of the letter in the default placeholder. */
  title: string;
  className?: string;
  /** Decorative artwork beside its own label takes an empty alt. */
  decorative?: boolean;
  loading?: 'lazy' | 'eager';
  /**
   * What to draw instead of the image.
   *
   * Each call site keeps its own — an episode row shows the episode number, the
   * detail hero shows a shaped placeholder — because they are sized and styled
   * differently and flattening them to one glyph would be a worse screen, not a
   * tidier one. Omitted, it falls back to the title's initial.
   */
  fallback?: React.ReactNode;
}

export const Poster: React.FC<PosterProps> = ({
  src,
  title,
  className,
  decorative = false,
  loading = 'lazy',
  fallback,
}) => {
  const [failed, setFailed] = useState(false);

  // A recycled card — a grid re-rendering with new data — must not inherit the
  // previous item's failure, or one dead poster poisons that slot for the
  // rest of the session.
  useEffect(() => setFailed(false), [src]);

  if (!src || failed) {
    if (fallback !== undefined) return <>{fallback}</>;
    const initial = title.trim().charAt(0).toUpperCase() || '?';
    return (
      <div className={`poster-image--empty${className ? ` ${className}` : ''}`} aria-hidden="true">
        {initial}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={decorative ? '' : title}
      className={className}
      loading={loading}
      onError={() => setFailed(true)}
    />
  );
};
