import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A transient message that clears itself, written once instead of twenty times.
 *
 * Twenty-odd call sites had this shape:
 *
 * ```ts
 * const flash = (message: string) => {
 *   setToast(message);
 *   setTimeout(() => setToast(null), 5000);   // never cleared
 * };
 * ```
 *
 * Two bugs come out of it, and the second is the one users actually hit.
 *
 * **The timers accumulate and cross.** Flash a message, then flash another one
 * two seconds later: the first message's timer is still armed and fires against
 * the *current* message, so the second one vanishes three seconds early. It
 * reads as the app dropping a confirmation, and it happens exactly when a user
 * is doing several things quickly — bookmarking a title, then saving a source.
 *
 * **And every one sets state after unmount.** These views are swapped out
 * constantly (the detail page replaces the search results in place), so a
 * pending timer routinely outlives the component that armed it.
 *
 * Durations are per call site and are deliberately not unified here. They range
 * from 1500 ms for a copy confirmation to 5000 ms for a sentence someone has to
 * read, and collapsing them to one number would change what several screens do
 * — the same argument the six byte formatters in `utils/format.ts` won.
 */
export function useFlash<T = string>(defaultMs = 4000) {
  const [message, setMessage] = useState<T | null>(null);
  const timer = useRef<number | null>(null);

  const clear = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const flash = useCallback(
    (next: T, ms = defaultMs) => {
      clear();
      setMessage(next);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        setMessage(null);
      }, ms);
    },
    [clear, defaultMs]
  );

  /** Take the message down now — for a dialog closing, or a retry starting. */
  const dismiss = useCallback(() => {
    clear();
    setMessage(null);
  }, [clear]);

  useEffect(() => clear, [clear]);

  return { message, flash, dismiss } as const;
}
