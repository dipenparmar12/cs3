/**
 * ClearKey, as key material rather than as a policy.
 *
 * A ClearKey stream is encrypted with a key the provider has already given us.
 * That makes it the one DRM system on this platform that is genuinely playable:
 * Widevine and PlayReady need a CDM this app does not ship, but ClearKey's whole
 * design is that the licence *is* the key, so the renderer can answer its own
 * licence request without a server and FFmpeg can decrypt the same stream with
 * `-decryption_keys`.
 *
 * Pure and DOM-free on purpose, in two directions:
 *
 * - the renderer wires it to `MediaKeys`, which needs **base64url**;
 * - the transcoder passes it to FFmpeg, which needs **hex**;
 *
 * and getting either encoding wrong produces a stream that decrypts to noise
 * rather than an error, which is indistinguishable from a corrupt download. So
 * the conversions live here, together, where they can be tested against each
 * other.
 */
import type { ProviderDrm } from '../types/api';

/** 16 bytes: the size of a CENC key and of a key id. */
const KEY_BYTES = 16;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  // `btoa` in the renderer, `Buffer` under Node — this module is imported by
  // both, and a test that cannot run is not a test.
  const base64 =
    typeof btoa === 'function'
      ? btoa(binary)
      : Buffer.from(bytes).toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(value: string): Uint8Array | null {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  try {
    const binary =
      typeof atob === 'function'
        ? atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='))
        : Buffer.from(padded, 'base64').toString('binary');
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function hexToBytes(value: string): Uint8Array | null {
  if (value.length % 2 !== 0) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const byte = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) return null;
    bytes[i] = byte;
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Reads one key or key id in whichever encoding the provider used.
 *
 * Both are in the corpus and neither is labelled, so the two are told apart by
 * **length**, which is unambiguous where the character set is not: 16 bytes is
 * 32 hex characters or 22 base64url characters, and a 32-character string of
 * `[0-9a-f]` is also perfectly valid base64url. Reading such a string as base64
 * yields 24 bytes of the wrong key, and the stream decrypts to noise — a failure
 * that looks exactly like a bad download and is why this is decided on length
 * rather than on the alphabet.
 *
 * Returns base64url without padding, which is what EME wants.
 */
export function normalizeKeyMaterial(value: string | undefined): string | null {
  const trimmed = value?.trim().replace(/^0x/i, '');
  if (!trimmed) return null;

  if (trimmed.length === KEY_BYTES * 2 && /^[0-9a-f]+$/i.test(trimmed)) {
    const bytes = hexToBytes(trimmed);
    return bytes ? bytesToBase64Url(bytes) : null;
  }

  // Some providers write the key id in the hyphenated UUID form CENC uses.
  const dehyphenated = trimmed.replace(/-/g, '');
  if (
    trimmed.includes('-') &&
    dehyphenated.length === KEY_BYTES * 2 &&
    /^[0-9a-f]+$/i.test(dehyphenated)
  ) {
    const bytes = hexToBytes(dehyphenated);
    return bytes ? bytesToBase64Url(bytes) : null;
  }

  if (!/^[A-Za-z0-9+/\-_]+={0,2}$/.test(trimmed)) return null;
  const bytes = base64UrlToBytes(trimmed);
  if (!bytes || bytes.length !== KEY_BYTES) return null;
  return bytesToBase64Url(bytes);
}

/** The same value as FFmpeg's `-decryption_keys` takes it: lowercase hex. */
export function keyMaterialToHex(base64Url: string): string | null {
  const bytes = base64UrlToBytes(base64Url);
  return bytes && bytes.length === KEY_BYTES ? bytesToHex(bytes) : null;
}

/**
 * The key id / key pairs a provider declared, or nothing.
 *
 * Nothing is the important case rather than an edge case: a `DrmExtractorLink`
 * that names only a licence URL is a Widevine-style stream wearing the ClearKey
 * default UUID, and inventing an empty key set for it would claim we can play
 * something we cannot.
 */
export function clearKeysFromProvider(drm: ProviderDrm | undefined): Record<string, string> | null {
  if (!drm) return null;
  const kid = normalizeKeyMaterial(drm.kid);
  const key = normalizeKeyMaterial(drm.key);
  if (!kid || !key) return null;
  return { [kid]: key };
}

/** The same pairs in hex, for FFmpeg. Pairs that will not convert are dropped. */
export function clearKeysToHex(clearKeys: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [kid, key] of Object.entries(clearKeys)) {
    const hexKid = keyMaterialToHex(kid);
    const hexKey = keyMaterialToHex(key);
    if (hexKid && hexKey) out[hexKid] = hexKey;
  }
  return out;
}

/**
 * The licence response, built locally.
 *
 * A ClearKey licence is a JWK Set (RFC 7517) and the CDM asks for it through the
 * same `message` event a Widevine CDM uses to reach a licence server. Since the
 * keys are already here, the "server" is this function — which is the whole
 * reason ClearKey works offline and Widevine does not.
 */
export function clearKeyLicense(clearKeys: Record<string, string>): string {
  return JSON.stringify({
    keys: Object.entries(clearKeys).map(([kid, k]) => ({ kty: 'oct', kid, k })),
    type: 'temporary',
  });
}
