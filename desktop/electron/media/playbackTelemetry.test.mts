/**
 * PRD-40.1 §4.3 & §7: PlaybackTelemetry unit tests.
 *
 *   node --experimental-strip-types electron/media/playbackTelemetry.test.mts
 */
import assert from 'node:assert/strict';
import {
  DECISION_POLICY_VERSION,
  PlaybackTelemetryStore,
  calculateOrchestrationOverheadMs,
  calculatePercentile,
  generateCapabilityFingerprint,
  summarizeTelemetry,
  type PlaybackTelemetryRecord,
} from './playbackTelemetry.ts';

const tests: Array<[string, () => void | Promise<void>]> = [];
const test = (name: string, fn: () => void | Promise<void>) => tests.push([name, fn]);

function sampleRecord(overrides: Partial<PlaybackTelemetryRecord> = {}): PlaybackTelemetryRecord {
  return {
    sessionId: 'session-123',
    sourceId: 'provider-abc1234',
    sourceFingerprint: 'mp4-h264-aac-1080p',
    timestamp: Date.now(),
    appVersion: '1.0.0',
    electronVersion: '43.0.0',
    decisionPolicyVersion: DECISION_POLICY_VERSION,
    capabilityFingerprint: 'gpu-nvenc-d3d11-hevc1',
    selectedEngine: 'html5',
    selectedStrategy: 'DIRECT',
    renderSurface: 'dom',
    subtitleMode: 'webvtt',
    inspectionStrategy: 'head',
    container: 'mov,mp4,m4a,3gp,3g2,mj2',
    probeIncomplete: false,
    probeError: null,
    probeBytesTransferred: 2_000_000,
    probeNetworkMs: 250,
    probeParseMs: 15,
    capabilityLookupMs: 2,
    decisionMs: 1,
    engineAttachMs: 10,
    timeToFirstFrameMs: 850,
    playbackSeconds: 120,
    seekCount: 2,
    seekRestartCount: 0,
    seekRestartMsSamples: [],
    stallCount: 0,
    stallTotalMs: 0,
    leaseRefreshAttempts: 0,
    leaseRefreshSuccesses: 0,
    reconnectCount: 0,
    terminalState: 'completed',
    fatalError: null,
    transitionCount: 0,
    ...overrides,
  };
}

test('INV-PERF-1a: calculates orchestration overhead excluding network latency', () => {
  const record = sampleRecord({
    probeNetworkMs: 1800, // slow network must NOT penalize app overhead
    probeParseMs: 20,
    capabilityLookupMs: 5,
    decisionMs: 2,
    engineAttachMs: 15,
  });

  const overhead = calculateOrchestrationOverheadMs(record);
  assert.equal(overhead, 42, 'orchestration overhead must sum parse + lookup + decision + attach only');
  assert.ok(overhead <= 150, 'must meet p50 <= 150ms budget');
});

test('INV-TELEM-1: decisionPolicyVersion is present on every telemetry record', () => {
  const record = sampleRecord();
  assert.equal(typeof record.decisionPolicyVersion, 'number');
  assert.equal(record.decisionPolicyVersion, 1);
});

test('fingerprint reflects runtime environment changes', () => {
  const fp1 = generateCapabilityFingerprint({
    appVersion: '1.0.0',
    electronVersion: '43.0.0',
    osRelease: 'Windows 10 19045',
    gpuRenderer: 'NVIDIA GeForce RTX 4070',
    gpuDriverVersion: '551.86',
    hevcSupported: true,
  });

  const fp2 = generateCapabilityFingerprint({
    appVersion: '1.0.0',
    electronVersion: '43.0.0',
    osRelease: 'Windows 10 19045',
    gpuRenderer: 'NVIDIA GeForce RTX 4070',
    gpuDriverVersion: '551.86',
    hevcSupported: false, // HEVC extension removed
  });

  assert.notEqual(fp1, fp2, 'fingerprint must change when live codec capability changes');
});

test('calculatePercentile produces correct p50 and p95', () => {
  const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  assert.equal(calculatePercentile(values, 50), 50);
  assert.equal(calculatePercentile(values, 95), 100);
});

test('summarizeTelemetry applies sample size confidence tiers', () => {
  const recordsSmall = Array.from({ length: 25 }, () => sampleRecord());
  const summarySmall = summarizeTelemetry(recordsSmall);
  assert.equal(summarySmall.sampleConfidence, 'raw');

  const recordsMed = Array.from({ length: 50 }, () => sampleRecord());
  const summaryMed = summarizeTelemetry(recordsMed);
  assert.equal(summaryMed.sampleConfidence, 'p50_only');

  const recordsLarge = Array.from({ length: 150 }, () => sampleRecord());
  const summaryLarge = summarizeTelemetry(recordsLarge);
  assert.equal(summaryLarge.sampleConfidence, 'provisional_p95');

  const recordsOperational = Array.from({ length: 350 }, () => sampleRecord());
  const summaryOperational = summarizeTelemetry(recordsOperational);
  assert.equal(summaryOperational.sampleConfidence, 'operational_p95');
  assert.equal(summaryOperational.reliability.completionRate, 1.0);
  assert.equal(summaryOperational.performance.invPerf1aCompliant, true);
});

test('PlaybackTelemetryStore records records in ring buffer', () => {
  const store = new PlaybackTelemetryStore(3);
  store.record(sampleRecord({ sessionId: 's-1' }));
  store.record(sampleRecord({ sessionId: 's-2' }));
  store.record(sampleRecord({ sessionId: 's-3' }));
  store.record(sampleRecord({ sessionId: 's-4' }));

  const records = store.getRecords();
  assert.equal(records.length, 3);
  assert.equal(records[0].sessionId, 's-2');
  assert.equal(records[2].sessionId, 's-4');
});

// --- execution -------------------------------------------------------------

let passed = 0;
let failed = 0;

for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
    passed++;
  } catch (error) {
    console.error(`  FAIL ${name}`);
    console.error(error);
    failed++;
  }
}

console.log(`\n${passed} passed${failed > 0 ? `, ${failed} failed` : ''}`);
if (failed > 0) process.exit(1);
