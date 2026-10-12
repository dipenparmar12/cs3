import { test } from 'node:test';
import assert from 'node:assert/strict';

import { describeRuntimeGaps } from './runtimeAdvice.ts';

const ready = { javaReady: true, sidecarReady: true, bridgeReady: true, packaged: false };

test('nothing missing, nothing to say', () => {
  assert.equal(describeRuntimeGaps(ready), undefined);
  assert.equal(describeRuntimeGaps({ ...ready, packaged: true }), undefined);
});

test('a checkout without the sidecar is sent to the build, not to a button that cannot build it', () => {
  const advice = describeRuntimeGaps({ ...ready, sidecarReady: false })!;
  assert.match(advice, /cs3-sidecar\.jar/);
  assert.match(advice, /bun run setup/);
  assert.doesNotMatch(advice, /Install Required Components/);
});

test('an installed app without the sidecar says the package is incomplete', () => {
  const advice = describeRuntimeGaps({ ...ready, sidecarReady: false, packaged: true })!;
  assert.match(advice, /packaged without/);
  assert.match(advice, /reinstall/i);
  assert.doesNotMatch(advice, /bun run setup/);
});

test('only Java missing is the one case the button fixes', () => {
  const advice = describeRuntimeGaps({ ...ready, javaReady: false })!;
  assert.match(advice, /Install Required Components/);
  assert.match(advice, /Java 21\+/);
});

test('the build gap leads, and a missing Java is still mentioned', () => {
  const advice = describeRuntimeGaps({ javaReady: false, sidecarReady: false, bridgeReady: false, packaged: false })!;
  assert.match(advice, /^The extension sidecar \(cs3-sidecar\.jar\) and the provider bridge/);
  assert.match(advice, /have not been built/);
  assert.match(advice, /Java 21\+ is missing as well/);
});
