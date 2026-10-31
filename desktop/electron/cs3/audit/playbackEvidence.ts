import type {
  DrmConfiguration,
  HostEncodeCapability,
  MediaMetadata,
  MediaTransport,
  PlaybackStrategyType,
  TransformationPlan,
} from '../../../src/types/media';
import { decideStrategy } from '../../media/decisionEngine.ts';
import { FFMPEG_STRATEGIES, PLAIN } from './mediaEvidence.ts';
import { printable, type Reason } from './schema.ts';
import type { Judgement } from './stageEvidence.ts';

/**
 * S10: does the source actually play, on the route this machine would take
 * (Provider Compatibility Audit PRD §6.1)? Three tiers:
 *
 * - **element**: `<video>` (and hls.js for HLS) in a hidden window, for
 *   `DIRECT` and `HLS_NATIVE`.
 * - **ffmpeg**: the shipping `MediaTranscoder`, for the conversions.
 * - **mpv**: the native engine, for `NATIVE_MPV`, or for any source when it
 *   is asked for alone.
 *
 * Each tier is capped at 32 MB and 12 s (§6.5, L3). The route is decided for
 * a renderer that decodes what every Chromium does (`PLAIN`) and the host's
 * real encoder, so a T1 failure is the app's promise broken, not a
 * missing HEVC decoder. Pure: the runner measures, this judges.
 */
export type PlaybackTier = 'element' | 'ffmpeg' | 'mpv';
export type VerifyRequest = 'none' | PlaybackTier | 'all';
export const VERIFY_REQUESTS: readonly VerifyRequest[] = ['none', 'element', 'ffmpeg', 'mpv', 'all'];

export const VERIFY_CAPS = {
  bytes: 32 * 1024 * 1024,
  wallMs: 12_000,
  /** Stop early once this much has played: more costs bytes and proves nothing. */
  enoughSeconds: 5,
  /** The smoke test's bar (`smokeDeep.ts`): two seconds of real playhead. */
  minSeconds: 2,
};

const ELEMENT_STRATEGIES: ReadonlySet<PlaybackStrategyType> = new Set<PlaybackStrategyType>(['DIRECT', 'HLS_NATIVE']);

export interface TierPlan {
  tier: PlaybackTier;
  strategy: PlaybackStrategyType;
  plan: TransformationPlan;
}

export interface TierChoice {
  run: TierPlan[];
  /** Why nothing runs: a flag left it out, or the audit cannot drive that route. */
  unrun?: { strategy: PlaybackStrategyType; reason: Extract<Reason, 'stage-filter' | 'host-capability-absent'> };
}

export function playbackTiers(
  metadata: MediaMetadata,
  transport: MediaTransport,
  drm: DrmConfiguration,
  host: HostEncodeCapability,
  request: VerifyRequest,
  mpvAvailable: boolean,
  decide: typeof decideStrategy = decideStrategy
): TierChoice {
  if (request === 'none') return { run: [] };
  const off = decide(metadata, transport, PLAIN, host, drm, { available: false, policy: 'off' });
  const auto = mpvAvailable ? decide(metadata, transport, PLAIN, host, drm, { available: true, policy: 'auto' }) : off;
  const wants = (tier: PlaybackTier) => request === 'all' || request === tier;
  const run: TierPlan[] = [];
  if (wants('element') && ELEMENT_STRATEGIES.has(off.strategy)) run.push({ tier: 'element', strategy: off.strategy, plan: off.plan });
  if (wants('ffmpeg') && FFMPEG_STRATEGIES.has(off.strategy)) run.push({ tier: 'ffmpeg', strategy: off.strategy, plan: off.plan });
  // mpv plays anything; asked for alone it checks every source, otherwise only the ones routed to it.
  if (mpvAvailable && (request === 'mpv' || (wants('mpv') && auto.strategy === 'NATIVE_MPV'))) {
    run.push({ tier: 'mpv', strategy: auto.strategy, plan: auto.plan });
  }
  if (run.length > 0) return { run };
  const drivable = ELEMENT_STRATEGIES.has(off.strategy) || FFMPEG_STRATEGIES.has(off.strategy);
  const capable = drivable && !(request === 'mpv' && !mpvAvailable);
  return { run, unrun: { strategy: off.strategy, reason: capable ? 'stage-filter' : 'host-capability-absent' } };
}

