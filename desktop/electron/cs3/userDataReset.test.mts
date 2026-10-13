/**
 * "Erase my data" clears what it says, and only that.
 *
 *   node --experimental-strip-types electron/cs3/userDataReset.test.mts
 */
import assert from 'node:assert/strict';
import { PRESERVED_ON_RESET, runReset, summarise, type ResetAreaDefinition } from './userDataReset.ts';

const tests: Array<[string, () => void | Promise<void>]> = [];
const test = (name: string, fn: () => void | Promise<void>) => tests.push([name, fn]);

function area(id: string, log: string[], options: { fail?: boolean; count?: number | null } = {}): ResetAreaDefinition {
  return {
    id,
    label: id,
    description: '',
    defaultSelected: true,
    count: () => {
      if (options.count === undefined) throw new Error('no count');
      return options.count;
    },
    clear: ({ deleteDownloadedFiles }) => {
      if (options.fail) throw new Error(`${id} is locked`);
      log.push(deleteDownloadedFiles ? `${id}+files` : id);
    },
  };
}

test('only the chosen areas are cleared, in table order', async () => {
  const log: string[] = [];
  const areas = [area('a', log), area('b', log), area('c', log)];
  const result = await runReset(areas, ['c', 'a']);
  assert.deepEqual(log, ['a', 'c']);
  assert.deepEqual(result.cleared, ['a', 'c']);
  assert.equal(result.ok, true);
});

test('one failing area never stops the others, and is named', async () => {
  const log: string[] = [];
  const result = await runReset([area('a', log, { fail: true }), area('b', log)], ['a', 'b']);
  assert.deepEqual(log, ['b']);
  assert.equal(result.ok, false);
  assert.deepEqual(result.failed.map((f) => f.id), ['a']);
  assert.match(result.failed[0].error, /locked/);
});

test('an unknown id is reported, not silently ignored', async () => {
  const result = await runReset([area('a', [])], ['a', 'ghost']);
  assert.deepEqual(result.failed.map((f) => f.id), ['ghost']);
});

test('deleting files is off unless asked for', async () => {
  const log: string[] = [];
  await runReset([area('downloads', log)], ['downloads']);
  await runReset([area('downloads', log)], ['downloads'], { deleteDownloadedFiles: true });
  assert.deepEqual(log, ['downloads', 'downloads+files']);
});

test('a count that throws is shown as unknown, not as zero', () => {
  const summary = summarise([area('a', [], { count: 4 }), area('b', [])]);
  assert.deepEqual(summary.areas.map((a) => a.count), [4, null]);
});

test('the infrastructure that is kept is stated, including the media tools and the JVM', () => {
  const kept = PRESERVED_ON_RESET.join(' ');
  for (const word of ['mpv', 'FFmpeg', 'Java', 'extensions', 'settings']) {
    assert.ok(kept.includes(word), word);
  }
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL ${name}`);
    console.log(`       ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(failed === 0 ? `\n${tests.length} passed` : `\n${failed} of ${tests.length} FAILED`);
process.exit(failed === 0 ? 0 : 1);
