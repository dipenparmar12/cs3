/**
 * The verification offers hiding inside a set of indexer outcomes.
 *
 * Separate from the component only because a file that exports both a component
 * and a helper breaks React fast refresh — the helper itself belongs beside the
 * thing that renders it.
 */

export interface VerificationRequest {
  scopeId: string;
  scopeName: string;
  url: string;
  intervention: string;
  reason: string;
}

export function verificationRequests(
  outcomes: Array<{ verification?: VerificationRequest }> | undefined
): VerificationRequest[] {
  if (!outcomes) return [];
  const seen = new Set<string>();
  const out: VerificationRequest[] = [];
  for (const outcome of outcomes) {
    if (!outcome.verification) continue;
    // Several indexers can share one site scope; the user verifies once.
    if (seen.has(outcome.verification.scopeId)) continue;
    seen.add(outcome.verification.scopeId);
    out.push(outcome.verification);
  }
  return out;
}
