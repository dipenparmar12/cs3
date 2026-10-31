import type {
  DrmConfiguration,
  HostEncodeCapability,
  MediaMetadata,
  MediaTransport,
  NativeEngineCapability,
  PlaybackStrategyType,
  RendererCapabilities,
} from '../../../src/types/media';
import { decideStrategy, requiresEmeDecryption } from '../../media/decisionEngine.ts';
import { printable } from './schema.ts';
import type { Judgement } from './stageEvidence.ts';

/**
 * S8 (what streams a source holds) and S9 (what the app would do with it, on
 * which machines), Provider Compatibility Audit PRD §6.1, §6.4. Both read the
 * shipping code's own answers: S8 the `MediaInspector` result for the source
 * served through the shipping `MediaProxy`, S9 `decideStrategy` itself, so a
 * new strategy shows up here without a change. Pure.
 */
export interface InspectionLike {
  metadata: MediaMetadata | null;
  transport: MediaTransport;
  drm: DrmConfiguration;
  error?: string;
  timedOut: boolean;
  probeIncomplete: boolean;
  probeBytesTransferred: number;
}

/** S8. `budgetSpent`: the source's byte cap ran out before the probe could finish. */
export function judgeInspection(inspection: InspectionLike, budgetSpent: boolean): Judgement {
  const meta = inspection.metadata;
  const evidence: Record<string, unknown> = {
    transport: inspection.transport,
    drm: inspection.drm.type,
    probeIncomplete: inspection.probeIncomplete,
    // The inspector's `probeBytesTransferred` is the probe size it asked ffprobe for, not bytes read;
    // the bytes the source cost are the record's own `bytes`, counted by the meter.
    probeSize: inspection.probeBytesTransferred,
  };
  if (!meta) {
    if (budgetSpent) return { outcome: 'inconclusive', reason: 'budget-exhausted', evidence };
    if (inspection.timedOut) return { outcome: 'inconclusive', reason: 'network-flaky', evidence };
    return { outcome: 'fail', message: printable(inspection.error ?? 'The probe found no streams.'), evidence };
  }
  const video = meta.video;
  return {
    outcome: 'pass',
    evidence: {
      ...evidence,
      container: meta.formatName,
      durationSeconds: meta.durationSeconds ? Math.round(meta.durationSeconds) : undefined,
      video: video
        ? { codec: video.codec, profile: video.profile, bitDepth: video.bitDepth, width: video.width, height: video.height, hdr: video.isHdr }
        : null,
      audio: meta.audio.map((a) => ({ codec: a.codec, channels: a.channels, language: a.language })),
      subtitles: meta.subtitles.length,
      audioInSegments: Boolean(meta.audioMuxedInSegments),
    },
  };
}

export interface RouteProfile {
  id: string;
  renderer: RendererCapabilities;
  host: HostEncodeCapability;
  native: NativeEngineCapability;
}

export const PLAIN: RendererCapabilities = { video: { h264: true, vp8: true, vp9: true, av1: true, hevc: false, hevc10: false } };
const HEVC: RendererCapabilities = { video: { h264: true, vp8: true, vp9: true, av1: true, hevc: true, hevc10: true } };
const SOFTWARE: HostEncodeCapability = { hardware: false, accelerator: 'cpu', logicalCores: 8 };
const QSV: HostEncodeCapability = { hardware: true, accelerator: 'qsv', logicalCores: 8 };

/** The §6.4 matrix: renderer decoders × host encoder × native engine policy. */
export const ROUTE_PROFILES: RouteProfile[] = [PLAIN, HEVC].flatMap((renderer, r) =>
  [SOFTWARE, QSV].flatMap((host) =>
    (['off', 'auto'] as const).map((policy) => ({
      id: `${r === 0 ? 'plain' : 'hevc'}/${host.accelerator === 'cpu' ? 'software' : host.accelerator}/${policy}`,
      renderer,
      host,
      native: { available: policy !== 'off', policy },
    }))
  )
);

export const FFMPEG_STRATEGIES: ReadonlySet<PlaybackStrategyType> = new Set<PlaybackStrategyType>([
  'REMUX_CONTAINER',
  'AUDIO_TRANSCODE',
  'VIDEO_TRANSCODE',
  'FULL_TRANSCODE',
  'DASH_REMUX',
]);
/** Audio Chromium returns "" for (AGENTS §6): never handed to the element as it is. */
const ELEMENT_DEAF = /^(ac3|eac3|dts|truehd|mlp)$/i;

/** S9: the strategy each profile gets, and whether any breaks a rule the app promises. */
export function judgeRoute(
  metadata: MediaMetadata,
  transport: MediaTransport,
  drm: DrmConfiguration,
  decide: typeof decideStrategy = decideStrategy
): Judgement {
  const strategies: Record<string, PlaybackStrategyType> = {};
  const broken: string[] = [];
  const eme = requiresEmeDecryption(drm);
  for (const profile of ROUTE_PROFILES) {
    let strategy: PlaybackStrategyType;
    try {
      strategy = decide(metadata, transport, profile.renderer, profile.host, drm, profile.native).strategy;
    } catch (error) {
      broken.push(`${profile.id}: decideStrategy threw ${printable(String((error as Error)?.message ?? error), 120)}`);
      continue;
    }
    strategies[profile.id] = strategy;
    if (eme && FFMPEG_STRATEGIES.has(strategy)) broken.push(`${profile.id}: DRM routed to ffmpeg (${strategy})`);
    if (
      strategy === 'DIRECT' &&
      profile.renderer === PLAIN &&
      metadata.audio.some((track) => ELEMENT_DEAF.test(track.codec)) &&
      !metadata.audio.some((track) => !ELEMENT_DEAF.test(track.codec))
    ) {
      broken.push(`${profile.id}: ${metadata.audio.map((a) => a.codec).join('+')} audio sent DIRECT`);
    }
  }
  const distinct = [...new Set(Object.values(strategies))];
  const evidence = { strategies, distinct, flips: distinct.length > 1 };
  if (broken.length > 0) return { outcome: 'fail', message: broken.join('; '), evidence };
  return { outcome: 'pass', evidence };
}
