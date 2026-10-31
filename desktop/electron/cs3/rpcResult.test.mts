/**
 * A provider is timed by its own work, not by the app's queue.
 *
 *   node --experimental-strip-types electron/cs3/rpcResult.test.mts
 *
 * Latency feeds the ranking as the provider's speed. A call that waited for a
 * JVM worker behind a search fan-out was scored for that wait.
 */
import assert from 'node:assert/strict';
import { providerLatencyMs } from './rpcResult.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

test('the time queued for a worker is not the provider’s', () => {
  assert.equal(providerLatencyMs(1_000, { ok: true, queuedMs: 4_000 }, 9_000), 4_000);
});

test('a runtime that reports no queue time is timed as before', () => {
  assert.equal(providerLatencyMs(1_000, { ok: true }, 9_000), 8_000);
});

test('a queue time longer than the call never gives a negative latency', () => {
  assert.equal(providerLatencyMs(1_000, { ok: false, errorKind: 'TIMEOUT', queuedMs: 9_000 }, 2_000), 0);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed++;
    console.error(`  FAIL ${name}`);
    console.error(`       ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(`\n${tests.length - failed} passed${failed ? `, ${failed} failed` : ''}`);
if (failed) process.exit(1);
