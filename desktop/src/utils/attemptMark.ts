import type { TitleInteraction } from '../types/interactions.ts';

/**
 * The mark beside a search card's provider: what that provider answered when
 * this work was last looked for through it (PRD Phase 2, §7.6).
 *
 * Failures are always marked, as on the rest of the card (`cardState.ts`).
 * "Sources found" is not a standing badge: it is drawn only for an answer from
 * this launch, and as the quietest mark. Pure.
 */
export interface AttemptMark {
  kind: 'found' | 'empty' | 'wrong' | 'error';
  /** Short, for the accessible name. */
  label: string;
  /** A sentence for the tooltip, with the provider's own words where there are any. */
  tooltip: string;
}

export function attemptMark(
  attempt: TitleInteraction['attempt'],
  provider: string,
  launchedAt: number
): AttemptMark | null {
  if (!attempt) return null;
  const detail = attempt.detail ? ` (${attempt.detail})` : '';
  switch (attempt.outcome) {
    case 'wrong-match':
      return {
        kind: 'wrong',
        label: 'Wrong match',
        tooltip: `Last time, ${provider} answered with a different title${detail}. Other sources may still have it.`,
      };
    case 'no-sources':
      return {
        kind: 'empty',
        label: 'No sources here',
        tooltip: `Last time, ${provider} had no playable source for this${detail}.`,
      };
    case 'error':
      return {
        kind: 'error',
        label: 'Did not answer',
        tooltip: `${provider} did not answer last time${detail}. It will be asked again.`,
      };
    case 'sources':
      return attempt.at >= launchedAt
        ? { kind: 'found', label: 'Sources found', tooltip: `${provider} found sources for this.` }
        : null;
  }
}
