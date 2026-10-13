import { createHash } from 'crypto';
import type { PlaybackStrategyType } from '../../src/types/media.ts';
import { scopedLogger } from '../logging/logger.ts';

const log = scopedLogger('playback');

/**
 * PRD-40 / PRD-40.1 §4.3: Per-Session Playback Telemetry & Observability.
 *
 * Telemetry makes every engine selection and performance decision empirically measurable.
 * Invariant INV-TELEM-1: Any change to DecisionEngine requires manually bumping `decisionPolicyVersion`.
 */

export const DECISION_POLICY_VERSION = 1;

export type PlaybackTerminalState =
  | 'completed'
  | 'user-abort'
  | 'fatal-error'
  | 'lease-exhausted'
  | 'engine-switch';

export type SelectedPlaybackEngine = 'html5' | 'hlsjs' | 'shaka' | 'mpv';

export type SubtitlePresentationMode =
  | 'none'
  | 'webvtt'
  | 'ass-native'
  | 'bitmap-native'
  | 'unavailable';

export type InspectionStrategyType =
  | 'manifest-hls'
  | 'manifest-dash'
  | 'head'
  | 'head+tail'
  | 'head+probesize'
  | 'progressive';

export interface PlaybackTelemetryRecord {
  // ── Identity & provenance ────────────────────────────────
  sessionId: string;
  sourceId: string;
  sourceFingerprint: string;
  timestamp: number;

  appVersion: string;
  electronVersion: string;
  decisionPolicyVersion: number;
  capabilityFingerprint: string;

  // ── Engine selection & presentation ──────────────────────
  selectedEngine: SelectedPlaybackEngine;
  selectedStrategy: PlaybackStrategyType;
  renderSurface: 'dom' | 'native-window';
  subtitleMode: SubtitlePresentationMode;

  // ── Inspection metrics ───────────────────────────────────
  inspectionStrategy: InspectionStrategyType;
  container: string;
  probeIncomplete: boolean;
  probeError: string | null;
  probeBytesTransferred: number;
  probeNetworkMs: number;

  // ── Latency breakdown (INV-PERF-1a & INV-PERF-1b) ─────────
  probeParseMs: number;
  capabilityLookupMs: number;
  decisionMs: number;
  engineAttachMs: number;
  timeToFirstFrameMs: number;

  // ── Runtime outcome ──────────────────────────────────────
  playbackSeconds: number;
  seekCount: number;
  seekRestartCount: number;
  seekRestartMsSamples: number[];
  stallCount: number;
  stallTotalMs: number;

  // ── Lease behaviour (INV-LEASE-1) ────────────────────────
  leaseRefreshAttempts: number;
  leaseRefreshSuccesses: number;
  reconnectCount: number;

  // ── Termination ──────────────────────────────────────────
  terminalState: PlaybackTerminalState;
  fatalError: string | null;
  transitionCount: number;
}

/**
 * Calculates the pure application orchestration overhead (excluding network transfer time).
 * PRD-40.1 INV-PERF-1a: p50 <= 150 ms, p95 <= 300 ms.
 */
export function calculateOrchestrationOverheadMs(record: PlaybackTelemetryRecord): number {
  return (
    (record.probeParseMs || 0) +
    (record.capabilityLookupMs || 0) +
    (record.decisionMs || 0) +
    (record.engineAttachMs || 0)
  );
}

/**
 * Generates a capability fingerprint incorporating runtime environment, GPU, and decoders.
 */
