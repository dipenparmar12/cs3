/**
 * Drops empty keys so a merge cannot overwrite a known value with nothing.
 *
 * This is the mechanical half of the rule the saved-page work is built on: **a
 * later load may add and may correct, but may never blank.** A provider that
 * answers with a title and no poster has said nothing about the poster, and
 * spreading that answer over a stored record would read the silence as "there is
 * no poster" — which is what made a complete page degrade every time it was
 * opened.
 *
 * `undefined`, `null` and `''` all count as "said nothing". A `0` or a `false`
 * is a real answer and survives.
 *
 * Lived in `bookmarkStore` and `pageSnapshot` as byte-identical copies. They
 * merge the same provenance shape for the same reason, so a change to one that
 * missed the other would leave two stores disagreeing about when a field may be
 * cleared — silently, and only for records old enough to have been merged twice.
 */
export function prune<T extends object>(value: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, entry] of Object.entries(value) as Array<[keyof T, T[keyof T]]>) {
    if (entry !== undefined && entry !== null && entry !== '') out[key] = entry;
  }
  return out;
}
