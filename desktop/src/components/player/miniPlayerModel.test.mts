import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeFloatingWindowBounds,
  isPointerTap,
  resolveFloatingPresentation,
  shouldHandlePlayerKeydown,
} from './miniPlayerModel.ts';

test('windows-level floating player suppresses the app-level mini player even when mini=true', () => {
  assert.equal(
    resolveFloatingPresentation({
      mini: true,
      hidden: false,
      floatingMode: 'pip',
      isFloatingWindowOpen: true,
      isNativePipOpen: false,
      isNativeEngine: false,
    }),
    'windows'
  );

  assert.equal(
    resolveFloatingPresentation({
      mini: true,
      hidden: false,
      floatingMode: 'pip',
      isFloatingWindowOpen: false,
      isNativePipOpen: true,
      isNativeEngine: false,
    }),
    'windows'
  );
});

test('app-level mini player renders only when mini=true, visible, and no OS-level window is open', () => {
  assert.equal(
    resolveFloatingPresentation({
      mini: true,
      hidden: false,
      floatingMode: 'mini',
      isFloatingWindowOpen: false,
      isNativePipOpen: false,
      isNativeEngine: false,
    }),
    'app'
  );

  assert.equal(
    resolveFloatingPresentation({
      mini: true,
      hidden: true,
      floatingMode: 'mini',
      isFloatingWindowOpen: false,
      isNativePipOpen: false,
      isNativeEngine: false,
    }),
    'none'
  );

  assert.equal(
    resolveFloatingPresentation({
      mini: false,
      hidden: false,
      floatingMode: 'mini',
      isFloatingWindowOpen: false,
      isNativePipOpen: false,
      isNativeEngine: false,
    }),
    'none'
  );
});

test('native mpv in pip mode reports windows presentation when main player overlay is hidden', () => {
  assert.equal(
    resolveFloatingPresentation({
      mini: false,
      hidden: true,
      floatingMode: 'pip',
      isFloatingWindowOpen: false,
      isNativePipOpen: false,
      isNativeEngine: true,
    }),
    'windows'
  );
});

test('keyboard shortcuts work inside focused app mini player but stay disarmed outside it', () => {
  assert.equal(
    shouldHandlePlayerKeydown({
      hidden: false,
      mini: true,
      isFocusInsidePlayer: true,
      isTextEntryTarget: false,
      isModalBlocking: false,
    }),
    true
  );

  assert.equal(
    shouldHandlePlayerKeydown({
      hidden: false,
      mini: true,
      isFocusInsidePlayer: false,
      isTextEntryTarget: false,
      isModalBlocking: false,
    }),
    false
  );

  assert.equal(
    shouldHandlePlayerKeydown({
      hidden: true,
      mini: false,
      isFocusInsidePlayer: true,
      isTextEntryTarget: false,
      isModalBlocking: false,
    }),
    false
  );

  assert.equal(
    shouldHandlePlayerKeydown({
      hidden: false,
      mini: false,
      isFocusInsidePlayer: false,
      isTextEntryTarget: true,
      isModalBlocking: false,
    }),
    false
  );
});

test('floating window bounds clamp cleanly inside display work area', () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1040 };
  assert.deepEqual(computeFloatingWindowBounds(workArea), {
    x: 1920 - 440 - 24,
    y: 1040 - 248 - 24,
    width: 440,
    height: 248,
  });

  assert.deepEqual(
    computeFloatingWindowBounds(workArea, { x: 5000, y: -200, width: 120, height: 80 }),
    {
      x: 1920 - 280,
      y: 0,
      width: 280,
      height: 158,
    }
  );
});

test('pointer tap distinguishes small clicks from window drags', () => {
  assert.equal(isPointerTap(100, 100, 103, 104), true);
  assert.equal(isPointerTap(100, 100, 110, 100), false);
});
