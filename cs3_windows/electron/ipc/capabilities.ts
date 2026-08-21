import { handle, handleRaw } from './channel.ts';
import type { RegisterHandlers } from './services.ts';
import type { RendererCapabilities } from '../../src/types/media';
import { VIDEO_CODEC_PROBES } from '../mediaTranscoder';

/**
 * What this renderer can actually decode.
 *
 * Moved out of `main.ts` unchanged; see `services.ts` for why the dependencies
 * are named rather than reached for.
 */
export const registerCapabilityHandlers: RegisterHandlers = (services) => {
  const {
    playbackEngine,
  } = services;

  // --- audio compatibility -------------------------------------------------------
  /**
   * Inspects a stream's audio tracks and reports which the player can decode.
   *
   * Called before playback so the UI can name the tracks — including ones
   * Chromium cannot decode, which a `<video>` element does not expose at all.
   */
  /**
   * What this renderer can actually decode.
   *
   * Reported once at startup and believed over any table in the main process:
   * Chromium's HEVC support depends on the build and on platform decoders, so
   * only the renderer can answer for the machine in front of the user. The probe
   * strings live beside the codec table they correct.
   */
  handle('media:setCapabilities', async (capabilities: RendererCapabilities) => {
    // INV-RACE-4: registered during bootstrap, before any playback session opens.
    playbackEngine.setCapabilities(capabilities);
    return {};
  });

  handleRaw('media:getCodecProbes', async () => VIDEO_CODEC_PROBES);
};
