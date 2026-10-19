import type { ExtendedMetadata } from '../types/metadata.ts';

/**
 * Which catalogue record the detail page keeps, as records arrive.
 *
 * The enrichment runs in the main process, outlives the page and emits partial
 * records as each catalogue answers — in whatever order the network allows,
 * and sometimes for a page the viewer has already left. Pure, so the order the
 * answers land in is tested rather than hoped for (`detailStability.test.mts`).
 */

/**
 * A pushed record, applied or not.
 *
 * Another page's record is ignored. A partial record never replaces a complete
 * one: a late partial emission would blank fields the final record had already
 * filled.
 */
export function acceptExtendedPush(
  current: ExtendedMetadata | null,
  incoming: ExtendedMetadata,
  pageUrl: string | null
): ExtendedMetadata | null {
  if (incoming.url !== pageUrl) return current;
  if (current && !current.partial && incoming.partial) return current;
  return incoming;
}

/**
 * Whether the record on screen is cleared before asking again.
 *
 * Only for a different page. The same page asked again — the live load
 * replacing the saved copy, a background refresh, an IMDb id arriving — keeps
 * its record until the new answer replaces it, or the page flickers every time
 * the provider answers.
 */
export function clearsExtended(recordFor: string | null, url: string): boolean {
  return recordFor !== url;
}
