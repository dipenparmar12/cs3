/**
 * Which web permissions a page may have (audit 2026-10-14, finding SEC-02).
 *
 * Electron's default, with no handler registered, is to **grant every
 * permission request** — camera, microphone, geolocation, notifications,
 * screen capture — to any page in the session. That included the WebView
 * host's offscreen windows, which load third-party provider and challenge
 * pages we do not control: such a page could have opened the microphone with
 * nothing on screen to say so.
 *
 * The rule is an allowlist (§12: a capability check ends in an allowlist): the
 * app's own pages get exactly what the renderer was measured to use, and
 * everything else — every third-party page, every permission not listed — is
 * refused.
 */

/** Measured from the renderer: clipboard writes (copy link/report), HTML fullscreen (trailers), ClearKey EME. */
const APP_PERMISSIONS: ReadonlySet<string> = new Set([
  'clipboard-sanitized-write',
  'fullscreen',
  'mediaKeySystem',
]);

/**
 * Whether a URL is the app's own page: the packaged `file:` bundle, or the
 * Vite dev server in development. Matched on the parsed origin, never a prefix
 * of the string (`http://localhost:5173.evil.example` is not the dev server).
 */
export function isAppOrigin(requestingUrl: string, devServerUrl?: string): boolean {
  let url: URL;
  try {
    url = new URL(requestingUrl);
  } catch {
    return false;
  }
  if (url.protocol === 'file:') return true;
  if (!devServerUrl) return false;
  try {
    return url.origin === new URL(devServerUrl).origin;
  } catch {
    return false;
  }
}

export function appMayUse(permission: string, requestingUrl: string, devServerUrl?: string): boolean {
  return APP_PERMISSIONS.has(permission) && isAppOrigin(requestingUrl, devServerUrl);
}
