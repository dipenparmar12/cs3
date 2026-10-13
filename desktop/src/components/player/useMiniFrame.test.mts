import assert from 'node:assert/strict';
import {
  ASPECT,
  MARGIN,
  MAX_WIDTH,
  MIN_WIDTH,
  clampFrame,
  computeResizedFrame,
  type MiniFrame,
  type ViewportBounds,
} from './useMiniFrame.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

const vp: ViewportBounds = { innerWidth: 1920, innerHeight: 1080 };

test('clampFrame restricts dimensions and positions within viewport', () => {
  const tooSmall: MiniFrame = { x: 0, y: 0, width: 100 };
  const clampedSmall = clampFrame(tooSmall, vp);
  assert.equal(clampedSmall.width, MIN_WIDTH);
  assert.equal(clampedSmall.x, MARGIN);
  assert.equal(clampedSmall.y, MARGIN);

  const tooLarge: MiniFrame = { x: 1000, y: 1000, width: 1500 };
  const clampedLarge = clampFrame(tooLarge, vp);
  assert.equal(clampedLarge.width, MAX_WIDTH);
  assert.ok(clampedLarge.x + clampedLarge.width <= vp.innerWidth - MARGIN);
  assert.ok(clampedLarge.y + clampedLarge.width / ASPECT <= vp.innerHeight - MARGIN);
});

test('se (bottom-right) resize anchors top-left and expands dimensions', () => {
  const origin: MiniFrame = { x: 200, y: 150, width: 420 };
  const resized = computeResizedFrame(origin, 'se', 80, 45, vp);

  assert.equal(resized.x, origin.x);
  assert.equal(resized.y, origin.y);
  assert.equal(resized.width, 500);
});

test('nw (top-left) resize anchors bottom-right and expands to top-left', () => {
  const origin: MiniFrame = { x: 600, y: 400, width: 420 };
  const originRight = origin.x + origin.width;
  const originBottom = origin.y + origin.width / ASPECT;

  const resized = computeResizedFrame(origin, 'nw', -80, -45, vp);

  assert.equal(resized.width, 500);
  assert.equal(Math.round(resized.x + resized.width), Math.round(originRight));
  assert.equal(Math.round(resized.y + resized.width / ASPECT), Math.round(originBottom));
});

test('ne (top-right) resize anchors bottom-left and expands to top-right', () => {
  const origin: MiniFrame = { x: 300, y: 400, width: 420 };
  const originBottom = origin.y + origin.width / ASPECT;

  const resized = computeResizedFrame(origin, 'ne', 80, -45, vp);

  assert.equal(resized.width, 500);
  assert.equal(resized.x, origin.x);
  assert.equal(Math.round(resized.y + resized.width / ASPECT), Math.round(originBottom));
});

test('sw (bottom-left) resize anchors top-right and expands to bottom-left', () => {
  const origin: MiniFrame = { x: 600, y: 200, width: 420 };
  const originRight = origin.x + origin.width;

  const resized = computeResizedFrame(origin, 'sw', -80, 45, vp);

  assert.equal(resized.width, 500);
  assert.equal(resized.y, origin.y);
  assert.equal(Math.round(resized.x + resized.width), Math.round(originRight));
});

test('edge resize (right/left/top/bottom) works predictably', () => {
  const origin: MiniFrame = { x: 400, y: 300, width: 400 };

  // Right edge
  const right = computeResizedFrame(origin, 'e', 60, 0, vp);
  assert.equal(right.x, origin.x);
  assert.equal(right.width, 460);

  // Left edge
  const left = computeResizedFrame(origin, 'w', -60, 0, vp);
  assert.equal(left.width, 460);
  assert.equal(left.x, origin.x - 60);

  // Bottom edge
  const bottom = computeResizedFrame(origin, 's', 0, 45, vp);
  assert.equal(bottom.x, origin.x);
  assert.equal(bottom.y, origin.y);
  assert.equal(Math.round(bottom.width), Math.round(origin.width + 45 * ASPECT));

  // Top edge
  const top = computeResizedFrame(origin, 'n', 0, -45, vp);
  assert.equal(top.x, origin.x);
  assert.equal(Math.round(top.width), Math.round(origin.width + 45 * ASPECT));
  const originBottom = origin.y + origin.width / ASPECT;
  assert.equal(Math.round(top.y + top.width / ASPECT), Math.round(originBottom));
});

test('resizing clamps strictly to viewport bounds', () => {
  // Parked at bottom-right corner of screen
  const width = 420;
  const origin: MiniFrame = {
    x: vp.innerWidth - width - MARGIN,
    y: vp.innerHeight - width / ASPECT - MARGIN,
    width,
  };

  // Attempting to expand bottom-right cannot grow because it is at the edge
  const se = computeResizedFrame(origin, 'se', 200, 200, vp);
  assert.equal(se.width, width);
  assert.ok(se.x + se.width <= vp.innerWidth - MARGIN);

  // But expanding top-left can grow towards top-left
  const nw = computeResizedFrame(origin, 'nw', -200, -100, vp);
  assert.ok(nw.width > width);
  assert.ok(nw.x >= MARGIN);
  assert.ok(nw.y >= MARGIN);
});

// --- runner ----------------------------------------------------------------

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL ${name}`);
    console.log(`       ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(failed === 0 ? `\n${tests.length} passed` : `\n${failed} of ${tests.length} FAILED`);
process.exit(failed === 0 ? 0 : 1);
