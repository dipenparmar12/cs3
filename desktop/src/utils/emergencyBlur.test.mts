/**
 * The emergency blur key fires on a bare Backquote and nowhere it could eat typing.
 *
 *   bun run test emergencyBlur
 */
import assert from 'node:assert/strict';
import { isEmergencyBlurEvent, type EmergencyBlurEvent } from './emergencyBlur.ts';

const press = (over: Partial<EmergencyBlurEvent> = {}): EmergencyBlurEvent => ({
  code: 'Backquote',
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  target: { tagName: 'DIV' },
  ...over,
});

const tests: Array<[string, () => void]> = [
  ['a bare Backquote fires', () => assert.equal(isEmergencyBlurEvent(press()), true)],
  ['it fires with nothing focused', () => assert.equal(isEmergencyBlurEvent(press({ target: null })), true)],
  ['other keys do not', () => assert.equal(isEmergencyBlurEvent(press({ code: 'KeyB' })), false)],
  ['any modifier leaves it to the OS and the app (Shift is "~")', () => {
    for (const mod of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey'] as const) {
      assert.equal(isEmergencyBlurEvent(press({ [mod]: true })), false, mod);
    }
  }],
  ['typing is never intercepted', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
      assert.equal(isEmergencyBlurEvent(press({ target: { tagName } })), false, tagName);
    }
    assert.equal(isEmergencyBlurEvent(press({ target: { tagName: 'DIV', isContentEditable: true } })), false);
  }],
  ['an IME composition is left alone', () => assert.equal(isEmergencyBlurEvent(press({ isComposing: true })), false)],
];

let failed = 0;
for (const [name, run] of tests) {
  try { run(); console.log('  ok  ', name); } catch (error) { failed++; console.log('  FAIL', name, error); }
}
console.log(failed ? `${failed} of ${tests.length} FAILED` : `${tests.length} passed`);
process.exit(failed ? 1 : 0);
