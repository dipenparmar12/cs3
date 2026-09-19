/**
 * What a media card should say about a title the viewer has already met.
 *
 * Pure and tested, for the reason `deadRows.ts` and `ottPlatforms.ts` are:
 * every wrong answer here is silent, plausible, and read as a fact about the
 * film rather than as a bug in us. A card that says "no sources" about a title
 * that plays perfectly is indistinguishable, to the person looking at it, from
 * a title that genuinely has none — so they stop clicking it, and nothing ever
 * tells them otherwise.
 *
 * ## The two failure directions are not symmetric
 *
 * | Too eager | Too shy |
 * |---|---|
 * | A badge on every card the viewer ever glanced at | The dead row they clicked yesterday looks new today |
 * | Loud, and reads as clutter — recoverable, because they can see it | Invisible, and reads as the app having no memory |
 *
 * Both are real, and the resolution is that **failure is always marked and
 * success almost never is**. A tick on everything that has ever worked is
 * decoration on every card in the library; a warning on the one that did not is
 * the only mark that changes what somebody does next.
 *
 * ## Precedence, and why it is not a severity order
 *
 * States can coexist — a film can be downloaded *and* half-watched *and* have
 * failed from a different provider last week — and the card has room for one
 * corner badge. So {@link primaryBadge} ranks them by **what the viewer would do
 * about it**, not by how bad they are:
 *
 * 1. `downloading` — happening right now, and the only state that changes while
 *    they are looking at it.
 * 2. `failed` / `no-sources` — the one mark that stops a wasted click.
 * 3. `downloaded` — a copy is on disk, which changes which card they pick.
 * 4. `continue` — where they left off, which is why they came back.
 * 5. `ready` — this will start immediately.
 * 6. `watched` — finished; the quietest of the six.
 *
 * `visited` is deliberately *not* in that list. It is not a badge at all: it is
 * a dimming of the artwork, so it can be true at the same time as any of the
 * above without competing for the corner.
 */

import type { TitleInteraction } from '../types/interactions.ts';

/** One thing a card can say, in the corner. */
export const CardBadge = {
  Downloading: 'downloading',
  Downloaded: 'downloaded',
  Failed: 'failed',
  NoSources: 'no-sources',
  Continue: 'continue',
  Ready: 'ready',
  Watched: 'watched',
} as const;
export type CardBadge = (typeof CardBadge)[keyof typeof CardBadge];

/** Everything true about a card at once, before one of them is chosen. */
export interface CardState {
  /** The details page has been opened before. Dims the artwork; never a badge. */
  visited: boolean;
  /** Every state that currently applies, in precedence order. */
  badges: CardBadge[];
  /** 0–100, drawn as the bar across the bottom of the poster. */
  progressPercent?: number;
}

/**
 * How badly stale a "no sources" verdict has to be before it stops being drawn.
 *
 * `TitleOutcomeStore` already expires its rows — seven days for `no-sources`,
 * one for `app-error` — so this is not a second expiry. It is the case the
 * store cannot see: the viewer has *since* watched the thing. A title with
 * watch progress newer than the failure did play, whatever the failure said,
 * and leaving the warning up would be the app contradicting something the
 * person did themselves.
 */
function failureIsStale(interaction: TitleInteraction): boolean {
  const failedAt = interaction.outcome?.at;
  if (!failedAt) return true;
  const watchedAt = interaction.watch?.updatedAt ?? 0;
  const downloaded = interaction.download?.state === 'completed';
  return watchedAt > failedAt || downloaded;
}

/**
 * Whether a download state is worth a badge of its own.
 *
 * `paused` is deliberately absent. A paused transfer is one the viewer paused,
 * from a screen that shows it; repeating that on every card the title appears
 * on is telling them something they just did. `queued` counts as downloading —
 * from outside the queue those are one situation: it is coming.
 */
function downloadBadge(interaction: TitleInteraction): CardBadge | null {
  const download = interaction.download;
  if (!download) return null;
  if (download.state === 'downloading' || download.state === 'queued') {
    return CardBadge.Downloading;
  }
  if (download.state === 'completed') return CardBadge.Downloaded;
  return null;
}