export function generateCapabilityFingerprint(details: {
  appVersion: string;
  electronVersion: string;
  osRelease: string;
  gpuRenderer?: string;
  gpuDriverVersion?: string;
  hevcSupported?: boolean;
}): string {
  const payload = [
    details.appVersion,
    details.electronVersion,
    details.osRelease,
    details.gpuRenderer || 'unknown-gpu',
    details.gpuDriverVersion || 'unknown-driver',
    details.hevcSupported ? 'hevc:1' : 'hevc:0',
  ].join('|');

  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

/**
 * Computes percentile values according to PRD-40.1 §34 & §4.3 sample-size conventions.
 */
export function calculatePercentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

export interface TelemetrySummary {
  sampleCount: number;
  reliability: {
    completionRate: number;
    userAbortRate: number;
    fatalErrorRate: number;
    leaseExhaustionRate: number;
  };
  performance: {
    orchestrationP50: number;
    orchestrationP95: number;
    invPerf1aCompliant: boolean;
    timeToFirstFrameP50: number;
    timeToFirstFrameP95: number;
    avgSeekRestartMs: number;
    p50SeekRestartMs: number;
  };
  sampleConfidence: 'raw' | 'p50_only' | 'provisional_p95' | 'operational_p95';
}

/**
 * Summarizes telemetry records respecting sample-size confidence tiers.
 */
export function summarizeTelemetry(records: PlaybackTelemetryRecord[]): TelemetrySummary {
  const n = records.length;
  if (n === 0) {
    return {
      sampleCount: 0,
      reliability: { completionRate: 0, userAbortRate: 0, fatalErrorRate: 0, leaseExhaustionRate: 0 },
      performance: {
        orchestrationP50: 0,
        orchestrationP95: 0,
        invPerf1aCompliant: true,
        timeToFirstFrameP50: 0,
        timeToFirstFrameP95: 0,
        avgSeekRestartMs: 0,
        p50SeekRestartMs: 0,
      },
      sampleConfidence: 'raw',
    };
  }

  const completed = records.filter((r) => r.terminalState === 'completed').length;
  const userAbort = records.filter((r) => r.terminalState === 'user-abort').length;
  const fatalErrors = records.filter((r) => r.terminalState === 'fatal-error').length;
  const leaseExhausted = records.filter((r) => r.terminalState === 'lease-exhausted').length;

  const orchestrationTimes = records.map(calculateOrchestrationOverheadMs);
  const firstFrameTimes = records.map((r) => r.timeToFirstFrameMs).filter((t) => t > 0);
  const seekSamples = records.flatMap((r) => r.seekRestartMsSamples);

  const orchestrationP50 = calculatePercentile(orchestrationTimes, 50);
  const orchestrationP95 = calculatePercentile(orchestrationTimes, 95);
  const timeToFirstFrameP50 = calculatePercentile(firstFrameTimes, 50);
  const timeToFirstFrameP95 = calculatePercentile(firstFrameTimes, 95);
  const p50SeekRestartMs = calculatePercentile(seekSamples, 50);
  const avgSeekRestartMs = seekSamples.length > 0
    ? seekSamples.reduce((a, b) => a + b, 0) / seekSamples.length
    : 0;

  let sampleConfidence: TelemetrySummary['sampleConfidence'] = 'raw';
  if (n >= 300) sampleConfidence = 'operational_p95';
  else if (n >= 100) sampleConfidence = 'provisional_p95';
  else if (n >= 30) sampleConfidence = 'p50_only';

  return {
    sampleCount: n,
    reliability: {
      completionRate: completed / n,
      userAbortRate: userAbort / n,
      fatalErrorRate: fatalErrors / n,
      leaseExhaustionRate: leaseExhausted / n,
    },
    performance: {
      orchestrationP50,
      orchestrationP95,
      invPerf1aCompliant: orchestrationP50 <= 150 && orchestrationP95 <= 300,
      timeToFirstFrameP50,
      timeToFirstFrameP95,
      avgSeekRestartMs,
      p50SeekRestartMs,
    },
    sampleConfidence,
  };
}

export class PlaybackTelemetryStore {
  private records: PlaybackTelemetryRecord[] = [];
  private maxRecords: number;

  constructor(maxRecords = 200) {
    this.maxRecords = maxRecords;
  }

  public record(telemetry: PlaybackTelemetryRecord): void {
    if (this.records.length >= this.maxRecords) {
      this.records.shift();
    }
    this.records.push(telemetry);

    const overhead = calculateOrchestrationOverheadMs(telemetry);
    log.info('playback_session_telemetry', {
      sessionId: telemetry.sessionId,
      sourceId: telemetry.sourceId,
      engine: telemetry.selectedEngine,
      strategy: telemetry.selectedStrategy,
      orchestrationOverheadMs: overhead,
      firstFrameMs: telemetry.timeToFirstFrameMs,
      terminalState: telemetry.terminalState,
      fatalError: telemetry.fatalError,
    });
  }

  public getRecords(): PlaybackTelemetryRecord[] {
    return [...this.records];
  }

  public getSummary(): TelemetrySummary {
    return summarizeTelemetry(this.records);
  }

  public clear(): void {
    this.records = [];
  }
}
