/**
 * Which provider a search asks *first*.
 *
 * A search across a large install fans out to eight providers at a time and
 * works through the rest as lanes free up. Which eight go first was, until
 * this, whatever order the provider registry happened to hold — effectively
 * the order archives were installed in. That decides how long the screen stays
 * empty: a lane spent on a provider that will take twenty seconds to time out
 * is a lane not spent on one that answers in three hundred milliseconds, and
 * the user is watching the first screen of results either way.
 *
 * The app already measures this. `ProviderAnalytics` counts every provider's
 * success rate and latency and `ProviderRanking` turns them into an order,
 * which until now only a settings panel read. Using it here costs nothing, is
 * not a filter, and cannot change *what* a search asks — only the sequence, and
 * therefore when the first rows land.
 *
 * The guard below is the whole reason this is a module rather than one line at
 * the call site.
 */

/**
 * Applies an ordering, or refuses it.
 *
 * A ranking is scored from noisy third-party measurements and reads user
 * preferences, stored weights and a smoothing prior; it is far more machinery
 * than a search needs to trust with the question "which providers am I
 * searching". If it ever answers with a different *set* — one name missing, one
 * added, one duplicated — the search would silently ask fewer sources than the
 * user selected and report the difference as "no results", which is the single
 * worst failure this app has, arrived at through an optimisation.
 *
 * So the set is checked, and a disagreement falls back to the original order.
 * Slightly slower is a trade anyone would take; silently searching less is not.
 */
export function applySearchOrder(
  targets: string[],
  order: ((names: string[]) => string[]) | null | undefined
): string[] {
  if (!order || targets.length < 2) return targets;

  let ranked: string[];
  try {
    ranked = order([...targets]);
  } catch {
    // A ranking that throws must not take the search with it.
    return targets;
  }

  if (!Array.isArray(ranked) || ranked.length !== targets.length) return targets;

  const wanted = new Set(targets);
  const seen = new Set<string>();
  for (const name of ranked) {
    // Unknown or repeated: the two ways a same-length array can still be a
    // different set.
    if (!wanted.has(name) || seen.has(name)) return targets;
    seen.add(name);
  }

  return ranked;
}
