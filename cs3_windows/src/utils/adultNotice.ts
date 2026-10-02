/**
 * Whether the viewer has confirmed, this launch, that they want to see adult
 * catalogues.
 *
 * Module state and nothing else, on purpose: it is never persisted, so closing
 * and reopening the app asks again — the same rule as the adult gate's session
 * unlock. One confirmation covers every adult catalogue until the app restarts.
 */
let acknowledged = false;

export function isAdultAcknowledged(): boolean {
  return acknowledged;
}

export function acknowledgeAdult(): void {
  acknowledged = true;
}
