import { useEffect, useState, type RefObject } from 'react';
import { ChevronUp } from 'lucide-react';

/**
 * One viewport-height of travel: far enough that the top of the page is out
 * of sight, short enough that it appears long before the bottom of a grid.
 * Shared by every screen because the button is mounted once, on `<main>`.
 */
export const SCROLL_TO_TOP_THRESHOLD = 0.75;

/**
 * Returns the app's primary scroll container to the top. It is handed the
 * container rather than finding one, because `body` never scrolls here and a
 * nested list (a rail, a source panel) is never the thing the viewer means.
 */
export function ScrollToTop({ target, hidden = false }: {
  target: RefObject<HTMLElement | null>;
  hidden?: boolean;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = target.current;
    if (!el) return;
    let frame = 0;
    const check = () => {
      frame = 0;
      setVisible(el.scrollTop > el.clientHeight * SCROLL_TO_TOP_THRESHOLD);
    };
    // Coalesced to one read per frame — scroll fires far more often than paint.
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(check); };
    el.addEventListener('scroll', onScroll, { passive: true });
    check();
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [target]);

  if (hidden || !visible) return null;

  const reduceMotion = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  return (
    <button
      type="button"
      className="scroll-to-top"
      aria-label="Scroll to top"
      title="Scroll to top"
      onClick={() => target.current?.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' })}
    >
      <ChevronUp size={18} aria-hidden="true" />
    </button>
  );
}
