import { useEffect, useState } from 'react';
import type { PrivacyState } from '../../electron/cs3/privacyMode';

/**
 * Incognito as the renderer sees it. One module-level subscription shared by
 * every caller, and display only: enforcement is in the main process at write
 * time, so a stale copy here can mislabel the UI but never leak a write.
 */
let state: PrivacyState | null = null;
const listeners = new Set<(s: PrivacyState) => void>();
let started = false;

function start() {
  if (started) return;
  started = true;
  const api = window.cloudstream;
  if (!api?.getPrivacyState) return;
  const publish = (next: PrivacyState) => {
    state = next;
    listeners.forEach((l) => l(next));
  };
  void api.getPrivacyState().then(publish).catch(() => {});
  api.onPrivacyChanged(publish);
}

export function usePrivacy(): {
  active: boolean;
  state: PrivacyState | null;
  setActive: (active: boolean) => void;
} {
  const [current, setCurrent] = useState<PrivacyState | null>(state);
  useEffect(() => {
    start();
    listeners.add(setCurrent);
    if (state) setCurrent(state);
    return () => {
      listeners.delete(setCurrent);
    };
  }, []);
  return {
    active: current?.active ?? false,
    state: current,
    setActive: (active) => void window.cloudstream?.setIncognito(active),
  };
}