export interface PlayMeasurement {
  tier: PlaybackTier;
  /** Playhead advance (element, mpv), or media seconds produced (ffmpeg). */
  playedSeconds: number;
  /** From the request to the first frame (element, mpv) or the first chunk (ffmpeg). */
  startMs?: number;
  wallMs: number;
  /** The source's 32 MB ran out. */
  budgetSpent: boolean;
  error?: { kind: 'network' | 'decode' | 'other'; message: string };
  /** S8 found a video stream. */
  expectVideo: boolean;
  width?: number;
  height?: number;
  decodedFrames?: number;
  droppedFrames?: number;
  stalls?: number;
  hwdec?: string;
  /** hls.js: fragments loaded, and the last thing it complained about. */
  fragments?: number;
  issue?: string;
}

export function judgePlayback(m: PlayMeasurement): Judgement {
  const realtime =
    m.tier === 'ffmpeg' && m.startMs !== undefined && m.wallMs > m.startMs
      ? Math.round((m.playedSeconds / ((m.wallMs - m.startMs) / 1000)) * 100) / 100
      : undefined;
  const evidence: Record<string, unknown> = {
    tier: m.tier,
    playedSeconds: Math.round(m.playedSeconds * 10) / 10,
    startMs: m.startMs,
    wallMs: m.wallMs,
    width: m.width,
    height: m.height,
    decodedFrames: m.decodedFrames,
    droppedFrames: m.droppedFrames,
    stalls: m.stalls,
    hwdec: m.hwdec,
    fragments: m.fragments,
    issue: m.issue,
    realtime,
  };
  if (m.playedSeconds >= VERIFY_CAPS.minSeconds) {
    if (m.expectVideo && m.tier !== 'ffmpeg' && !(m.width && m.width > 0)) {
      return { outcome: 'fail', message: 'It played sound but drew no picture.', evidence };
    }
    // Slower than realtime would stall in front of the viewer, but a faster machine may manage it.
    if (realtime !== undefined && realtime < 1) return { outcome: 'inconclusive', reason: 'host-capability-absent', evidence };
    return { outcome: 'pass', evidence };
  }
  if (m.budgetSpent) return { outcome: 'inconclusive', reason: 'budget-exhausted', evidence };
  if (m.error && m.error.kind !== 'network') return { outcome: 'fail', message: printable(m.error.message), evidence };
  // A network error, or no start within the wall: not something one run can blame.
  return { outcome: 'inconclusive', reason: 'network-flaky', evidence: { ...evidence, error: m.error?.message } };
}

interface Box {
  type: string;
  start: number;
  end: number;
  complete: boolean;
}

function* boxes(d: Uint8Array, from: number, to: number): Generator<Box> {
  const view = new DataView(d.buffer, d.byteOffset, d.byteLength);
  let at = from;
  while (at + 8 <= to) {
    let size = view.getUint32(at);
    const type = String.fromCharCode(d[at + 4], d[at + 5], d[at + 6], d[at + 7]);
    let header = 8;
    if (size === 1) {
      if (at + 16 > to) return;
      size = Number(view.getBigUint64(at + 8));
      header = 16;
    } else if (size === 0) {
      size = to - at;
    }
    if (size < header) return;
    const end = at + size;
    if (end > to) {
      yield { type, start: at + header, end: to, complete: false };
      return;
    }
    yield { type, start: at + header, end, complete: true };
    at = end;
  }
}

function child(d: Uint8Array, parent: Box, type: string): Box | undefined {
  for (const box of boxes(d, parent.start, parent.end)) if (box.type === type && box.complete) return box;
  return undefined;
}

/**
 * Media seconds in a fragmented MP4 as far as it was read: the span of the
 * video track's (else the first track's) fragments whose `mdat` arrived
 * whole. `null` when there is no `moov` or no complete fragment. This is what
 * a conversion produced, which is the only clock it has: the output carries
 * no index (AGENTS §6).
 */
