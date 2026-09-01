import type { SearchResponse } from '../types/api';

/**
 * Which search results are worth putting in front of someone.
 *
 * ## The friction
 *
 * A search across fifteen providers returns rows from all of them, and some of
 * those rows have nothing behind them — the provider listed the title, and
 * `loadLinks` resolves to no playable source. The only way to find out is to
 * open the row, wait, get an empty source list, go back, and try the next one.
 * Repeated across a page of results, that is the reported experience: try
 * provider A, go back, try provider B, go back.
 *
 * The app already knows. `TitleOutcomeStore` records what happened last time a
 * title was opened, and `PosterCard` renders a badge for it — which stops
 * someone clicking the *same* dead row twice, and does nothing about the page
 * being full of them.
 *
 * ## The rule, and the one kind that must never be hidden
 *
 * `no-sources` hides. It is a property of the source, it is stable, and it
 * expires after a week so a release that appears later is not permanently lost.
 *
 * `app-error` does **not** hide, and this is the important half. That kind
 * means *our* runtime or transport failed — a translation bug, a sidecar that
 * was not up, a proxy that dropped the request. Hiding those rows would turn
 * one bug of ours into a catalogue that silently shrinks, and the report would
 * be "the providers stopped working" from a user with no way to see that a
 * hundred titles had been filtered out on our own account. It is the same
 * reasoning that keeps `app-error` a separate outcome kind at all, and the same
 * reasoning that keeps `provider-missing` out of the provider ranking.
 *
 * `played` obviously shows. An unknown title shows: never having been opened is
 * not evidence of anything.
 *
 * ## Hidden is not gone
 *
 * The caller is handed both lists and is expected to say how many it is
 * holding back and offer them. A results page quietly shorter than the search
 * found is indistinguishable from a search that found less — which is the
 * complaint this is meant to answer, arriving from the other direction.
 */

export type TitleOutcomeKind = 'played' | 'no-sources' | 'app-error';

export interface TitleOutcomeLike {
  kind: TitleOutcomeKind;
  reason?: string;
}

export interface PartitionedResults {
  /** Rows to render. */
  visible: SearchResponse[];
  /** Rows held back because they resolved to nothing last time. */
  hidden: SearchResponse[];
}

/**
 * Splits results into what to show and what to hold back.
 *
 * `outcomes` is keyed on the row's URL, which is how `TitleOutcomeStore` keys
 * it — a `cs3ext://provider/handle` address, so the same film from two
 * providers is two rows with two independent verdicts. That is correct here:
 * one provider having nothing says nothing about the other.
 */
export function partitionDeadRows(
  items: SearchResponse[],
  outcomes: Record<string, TitleOutcomeLike | undefined>,
  options: { hideDeadRows: boolean } = { hideDeadRows: true }
): PartitionedResults {
  if (!options.hideDeadRows) return { visible: items, hidden: [] };

  const visible: SearchResponse[] = [];
  const hidden: SearchResponse[] = [];
  for (const item of items) {
    if (!item?.url) continue;
    if (outcomes[item.url]?.kind === 'no-sources') hidden.push(item);
    else visible.push(item);
  }

  /**
   * Never hide the whole page.
   *
   * A query where every result has failed before is exactly when someone needs
   * to see the list — to pick one and try anyway, or to recognise that the
   * title is the problem rather than the app. An empty page under a search that
   * reported thirty results is worse than thirty rows with badges on them.
   */
  if (visible.length === 0 && hidden.length > 0) {
    return { visible: hidden, hidden: [] };
  }

  return { visible, hidden };
}
