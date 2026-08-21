/**
 * What an Android provider actually handed back, read without guessing.
 *
 * Every field here crosses the sidecar boundary as JSON produced by
 * `ProviderBridge.encodeLink`, and every one of them used to be discarded or
 * re-derived from the URL string. The re-derivation is the part worth naming:
 * the previous mapper decided HLS by matching `.m3u8`, `/hls/` and
 * `?format=m3u8` against the address, and DASH the same way. That is wrong in
 * both directions — providers routinely serve playlists from `.php` addresses
 * with no extension at all, and a progressive MP4 sitting behind a path
 * containing the word `dash` is not a manifest — and it was being done while the
 * provider's own answer sat unread in the reply.
 *
 * On Android that answer is what picks the `MediaSource` factory, so it is not
 * advisory: where a provider leaves `ExtractorLinkType` unset, upstream's
 * `INFER_TYPE` fills it in before the link is ever emitted. By the time it
 * reaches this file it is the best classification in existence for that URL.
 *
 * Pure and separately testable on purpose. The classification decides whether a
 * stream goes to the torrent engine, the DASH remuxer, the EME path or straight
 * to the media element, and each wrong answer fails in a way that looks like a
 * bad provider rather than a bad decision.
 */
import { clearKeysFromProvider } from '../../src/utils/clearKey.ts';
import type {
  ExtractorLink,
  ProviderAudioTrack,
  ProviderDrm,
  ProviderLinkType,
  ProviderPlaylistPart,
} from '../../src/types/api';
import type { DrmConfiguration } from '../../src/types/media';

const LINK_TYPES: ProviderLinkType[] = ['VIDEO', 'M3U8', 'DASH', 'TORRENT', 'MAGNET'];

const DRM_SCHEMES: ProviderDrm['scheme'][] = ['clearkey', 'widevine', 'playready', 'unknown'];

/**
 * The URL heuristics, kept as a *fallback* rather than deleted.
 *
 * An older `.cs3` compiled against a library predating `ExtractorLinkType` sends
 * `type: "VIDEO"` for everything, and for those the address is all there is. The
 * ordering is what changed: the provider is asked first and only silence falls
 * through to here.
 */
function looksLikeHls(url: string): boolean {
  return (
    /\.(m3u8|m3u)(\?|$)/i.test(url) ||
    /\/(getm3u8|m3u8|hls)\b/i.test(url) ||
    /[?&]format=m3u8/i.test(url)
  );
}

function looksLikeDash(url: string): boolean {
  return /\.mpd(\?|$)/i.test(url) || /\/(dash|mpd)\b/i.test(url);
}

function readStringMap(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'string') out[key] = entry;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function readAudioTracks(value: unknown): ProviderAudioTrack[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tracks = value
    .map((entry) => entry as Record<string, unknown>)
    .filter((entry) => typeof entry?.url === 'string' && entry.url.length > 0)
    .map((entry) => ({
      url: String(entry.url),
      headers: readStringMap(entry.headers),
    }));
  return tracks.length > 0 ? tracks : undefined;
}

function readPlaylist(value: unknown): ProviderPlaylistPart[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const parts = value
    .map((entry) => entry as Record<string, unknown>)
    .filter((entry) => typeof entry?.url === 'string' && /^https?:\/\//i.test(String(entry.url)))
    .map((entry) => ({
      url: String(entry.url),
      durationUs: typeof entry.durationUs === 'number' ? entry.durationUs : undefined,
    }));
  return parts.length > 0 ? parts : undefined;
}

/**
 * DRM, or nothing.
 *
 * A declaration that names no key material and no licence endpoint is still a
 * declaration — the stream is encrypted and FFmpeg cannot read it — so it is
 * kept rather than dropped for being incomplete. What is dropped is a `drm`
 * block that arrived with an unreadable scheme *and* nothing in it, which
 * carries no information at all.
 */
function readDrm(value: unknown): ProviderDrm | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const scheme = DRM_SCHEMES.find((name) => name === raw.scheme);
  const kid = typeof raw.kid === 'string' && raw.kid ? raw.kid : undefined;
  const key = typeof raw.key === 'string' && raw.key ? raw.key : undefined;
  const licenseUrl =
    typeof raw.licenseUrl === 'string' && raw.licenseUrl ? raw.licenseUrl : undefined;
  const uuid = typeof raw.uuid === 'string' && raw.uuid ? raw.uuid : undefined;

  if (!scheme && !kid && !key && !licenseUrl && !uuid) return undefined;

  return {
    scheme: scheme ?? 'unknown',
    uuid,
    kid,
    key,
    keyType: typeof raw.keyType === 'string' ? raw.keyType : undefined,
    licenseUrl,
    keyRequestParameters: readStringMap(raw.keyRequestParameters),
  };
}

