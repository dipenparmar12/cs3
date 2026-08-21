import { handle, } from './channel.ts';
import type { RegisterHandlers } from './services.ts';
import type { SourceQuery } from '../contentService';

/**
 * Warming the source cache while a detail page is being read.
 *
 * Moved out of `main.ts` unchanged; see `services.ts` for why the dependencies
 * are named rather than reached for.
 */
export const registerPrefetchHandlers: RegisterHandlers = (services) => {
  const {
    sourcePrefetcher,
  } = services;

  // --- source prefetch -----------------------------------------------------------
  /**
   * Begins looking for sources for what this page would play.
   *
   * Fire-and-forget on purpose: the caller is a detail page opening, not someone
   * waiting for an answer. Progress arrives on `sources:prefetch` and the results
   * land in the source cache, where Play finds them.
   */
  handle('sources:prefetch', (request: SourceQuery) => {
    sourcePrefetcher.schedule(request);
    return {};
  });

  handle('sources:cancelPrefetch', () => {
    sourcePrefetcher.cancel();
    return {};
  });

  handle('sources:getPrefetchSetting', () => ({ enabled: sourcePrefetcher.isEnabled() }));

  handle('sources:setPrefetchSetting', (enabled: boolean) => ({
    enabled: sourcePrefetcher.setEnabled(enabled),
  }));
};
