/**
 * The panic key: one press re-blurs every adult visual, wherever the viewer is.
 *
 * Backquote, matched by physical `code` so it is the same key on every layout
 * (`key` is `Dead` on layouts that compose with it). Nothing else in the app
 * binds it — the player's keys, Ctrl+F/K/, and F11/F12 were all checked.
 * Modified presses are left alone, and so is any text entry: a key that fires
 * while typing would eat characters.
 */
export const EMERGENCY_BLUR_KEY_LABEL = '`';

export interface EmergencyBlurEvent {
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
  /** A DOM event target, or anything shaped like one. */
  target: object | null;
}

const TEXT_ENTRY = /^(INPUT|TEXTAREA|SELECT)$/;

export function isEmergencyBlurEvent(event: EmergencyBlurEvent): boolean {
  if (event.code !== 'Backquote') return false;
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.isComposing) return false;
  const target = event.target as { tagName?: string; isContentEditable?: boolean } | null;
  if (target?.isContentEditable || TEXT_ENTRY.test(target?.tagName ?? '')) return false;
  return true;
}
