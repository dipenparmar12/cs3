/**
 * Plays a DASH manifest with Shaka Player, DRM included.
 *
 * The gap this closes is narrow and was total: Chromium cannot demux an `.mpd`
 * at all — handed one directly it reports `Unable to parse XML declaration`,
 * because an XML document has arrived at a binary demuxer — so DASH had exactly
 * one route here, which was to remux it with ffmpeg. That works and costs a
 * process, and it flattens the adaptive ladder to a single fixed rendition,
 * which is the one thing DASH exists to provide.
 *
 * Under DRM it was worse than costly, it was impossible. FFmpeg's DASH demuxer
 * rejects `-decryption_key` outright — measured, and *fatal to the whole command
 * line* rather than ignored — so an encrypted manifest had no path at all and
 * was reported by name instead of played.
 *
 * Shaka drives Media Source Extensions itself and owns the EME handshake, which
 * makes it the only thing in this app that can do both. What it cannot do is
 * invent decoders: it appends to the same MSE the `<video>` element sits on, so
 * a ladder carrying HEVC on a machine with no HEVC decoder still has nowhere to
 * go. `decideStrategy` checks that before choosing this path.
 *
 * The DOM-free half of the key handling lives in `clearKey.ts`, so the encoding
 * rules are tested once and shared with the FFmpeg path.
 */
import shaka from 'shaka-player';
import { clearKeysToHex } from './clearKey';
import type { SourceCapabilityModel } from '../types/media';

export interface ShakaAttachment {
  /** Renditions the manifest advertises, for the quality menu. */
  qualities: Array<{ level: number; label: string; detail?: string }>;
  /** Selects a rendition by its `level`, or `-1` for adaptive. */
  selectQuality(level: number): void;
  destroy(): Promise<void>;
}

/** EME key-system ids, keyed by the DRM vocabulary the engine uses. */
const KEY_SYSTEMS: Record<string, string> = {
  widevine: 'com.widevine.alpha',
  playready: 'com.microsoft.playready',
  clearkey: 'org.w3.clearkey',
};

/**
 * Turns the engine's DRM verdict into Shaka's configuration.
 *
 * ClearKey is answered locally: the provider sent the key with the link, so
 * there is no licence server in the loop and `clearKeys` is the whole
 * configuration. **Hex on both sides** — Shaka documents "a map of key IDs to
 * content keys (both in hex)", which is the same encoding FFmpeg's
 * `-decryption_keys` takes and the opposite of what EME wants, so the
 * conversion goes through the one place that owns it.
 *
 * Widevine and PlayReady get a licence server instead, and whether anything can
 * answer it depends on a CDM this build may not have. Configuring it anyway is
 * right: the failure then comes from the key system being unavailable, which is
 * the truth, rather than from us having declined to try.
 */
function drmConfiguration(capability: SourceCapabilityModel) {
  const { drm } = capability;
  const keySystem = KEY_SYSTEMS[drm.type];
  if (!keySystem) return null;

  if (drm.type === 'clearkey') {
    const clearKeys = drm.clearKeys ? clearKeysToHex(drm.clearKeys) : {};
    if (Object.keys(clearKeys).length === 0) return null;
    return { clearKeys };
  }

  if (!drm.licenseUrl) return null;
  return {
    servers: { [keySystem]: drm.licenseUrl },
    ...(drm.licenseHeaders && Object.keys(drm.licenseHeaders).length > 0
      ? { advanced: { [keySystem]: { headers: drm.licenseHeaders } } }
      : {}),
  };
}

/**
 * Attaches Shaka to an element and loads the manifest.
 *
 * Rejects rather than resolving on a load failure, so the caller's failover
 * ladder sees it as this source not working — the same contract the element's
 * own `error` event has. Resolving with a dead player would leave the viewer
 * looking at a black frame with nothing reported.
 */
export async function attachShaka(
  video: HTMLVideoElement,
  manifestUrl: string,
  capability: SourceCapabilityModel
): Promise<ShakaAttachment> {
  /**
   * Polyfills first, and before any player exists.
   *
   * They patch EME and MSE differences across engines, and Shaka's own docs are
   * explicit that they must run before a player is constructed rather than
   * after — a player built first keeps the unpatched implementations it captured.
   */
  shaka.polyfill.installAll();

  const player = new shaka.Player();
  await player.attach(video);

  const drm = drmConfiguration(capability);
  if (drm) player.configure({ drm });

  try {
    await player.load(manifestUrl);
  } catch (error) {
    await player.destroy().catch(() => {});
    throw error instanceof Error ? error : new Error(String(error));
  }

  /**
   * Renditions, newest-height first, with `-1` standing for adaptive.
   *
   * Shaka calls these "variant tracks" and switching to one explicitly turns
   * adaptation off; `configure({abr: {enabled: true}})` turns it back on. Both
   * are needed or the quality menu becomes a one-way door.
   */
  const variants = player.getVariantTracks();
  const qualities = variants
    .slice()
    .sort((a, b) => (b.height ?? 0) - (a.height ?? 0))
    .map((track) => ({
      level: track.id,
      label: track.height ? `${track.height}p` : `Track ${track.id}`,
      detail: track.bandwidth ? `${Math.round(track.bandwidth / 1000)} kbps` : undefined,
    }));

  return {
    qualities,
    selectQuality(level: number) {
      if (level < 0) {
        player.configure({ abr: { enabled: true } });
        return;
      }
      const track = player.getVariantTracks().find((candidate) => candidate.id === level);
      if (!track) return;
      player.configure({ abr: { enabled: false } });
      player.selectVariantTrack(track, true);
    },
    async destroy() {
      await player.destroy().catch(() => {});
    },
  };
}
