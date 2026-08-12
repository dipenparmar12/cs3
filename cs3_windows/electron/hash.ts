/**
 * UTIL-1: Bit-identical Java String.hashCode() implementation.
 * Computes JVM hashCode in 32-bit signed arithmetic with wraparound.
 * Used for stable content identity across Android and Desktop.
 */
export function javaHashCode(str: string): number {
  if (!str || str.length === 0) return 0;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = Math.imul(31, hash) + char | 0; // Force signed 32-bit integer overflow
  }
  return hash;
}

/**
 * Derives content identity ID matching Android ResultViewModel2.kt:376
 * url.replace(mainUrl,"").replace("/","").hashCode()
 */
export function getContentId(url: string, mainUrl: string = ''): number {
  let relativeUrl = url;
  if (mainUrl && relativeUrl.startsWith(mainUrl)) {
    relativeUrl = relativeUrl.replace(mainUrl, '');
  }
  const sanitized = relativeUrl.replace(/\//g, '');
  return javaHashCode(sanitized);
}
