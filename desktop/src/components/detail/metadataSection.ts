import type { ExtendedMetadata } from '../../types/metadata.ts';
import { hasAnything, stillLoading } from '../../utils/metadataDisplay.ts';

/**
 * What the extended-metadata section should draw right now.
 *
 * A plain `.ts` beside the component rather than logic inside it, for the
 * reason `settingsLevel.ts` and `deadRows.ts` are: Node's type-stripping loader
 * cannot load JSX, so a rule that lives in the `.tsx` cannot be tested — and
 * this rule's failure modes are all silent.
 *
 * Four outcomes, and every pair of them is a mistake somebody would report as a
 * different bug:
 *
 * | | drawn | the failure if this is wrong |
 * |---|---|---|
 * | `looking` | one line saying the catalogues are being asked | a blank page for up to 11s with nothing explaining it — the report this was built from |
 * | `fallback` | the provider's flat `actors` list | the page loses names it already had |
 * | `content` | everything found | — |
 * | `nothing` | nothing at all | an empty "Cast" heading on a title no catalogue has ever heard of, permanently |
 *
 * The ordering matters and is not arbitrary. `fallback` outranks `looking`
 * because names already on screen beat a sentence about a lookup; `looking`
 * outranks `nothing` because an absence during a fetch is not an answer.
 */
export type MetadataSectionState = 'looking' | 'fallback' | 'content' | 'nothing';

export interface MetadataSectionInput {
  metadata: ExtendedMetadata | null | undefined;
  /** The provider's own `LoadResponse.actors`. */
  fallbackActors?: string[];
  /**
   * The caller's lookup is running.
   *
   * Distinct from the record's own `partial`, and both are needed. `partial`
   * only exists once a record does, and for a page whose provider published no
   * IMDb id the lookup begins by resolving one from the title — so the longest
   * part of the wait happens while there is nothing to read a flag off.
   */
  pending?: boolean;
}

/** True while an answer is still expected, from either source of that fact. */
export function isLookingUp(input: MetadataSectionInput): boolean {
  return Boolean(input.pending) || stillLoading(input.metadata);
}

export function metadataSectionState(input: MetadataSectionInput): MetadataSectionState {
  if (hasAnything(input.metadata)) return 'content';
  if ((input.fallbackActors?.length ?? 0) > 0) return 'fallback';
  return isLookingUp(input) ? 'looking' : 'nothing';
}

/**
 * Whether the status line belongs on screen.
 *
 * Shown in three of the four states — including `content`, because sources land
 * one at a time and a table about to grow should say so, and including
 * `fallback`, because the flat names are about to gain faces and characters.
 * Never in `nothing`: there, the lookup has settled and a spinner that outlives
 * its request is worse than no spinner.
 */
export function shouldShowStatus(input: MetadataSectionInput): boolean {
  return metadataSectionState(input) !== 'nothing' && isLookingUp(input);
}