export function cardStateFor(
  interaction: TitleInteraction | null | undefined
): CardState {
  if (!interaction) return { visited: false, badges: [] };

  const badges: CardBadge[] = [];

  const download = downloadBadge(interaction);
  if (download === CardBadge.Downloading) badges.push(download);

  /**
   * A failure is shown only while it is still the latest thing that happened.
   *
   * PRD-46 §9: "The failure indicator should represent the latest state, not a
   * permanent failure." Watching the title, or finishing a download of it, is
   * the viewer disproving the verdict — and a badge that survives that is the
   * app insisting on something the person can see is untrue.
   */
  const outcome = interaction.outcome;
  if (outcome && outcome.kind !== 'played' && !failureIsStale(interaction)) {
    badges.push(outcome.kind === 'app-error' ? CardBadge.Failed : CardBadge.NoSources);
  }

  if (download === CardBadge.Downloaded) badges.push(download);

  const watch = interaction.watch;
  // Partly watched outranks finished, and finished outranks nothing: "carry on
  // from 38 minutes" is an action, where "you have seen this" is a fact.
  if (watch && !watch.completed && watch.percent > 0) {
    badges.push(CardBadge.Continue);
  }

  /**
   * Only where nothing more specific is true.
   *
   * "Ready to play" beside "Downloaded" is two ways of saying the same thing to
   * somebody choosing what to watch, and beside "Continue" it is noise over the
   * one thing they came back for.
   */
  if (
    badges.length === 0 &&
    (interaction.sources?.ready ?? 0) > 0 &&
    !interaction.sources?.expired
  ) {
    badges.push(CardBadge.Ready);
  }

  if (watch?.completed) badges.push(CardBadge.Watched);

  return {
    visited: (interaction.visited?.count ?? 0) > 0,
    badges,
    progressPercent:
      watch && !watch.completed && watch.percent > 0 ? watch.percent : undefined,
  };
}

/** The one badge with room to be drawn, or `null` when there is nothing to say. */
export function primaryBadge(state: CardState): CardBadge | null {
  return state.badges[0] ?? null;
}

/**
 * What a badge says when someone hovers it.
 *
 * Plain language, no internal vocabulary, and a complete sentence rather than a
 * status word — PRD-47's rule applies here as much as anywhere: a card is the
 * least appropriate place in the app for a term the viewer would have to learn.
 * `reason` is the provider's own words and is appended only where it exists,
 * because "No playable source found" alone is already the whole answer for most
 * rows.
 */
export function badgeTooltip(
  badge: CardBadge,
  interaction?: TitleInteraction | null
): string {
  switch (badge) {
    case CardBadge.Downloading: {
      const percent = interaction?.download?.percent;
      return percent != null && percent > 0
        ? `Downloading — ${Math.round(percent)}%`
        : 'Download queued';
    }
    case CardBadge.Downloaded:
      return 'Downloaded — available offline';
    case CardBadge.Failed:
      return interaction?.outcome?.reason
        ? `Playback failed last time: ${interaction.outcome.reason}`
        : 'Playback failed last time';
    case CardBadge.NoSources:
      return 'No playable source found last time';
    case CardBadge.Continue: {
      const percent = interaction?.watch?.percent;
      return percent != null
        ? `Continue watching — ${Math.round(percent)}% in`
        : 'Continue watching';
    }
    case CardBadge.Ready:
      return 'Ready to play';
    case CardBadge.Watched:
      return 'Watched';
    default:
      return '';
  }
}

/** The short word on the badge itself. Kept to one or two words by design. */
export function badgeLabel(badge: CardBadge): string {
  switch (badge) {
    case CardBadge.Downloading:
      return 'Downloading';
    case CardBadge.Downloaded:
      return 'Downloaded';
    case CardBadge.Failed:
      return 'Failed';
    case CardBadge.NoSources:
      return 'No sources';
    case CardBadge.Continue:
      return 'Continue';
    case CardBadge.Ready:
      return 'Ready';
    case CardBadge.Watched:
      return 'Watched';
    default:
      return '';
  }
}

/**
 * Whether opening this title should quietly go and look for sources again.
 *
 * PRD-46 §9. The case it exists for is the one the badge creates: a viewer sees
 * "no sources", opens it anyway, and the app repeats last week's answer from a
 * cache rather than asking. So a title whose last outcome was a failure gets a
 * cache-bypassing discovery on open — once, because the point is to replace a
 * stale verdict, not to opt this title out of caching forever.
 *
 * `played` never triggers it: a title that worked does not need its sources
 * re-fetched, and doing so would spend a full fan-out across third-party sites
 * every time somebody opens something they like.
 */
export function shouldRetryOnOpen(
  interaction: TitleInteraction | null | undefined
): boolean {
  const outcome = interaction?.outcome;
  if (!outcome || outcome.kind === 'played') return false;
  return !failureIsStale(interaction as TitleInteraction);
}
