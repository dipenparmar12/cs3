import { useCallback, useEffect, useState } from 'react';

/** Datastore key: the prominent card was put away. Survives restarts and updates. */
export const SUPPORT_CARD_DISMISSED_KEY = 'support_card_dismissed';

/**
 * Whether the prominent card is hidden, and the two ways to change that.
 *
 * `null` until the stored answer arrives, so a dismissed card does not flash
 * on screen for one frame every time Settings opens.
 */
export function useSupportCardDismissed(): {
  dismissed: boolean | null;
  dismiss: () => void;
  restore: () => void;
} {
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.resolve(window.cloudstream?.getSetting(SUPPORT_CARD_DISMISSED_KEY, 'false'))
      .then((value) => {
        if (live) setDismissed(value === 'true');
      })
      .catch(() => {
        if (live) setDismissed(false);
      });
    return () => {
      live = false;
    };
  }, []);
  const store = useCallback((value: boolean) => {
    setDismissed(value);
    void window.cloudstream?.setSetting(SUPPORT_CARD_DISMISSED_KEY, value);
  }, []);
  return { dismissed, dismiss: () => store(true), restore: () => store(false) };
}
