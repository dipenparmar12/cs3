import { useEffect, useState } from 'react';

/**
 * Whether the machine has a network connection, from Chromium's own signal.
 * `false` is reliable (no interface is up); `true` only means one is, not that
 * a host answers. Used to tell "this source is broken" from "the viewer is offline".
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}
