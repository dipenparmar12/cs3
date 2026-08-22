/**
 * Who gets asked when the viewer presses play.
 *
 * Pure, and separated from `ContentService` for the same reason the media
 * decision engine is separated from the transcoder: **a wrong answer here is
 * invisible.** Every combination still produces sources and still plays
 * something. What changes is how many third-party sites were contacted to get
 * there, and how long the viewer waited — so a regression reads as "the app got
 * slower again" months later, with nothing pointing at this file.
 *
 * ## What Android does, and what this restores
 *
 * On Android a search returns one row **per provider**. Opening a row binds you
 * to the provider that produced it, and pressing play calls `loadLinks` on that
 * provider alone. There is no fan-out and no torrent indexer step.
 *
 * This app merges search rows — four providers and three catalogues returning
 * one film should be one row, not seven — and that merge is worth keeping. What
 * it lost was the binding: a merged row is addressed by its catalogue URL, so
 * opening it asked *every* enabled provider and *every* enabled indexer. A
 * title carried by two providers drew answers from two hundred, most of which
 * had nothing, some of which were slow, and some of which were dead. That is
 * what "some of the sources didn't work" looks like from the inside.
 *
 * The merge stays. The binding comes back through `alternates`: the providers
 * whose results were merged into this row are exactly the ones that claimed to
 * have the title, and they are who `origin` asks.
 */
import type { SourceScope } from '../contentService.ts';

export interface ScopePlan {
  /**
   * The scope actually used, which is not always the one requested — see
   * {@link planSourceScope} for the one case where it differs.
   */
  scopeUsed: SourceScope;
  /** Whether torrent indexers are consulted at all. */
  askIndexers: boolean;
  /** Whether a fresh title search across enabled providers runs. */
  searchAllProviders: boolean;
  /** True when widening would ask something that has not been asked. */
  canWiden: boolean;
}

export interface ScopeInputs {
  /** What the caller asked for. Absent means `origin`. */
  requested?: SourceScope;
  /**
   * Provider routes already known for this title — its search alternates, plus
   * the row's own address when it is a `cs3ext://` one.
   */
  routes: readonly string[];
  /** False when there is no title to search for, which makes a fan-out useless. */
  hasTitle: boolean;
  /**
   * True when the user has narrowed the search scope to a set of providers and
   * that set is empty after resolution. Nothing can answer, so nothing is asked.
   */
  providersNarrowedToNothing: boolean;
}

/**
 * Decides the scope, and reports when it could not honour the one requested.
 *
 * The one case where `origin` is not honoured: **a title with no routes.** A row
 * opened from the home screen was never searched for, so no provider ever
 * claimed it and there is no origin to scope to. Narrowing to an empty set there
 * would return no sources for every catalogue item in the app — so it widens,
 * and `scopeUsed` says so. The alternative, reporting "the provider had
 * nothing" about a provider that was never identified, would be a lie the UI
 * would repeat.
 */
export function planSourceScope(inputs: ScopeInputs): ScopePlan {
  const requested: SourceScope = inputs.requested ?? 'origin';
  const scopeUsed: SourceScope =
    requested === 'origin' && inputs.routes.length > 0 ? 'origin' : 'all';

  return {
    scopeUsed,
    /**
     * Indexers belong to "everywhere", never to "this provider".
     *
     * Android has no equivalent step at all — a provider row plays from that
     * provider. Asking every torrent site as well is the superset, and it is
     * most of the latency: an indexer that answers in 20 seconds delays a
     * result the provider already returned in one.
     */
    askIndexers: scopeUsed === 'all',
    /**
     * At `all` scope every enabled provider is searched, **even when routes are
     * already known**.
     *
     * This is the condition that is easy to get wrong. Skipping the search
     * whenever routes exist was right while routes were the only way to reach a
     * provider, but widening exists precisely to reach the providers that did
     * *not* return this title — so skipping it makes "search everywhere" ask
     * the same two providers again and appear to do nothing. The already-known
     * providers are skipped per-result instead, which is where the duplication
     * actually needs preventing.
     */
    searchAllProviders:
      scopeUsed === 'all' && inputs.hasTitle && !inputs.providersNarrowedToNothing,
    canWiden: scopeUsed === 'origin',
  };
}
