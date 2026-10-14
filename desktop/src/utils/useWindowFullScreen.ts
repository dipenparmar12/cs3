import { useCallback, useEffect, useState } from 'react';

/**
 * The window's fullscreen, as the renderer sees it — the app's only fullscreen.
 *
 * One module-level copy fed by one subscription, so the player's button, the
 * Escape handling and the app shell can never disagree about whether the screen
 * is fullscreen (they did, when the player used the HTML Fullscreen API and the
 * window had its own). Every transition arrives through
 * `window:fullScreenChanged`, including F11 and the View menu.
 */
let current = false;
const listeners = new Set<(value: boolean) => void>();
let subscribed = false;

function ensureSubscribed(): void {
  if (subscribed || !window.cloudstream?.onWindowFullScreenChanged) return;
  subscribed = true;
  window.cloudstream.onWindowFullScreenChanged((value) => publish(Boolean(value)));
  void window.cloudstream.getWindowFullScreen?.().then((response) => {
    if (response?.ok) publish(response.fullScreen);
  });
}

function publish(value: boolean): void {
  if (value === current) return;
  current = value;
  for (const listener of listeners) listener(value);
}

/** Asks for a change; the state follows when the window reports it. */
export function setWindowFullScreen(value: boolean): void {
  void window.cloudstream?.setWindowFullScreen?.(value);
}

export function isWindowFullScreen(): boolean {
  return current;
}

export function useWindowFullScreen(): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(current);
  useEffect(() => {
    ensureSubscribed();
    listeners.add(setValue);
    setValue(current);
    return () => {
      listeners.delete(setValue);
    };
  }, []);
  const set = useCallback((next: boolean) => setWindowFullScreen(next), []);
  return [value, set];
}