/** One raw bridge link, read into the shape the rest of the app consumes. */
export function mapProviderLink(
  raw: Record<string, unknown>,
  providerName: string
): ExtractorLink {
  const url = String(raw.url ?? '');
  const declared = LINK_TYPES.find((name) => name === raw.type);
  const rawHeaders = (raw.headers as Record<string, string> | undefined) ?? {};
  const referer = raw.referer ? String(raw.referer) : '';
  const headers: Record<string, string> = { ...rawHeaders };
  if (referer && !Object.keys(headers).some((k) => k.toLowerCase() === 'referer')) {
    headers.Referer = referer;
  }

  return {
    source: raw.source ? String(raw.source) : providerName,
    name: raw.name ? String(raw.name) : providerName,
    url,
    referer,
    quality: typeof raw.quality === 'number' ? raw.quality : 0,
    linkType: declared,
    mimeType: typeof raw.mimeType === 'string' ? raw.mimeType : undefined,
    // `isM3u8`/`isDash` come off the link itself in 4.8.0 — the base class has
    // carried both for years and the host was inferring them from the string.
    isM3u8: declared === 'M3U8' || Boolean(raw.isM3u8) || (!declared && looksLikeHls(url)),
    isDash: declared === 'DASH' || Boolean(raw.isDash) || (!declared && looksLikeDash(url)),
    extractorData: typeof raw.extractorData === 'string' ? raw.extractorData : undefined,
    headers,
    audioTracks: readAudioTracks(raw.audioTracks),
    drm: readDrm(raw.drm),
    playlist: readPlaylist(raw.playlist),
  };
}

/**
 * Whether this link is a torrent rather than an HTTP stream.
 *
 * `ExtractorLinkType.TORRENT` and `MAGNET` are ordinary results on Android —
 * upstream hands them to its torrent player exactly as it hands an M3U8 to
 * ExoPlayer. Here they were being written into `directUrl` and passed to the
 * media proxy, which is an HTTP proxy: a `magnet:` URI went in and nothing
 * came out. The desktop has had a full WebTorrent engine the whole time; these
 * links simply never reached it.
 */
export function isTorrentLink(link: Pick<ExtractorLink, 'linkType' | 'url'>): boolean {
  if (link.linkType === 'TORRENT' || link.linkType === 'MAGNET') return true;
  return link.url.startsWith('magnet:') || /\.torrent(\?|$)/i.test(link.url);
}

/**
 * Whether the renderer's EME pipeline has to take this stream.
 *
 * True for every declared scheme including `unknown`: what matters downstream is
 * only that FFmpeg holds no keys, and an unrecognised system is no more readable
 * than a recognised one. Sending it to the probe instead spends the timeout on
 * encrypted noise and reports a corrupt file.
 */
export function linkRequiresEme(link: Pick<ExtractorLink, 'drm'>): boolean {
  return Boolean(link.drm);
}

/**
 * The provider's DRM declaration, in the media engine's own vocabulary.
 *
 * Two things are being converted here and only one of them is the type. The
 * other is the key material: providers write `kid` and `key` in hex or in
 * base64url with nothing saying which, and `clearKeysFromProvider` decides by
 * length because the alphabets overlap. A key read in the wrong encoding does
 * not fail — it decrypts to noise, which reads as a corrupt download.
 *
 * A declaration with no usable keys still produces a configuration. "Encrypted,
 * and we cannot decrypt it" is the answer that keeps FFmpeg off the stream and
 * gets the viewer an accurate message; dropping it would send the source back to
 * the probe to be misdiagnosed.
 */
export function drmFromProvider(drm: ProviderDrm | undefined): DrmConfiguration | null {
  if (!drm) return null;
  const clearKeys = clearKeysFromProvider(drm);
  return {
    type: drm.scheme,
    clearKeys: clearKeys ?? undefined,
    licenseUrl: drm.licenseUrl,
    licenseHeaders: drm.keyRequestParameters,
  };
}
