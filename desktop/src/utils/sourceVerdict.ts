import type { ProbeFailure } from '../types/media';

/**
 * Why a source was left, as one of the Content Validation PRD's §7.2 states,
 * so its row in the source list says more than "did not play".
 *
 * Identity and playability are separate axes there; a row needs only the one
 * that ruled it out. `unplayable` is the honest default: the element or the
 * conversion failed and nothing says why. Pure.
 */
export type SourceVerdict =
  /** It played, and it was not the title (an advert, a notice). */
  | 'confirmed-mismatch'
  /** A sign-in or an app update stood in the way. */
  | 'restricted'
  /** A rate limit, or a swarm with nobody in it right now. */
  | 'temporarily-unavailable'
  /** Gone, or a web page where media was expected. */
  | 'invalid'
  | 'unplayable';

const VERDICTS: readonly SourceVerdict[] = [
  'confirmed-mismatch',
  'restricted',
  'temporarily-unavailable',
  'invalid',
  'unplayable',
];

/** What crossed the IPC boundary is one of these, or nothing. */
export function asSourceVerdict(value: unknown): SourceVerdict | undefined {
  return VERDICTS.includes(value as SourceVerdict) ? (value as SourceVerdict) : undefined;
}

/** What the probe found, as the row's verdict. */
export function verdictForProbeFailure(failure: ProbeFailure): SourceVerdict {
  switch (failure.kind) {
    case 'login':
    case 'update-required':
      return 'restricted';
    case 'rate-limited':
      return 'temporarily-unavailable';
    case 'html':
      return 'invalid';
  }
  return failure.dead ? 'invalid' : 'unplayable';
}

/** The few words on the row. */
export function verdictLabel(verdict: SourceVerdict | undefined): string {
  switch (verdict) {
    case 'confirmed-mismatch':
      return 'Not the title';
    case 'restricted':
      return 'Needs sign-in or an app update';
    case 'temporarily-unavailable':
      return 'Unavailable for now';
    case 'invalid':
      return 'Link does not work';
    default:
      return 'Did not play';
  }
}
