import type { FailureKind } from '../../../src/types/analytics';
import type { Owner, Reason, Stage } from './schema.ts';

/**
 * Whose problem a failed or inconclusive stage is (Provider Compatibility
 * Audit PRD §8). The cause comes from the app's own taxonomy
 * (`failureTaxonomy.classifyFailure`); this decides the owner, because the
 * same cause means different things at different stages: a 404 from the site's
 * front page is the site's, from a provider's link the extractor's.
 *
 * The order of the rules is the table's order and matters: a runtime class
 * error is ours wherever it appears, and an audit that could not tell is
 * never charged to the provider. Pure.
 */
export interface AttributionInput {
  stage: Stage;
  cause?: FailureKind;
  reason?: Reason;
  /** S2 said the site itself answers (so a later failure is not the site's). */
  siteAlive?: boolean;
  /** S7 reached the source and it was valid media, but S8/S9 mishandled it. */
  sourceValid?: boolean;
}

const HOST_REASONS: ReadonlySet<Reason> = new Set<Reason>(['needs-webview', 'challenge', 'host-capability-absent']);
const ENVIRONMENT_REASONS: ReadonlySet<Reason> = new Set<Reason>(['geo-blocked', 'network-flaky']);
const ENVIRONMENT_CAUSES: ReadonlySet<FailureKind> = new Set<FailureKind>(['network', 'timeout']);
const RUNTIME_CAUSES: ReadonlySet<FailureKind> = new Set<FailureKind>(['runtime-unavailable', 'unsupported-operation']);
const SITE_CAUSES: ReadonlySet<FailureKind> = new Set<FailureKind>(['not-found', 'server-error', 'network', 'blocked']);

export function attribute(input: AttributionInput): Owner {
  if (input.cause && RUNTIME_CAUSES.has(input.cause)) return 'runtime';
  if (input.stage === 'S1') return 'runtime';
  if (input.reason && HOST_REASONS.has(input.reason)) return 'app-host';
  if (input.reason && ENVIRONMENT_REASONS.has(input.reason)) return 'environment';
  if (input.reason) return 'inconclusive-audit';
  if (input.stage === 'S2' && (!input.cause || SITE_CAUSES.has(input.cause))) return 'site';
  if ((input.stage === 'S8' || input.stage === 'S9' || input.stage === 'S10') && input.sourceValid) return 'app-media';
  if (input.cause && ENVIRONMENT_CAUSES.has(input.cause) && !input.siteAlive) return 'environment';
  return 'provider-plugin';
}
