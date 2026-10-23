import { useEffect, useState } from 'react';
import type { AppUpdateState } from '../../electron/appUpdate/appUpdateService';

/**
 * The app-update state as main pushes it (`appUpdate:changed`), for the notice
 * and the Settings rows. Whole state every time, so both always agree.
 */
export function useAppUpdate(): AppUpdateState | null {
  const [state, setState] = useState<AppUpdateState | null>(null);
  useEffect(() => {
    let live = true;
    void window.cloudstream?.getAppUpdateState?.().then((next) => {
      if (live && next) setState(next);
    });
    const dispose = window.cloudstream?.onAppUpdateChanged?.((next) => setState(next));
    return () => {
      live = false;
      dispose?.();
    };
  }, []);
  return state;
}
