import { parseExtensionUrl } from '../../electron/cs3/extensionAddress.ts';

/**
 * Where a title came from, when the screen opening it does not know.
 *
 * Library, Continue watching and History rows used to open the detail page
 * with `apiName: 'Library'` (or 'Continue watching'), and the page dutifully
 * printed that as the provider — the one origin the viewer already knew and
 * the only one that cannot be searched again. A `cs3ext://` address names its
 * provider in its own first segment, so that is read instead; anything else
 * falls back to the caller's label, which the detail page then treats as "no
 * provider known" (see {@link isPlaceholderOrigin}).
 */
export function providerFromAddress(url: string | undefined): string | undefined {
  if (!url) return undefined;
  return parseExtensionUrl(url)?.provider || undefined;
}

/** Screen names that were passed as a provider and must never be shown as one. */
const PLACEHOLDER_ORIGINS = new Set([
  'library',
  'continue watching',
  'saved',
  'history',
  'downloads',
  'bookmark',
]);

export function isPlaceholderOrigin(name: string | undefined): boolean {
  return !name || PLACEHOLDER_ORIGINS.has(name.trim().toLowerCase());
}

/** The provider to name for an item: its own, or the one its address carries. */
export function originNameFor(apiName: string | undefined, url: string | undefined): string | undefined {
  if (!isPlaceholderOrigin(apiName)) return apiName;
  return providerFromAddress(url);
}