export function fmp4MediaSeconds(d: Uint8Array): number | null {
  const view = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const u32 = (at: number) => view.getUint32(at);
  const tracks = new Map<number, { timescale: number; video: boolean; defaultDuration: number }>();
  let first = Infinity;
  let last = -Infinity;
  let pending: Array<{ trackId: number; start: number; end: number }> = [];
  let chosen: number | null = null;

  for (const top of boxes(d, 0, d.length)) {
    if (top.type === 'moov' && top.complete) {
      for (const trak of boxes(d, top.start, top.end)) {
        if (trak.type !== 'trak' || !trak.complete) continue;
        const tkhd = child(d, trak, 'tkhd');
        const mdia = child(d, trak, 'mdia');
        const mdhd = mdia && child(d, mdia, 'mdhd');
        const hdlr = mdia && child(d, mdia, 'hdlr');
        if (!tkhd || !mdhd) continue;
        const trackId = d[tkhd.start] === 1 ? u32(tkhd.start + 20) : u32(tkhd.start + 12);
        const timescale = d[mdhd.start] === 1 ? u32(mdhd.start + 20) : u32(mdhd.start + 12);
        const handler = hdlr ? String.fromCharCode(...d.subarray(hdlr.start + 8, hdlr.start + 12)) : '';
        tracks.set(trackId, { timescale, video: handler === 'vide', defaultDuration: 0 });
      }
      const mvex = child(d, top, 'mvex');
      if (mvex) {
        for (const trex of boxes(d, mvex.start, mvex.end)) {
          const track = trex.type === 'trex' ? tracks.get(u32(trex.start + 4)) : undefined;
          if (track) track.defaultDuration = u32(trex.start + 12);
        }
      }
      chosen = [...tracks.entries()].find(([, t]) => t.video)?.[0] ?? tracks.keys().next().value ?? null;
    } else if (top.type === 'moof' && top.complete) {
      pending = [];
      for (const traf of boxes(d, top.start, top.end)) {
        if (traf.type !== 'traf' || !traf.complete) continue;
        const tfhd = child(d, traf, 'tfhd');
        if (!tfhd) continue;
        const trackId = u32(tfhd.start + 4);
        const flags = u32(tfhd.start) & 0xffffff;
        let at = tfhd.start + 8;
        if (flags & 0x01) at += 8;
        if (flags & 0x02) at += 4;
        const defaultDuration = flags & 0x08 ? u32(at) : (tracks.get(trackId)?.defaultDuration ?? 0);
        const tfdt = child(d, traf, 'tfdt');
        const start = !tfdt ? 0 : d[tfdt.start] === 1 ? Number(view.getBigUint64(tfdt.start + 4)) : u32(tfdt.start + 4);
        let duration = 0;
        for (const trun of boxes(d, traf.start, traf.end)) {
          if (trun.type !== 'trun' || !trun.complete) continue;
          const runFlags = u32(trun.start) & 0xffffff;
          const count = u32(trun.start + 4);
          let p = trun.start + 8;
          if (runFlags & 0x01) p += 4;
          if (runFlags & 0x04) p += 4;
          const stride = [0x100, 0x200, 0x400, 0x800].filter((bit) => runFlags & bit).length * 4;
          for (let i = 0; i < count; i++) {
            duration += runFlags & 0x100 ? u32(p + i * stride) : defaultDuration;
          }
        }
        pending.push({ trackId, start, end: start + duration });
      }
    } else if (top.type === 'mdat') {
      // A fragment counts once its samples arrived.
      if (top.complete) {
        for (const fragment of pending) {
          if (fragment.trackId !== chosen) continue;
          first = Math.min(first, fragment.start);
          last = Math.max(last, fragment.end);
        }
      }
      pending = [];
    }
  }
  const timescale = chosen === null ? undefined : tracks.get(chosen)?.timescale;
  if (!timescale || last === -Infinity) return null;
  return (last - first) / timescale;
}
