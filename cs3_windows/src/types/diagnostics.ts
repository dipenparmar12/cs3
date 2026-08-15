import type { FailureKind } from './analytics';

/**
 * Why a step produced nothing, in a form both the UI and the report can use.
 *
 * "The extension provider returned no playable links for this item." is a true
 * sentence about six different situations: the provider timed out, its
 * extractor threw, the host blocked it, the title exists but has no sources,
 * the links came back with no URLs in them, or the provider does not implement
 * link resolution at all. Users were shown that one sentence for all six, and
 * so was anyone trying to help them.
 *
 * The fix is not a longer message — the message should stay short. It is to
 * carry the *facts* alongside it: which provider, which address, what the host
 * said, what stage it reached. `summary` is what goes on screen; `facts` is
 * what goes on the clipboard.
 */

export type DiagnosisKind =
  | FailureKind
  /** Ran cleanly, genuinely had nothing for this title. */
  | 'no-links'
  /** Produced links, but every one was unusable before playback was attempted. */
  | 'links-unusable'
  /** Produced links that were dropped by the user's own filters. */
  | 'filtered-out';

export interface DiagnosisFact {
  label: string;
  value: string;
}

export interface SourceDiagnosis {
  kind: DiagnosisKind;
  /** One sentence, safe to show. Never a stack trace. */
  summary: string;
  /** What the user could actually do about it, when there is something. */
  hint?: string;
  provider?: string;
  /** The `cs3ext://` address or provider handle that was asked about. */
  address?: string;
  /** Where in the pipeline this happened. */
  stage: 'search' | 'detail' | 'links' | 'sources' | 'playback';
  /** Everything worth pasting into a report, already flattened. */
  facts: DiagnosisFact[];
  at: number;
}
