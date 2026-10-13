import { test } from 'node:test';
import assert from 'node:assert/strict';

import { describeOsd, nextOsd, type OsdState } from './playerOsd.ts';

test('repeated volume presses update one indicator to the latest level', () => {
  let osd: OsdState | null = null;
  for (const volume of [0.55, 0.6, 0.65]) osd = nextOsd(osd, { kind: 'volume', volume, muted: false });
  assert.deepEqual(describeOsd(osd!), { primary: '65%', level: 0.65 });
});

test('volume at zero or muted reads Muted', () => {
  assert.equal(describeOsd(nextOsd(null, { kind: 'volume', volume: 0.4, muted: true })).primary, 'Muted');
  assert.equal(describeOsd(nextOsd(null, { kind: 'volume', volume: 0, muted: false })).primary, 'Muted');
});

test('a run of seeks adds up while the indicator is showing', () => {
  let osd: OsdState | null = null;
  osd = nextOsd(osd, { kind: 'seek', delta: 3, position: 63, duration: 600 });
  osd = nextOsd(osd, { kind: 'seek', delta: 3, position: 66, duration: 600 });
  osd = nextOsd(osd, { kind: 'seek', delta: 10, position: 76, duration: 600 });
  assert.deepEqual(describeOsd(osd), { primary: '+16s', secondary: '1:16 / 10:00' });
});

test('a seek after the indicator faded starts a new run', () => {
  const osd = nextOsd(null, { kind: 'seek', delta: -3, position: 57, duration: 600 });
  assert.equal(describeOsd(osd).primary, '−3s');
});

test('back and forth that cancels out shows only where it landed', () => {
  let osd: OsdState | null = nextOsd(null, { kind: 'seek', delta: 10, position: 70, duration: 600 });
  osd = nextOsd(osd, { kind: 'seek', delta: -10, position: 60, duration: 600 });
  assert.deepEqual(describeOsd(osd), { primary: '1:00 / 10:00' });
});

test('a jump ends a run of relative seeks', () => {
  let osd: OsdState | null = nextOsd(null, { kind: 'seek', delta: 10, position: 70, duration: 7200 });
  osd = nextOsd(osd, { kind: 'jump', position: 3600, duration: 7200 });
  assert.deepEqual(describeOsd(osd), { primary: '1:00:00 / 2:00:00' });
  osd = nextOsd(osd, { kind: 'seek', delta: 10, position: 3610, duration: 7200 });
  assert.equal(describeOsd(osd).primary, '+10s');
});

test('a different action replaces the indicator rather than queueing behind it', () => {
  let osd: OsdState | null = nextOsd(null, { kind: 'seek', delta: 10, position: 70, duration: 600 });
  osd = nextOsd(osd, { kind: 'volume', volume: 0.5, muted: false });
  assert.equal(osd.kind, 'volume');
  osd = nextOsd(osd, { kind: 'speed', speed: 1.5 });
  assert.deepEqual(describeOsd(osd), { primary: '1.5×', secondary: 'Speed' });
});

test('long runs read in minutes; an unknown duration shows the position alone', () => {
  let osd: OsdState | null = null;
  for (let i = 1; i <= 9; i++) osd = nextOsd(osd, { kind: 'seek', delta: 10, position: 90 + 10 * i, duration: 0 });
  assert.deepEqual(describeOsd(osd!), { primary: '+1m 30s', secondary: '3:00' });
});
