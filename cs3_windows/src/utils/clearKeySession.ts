/**
 * Wires a ClearKey licence onto a `<video>` element.
 *
 * The pure half of this — reading the provider's key material and building the
 * licence — is in `clearKey.ts`, kept apart so it can be tested without a
 * browser. This half is the browser part: `MediaKeys`, the `encrypted` event,
 * and the session that answers its own licence request.
 *
 * Why this exists at all: `EME_NATIVE` has been a verdict the engine could
 * *reach* since PRD-37 and nothing ever acted on it. An encrypted stream was
 * classified correctly, handed to the element with no key attached, and failed —
 * so the classification bought an accurate log line and no playback. ClearKey is
 * the case where acting on it is enough, because the provider already sent the
 * key; there is no licence server in the loop and nothing to negotiate.
 *
 * Works for a progressive CENC MP4 assigned to `video.src`, and for hls.js,
 * which appends encrypted fragmented MP4 to Media Source Extensions — the
 * `encrypted` event fires on the element either way. It does **not** cover DASH:
 * Chromium cannot demux an `.mpd` without a JavaScript player driving MSE, and
 * this build ships none.
 */
import { clearKeyLicense } from './clearKey';

const CLEAR_KEY_SYSTEM = 'org.w3.clearkey';

/**
 * Capabilities are required — Chromium refuses a request with none — but they
 * are only used to select a key system, not to decide what will decode. Listing
 * the common CENC payloads gets the access; the actual codec support question
 * was already answered by the decision engine.
 */
const CONFIGURATION: MediaKeySystemConfiguration[] = [
  {
    initDataTypes: ['cenc', 'keyids', 'webm'],
    videoCapabilities: [
      { contentType: 'video/mp4; codecs="avc1.42E01E"' },
      { contentType: 'video/mp4; codecs="hvc1.1.6.L93.B0"' },
      { contentType: 'video/webm; codecs="vp9"' },
    ],
    audioCapabilities: [
      { contentType: 'audio/mp4; codecs="mp4a.40.2"' },
      { contentType: 'audio/webm; codecs="opus"' },
    ],
  },
];

export interface ClearKeyAttachment {
  /** Detaches the listener and clears the keys from the element. */
  release(): void;
}

/**
 * Attaches the keys, and must be awaited **before** a source is assigned.
 *
 * `setMediaKeys` is asynchronous, and an element that receives its source first
 * fires `encrypted` against no keys — which surfaces as a decode error rather
 * than as anything mentioning encryption. Same ordering rule as INV-RACE-1, for
 * the same reason: the element must not be given work it is not yet equipped
 * to do.
 */
export async function attachClearKey(
  video: HTMLVideoElement,
  clearKeys: Record<string, string>
): Promise<ClearKeyAttachment> {
  const access = await navigator.requestMediaKeySystemAccess(CLEAR_KEY_SYSTEM, CONFIGURATION);
  const mediaKeys = await access.createMediaKeys();
  await video.setMediaKeys(mediaKeys);

  const license = clearKeyLicense(clearKeys);
  const encoder = new TextEncoder();
  const sessions = new Set<MediaKeySession>();

  const onEncrypted = (event: Event) => {
    const { initDataType, initData } = event as MediaEncryptedEvent;
    if (!initData) return;

    /**
     * `temporary` rather than `persistent-license`: the key came with the link
     * and the link expires, so there is nothing worth keeping on disk — and a
     * persistent session would be one more thing to clean up when the viewer
     * moves on.
     */
    const session = mediaKeys.createSession('temporary');
    sessions.add(session);

    session.addEventListener('message', () => {
      /**
       * The licence request is answered locally and its contents are ignored.
       *
       * A ClearKey `message` is a list of the key ids the CDM wants. Since the
       * whole key set is already here, replying with all of it is both correct
       * and simpler than matching ids — and it means a stream that reports its
       * key id in a different encoding than the provider used still plays.
       */
      void session.update(encoder.encode(license)).catch(() => {
        // A rejected licence leaves the element to fail on its own, which the
        // player's failover ladder already handles. Throwing from an event
        // listener would only produce an unhandled rejection.
      });
    });

    void session.generateRequest(initDataType, initData).catch(() => {
      // Same: the element reports the failure through its own error path.
    });
  };

  video.addEventListener('encrypted', onEncrypted);

  return {
    release() {
      video.removeEventListener('encrypted', onEncrypted);
      for (const session of sessions) void session.close().catch(() => {});
      sessions.clear();
      void video.setMediaKeys(null).catch(() => {});
    },
  };
}
