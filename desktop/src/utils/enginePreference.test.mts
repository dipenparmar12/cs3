import assert from 'node:assert/strict';
import { asksForExternalPlayer } from './enginePreference.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

test('the Castle TV extractor declares it, in the extractor name', () => {
  assert.equal(
    asksForExternalPlayer({ indexerName: 'Castle TV (Use VLC)', title: 'Chumbak 720p' }),
    true,
  );
});

test('and in the link title, when the extractor name is generic', () => {
  assert.equal(
    asksForExternalPlayer({ indexerName: 'Castle TV', title: 'Castle TV (Use VLC) - Hindi, English, Tamil, Telugu' }),
    true,
  );
});

test('and in the provider name, where CNC Verse puts it', () => {
  assert.equal(asksForExternalPlayer({ providerName: 'Castle TV (Use VLC)', indexerName: 'Castle TV', title: 'Episode 1' }), true);
});

test('other phrasings of the same request count', () => {
  assert.equal(asksForExternalPlayer({ title: 'Server 2 [Play in MPV]' }), true);
  assert.equal(asksForExternalPlayer({ title: 'Use_VLC' }), true);
});

test('a source merely named after a player is not asking', () => {
  assert.equal(asksForExternalPlayer({ indexerName: 'VLC Mirror', title: 'Dune 1080p' }), false);
  assert.equal(asksForExternalPlayer({ indexerName: 'HubCloud', title: 'Dune 1080p' }), false);
  assert.equal(asksForExternalPlayer(null), false);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    failed++;
  }
}

if (failed > 0) {
  process.exit(1);
}
