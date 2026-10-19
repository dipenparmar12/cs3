/**
 * Playback privacy: when a video may be seen, and who may resume it.
 *
 *   bun run test playbackPrivacy
 */
import assert from 'node:assert/strict';
import {
  mediaSessionRecord,
  playUnlessBlocked,
  playbackPrivacy,
  privacyAction,
  refusePlayback,
  type AdultVisibility,
  type GuardableMedia,
} from './playbackPrivacy.ts';

const adult = (over: Partial<AdultVisibility> = {}): AdultVisibility => ({
  loaded: true,
  allowed: true,
  blurred: true,
  revealedKeys: new Set(),
  ...over,
});
const ctx = { playing: true, ownsPause: false, wantsPlay: false, inFront: true };

const tests: Array<[string, () => void]> = [
  ['ordinary media is never touched, whatever the adult state', () => {
    for (const state of [adult(), adult({ allowed: false }), adult({ loaded: false })]) {
      assert.equal(playbackPrivacy(false, state, 'k'), 'open');
    }
  }],
  ['adult media is protected while settings are still loading', () => {
    assert.equal(playbackPrivacy(true, adult({ loaded: false, allowed: false }), 'k'), 'protected');
  }],
  ['adult media is blocked when adult content is off', () => {
    assert.equal(playbackPrivacy(true, adult({ allowed: false }), 'k'), 'blocked');
  }],
  ['permitted adult media starts protected (blurred is the launch default)', () => {
    assert.equal(playbackPrivacy(true, adult(), 'k'), 'protected');
  }],
  ['global Unblur opens it; Blur closes it again', () => {
    assert.equal(playbackPrivacy(true, adult({ blurred: false }), 'k'), 'open');
    assert.equal(playbackPrivacy(true, adult({ blurred: true }), 'k'), 'protected');
  }],
  ['revealing this video opens only this video', () => {
    const revealed = adult({ revealedKeys: new Set(['k']) });
    assert.equal(playbackPrivacy(true, revealed, 'k'), 'open');
    assert.equal(playbackPrivacy(true, revealed, 'other'), 'protected');
  }],
  ['a reveal cannot outlive turning adult content off', () => {
    assert.equal(playbackPrivacy(true, adult({ allowed: false, revealedKeys: new Set(['k']) }), 'k'), 'blocked');
  }],
  ['protecting a playing video pauses it', () => {
    assert.equal(privacyAction('open', 'protected', ctx), 'pause');
    assert.equal(privacyAction('open', 'blocked', ctx), 'pause');
  }],
  ['protecting a video the viewer already paused leaves it alone', () => {
    assert.equal(privacyAction('open', 'protected', { ...ctx, playing: false }), 'none');
  }],
  ['resume happens only for a pause privacy made', () => {
    assert.equal(privacyAction('protected', 'open', { ...ctx, playing: false, ownsPause: true }), 'resume');
    assert.equal(privacyAction('protected', 'open', { ...ctx, playing: false, ownsPause: false }), 'none');
  }],
  ['unblurring from another screen does not start sound in a hidden player', () => {
    assert.equal(
      privacyAction('protected', 'open', { ...ctx, playing: false, ownsPause: true, inFront: false }),
      'none'
    );
  }],
  ['an explicit Play always resumes, even when privacy did not pause it', () => {
    assert.equal(
      privacyAction('protected', 'open', { ...ctx, playing: false, ownsPause: false, wantsPlay: true }),
      'resume'
    );
  }],
  ['moving between protected and blocked never resumes or pauses', () => {
    assert.equal(privacyAction('protected', 'blocked', ctx), 'none');
    assert.equal(privacyAction('blocked', 'protected', { ...ctx, ownsPause: true, wantsPlay: true }), 'none');
  }],
];

/** A stand-in element whose `play` lives on the prototype, as on a real one. */
class FakeElement implements GuardableMedia {
  paused = false;
  plays = 0;
  listeners = new Set<() => void>();
  play(): Promise<void> {
    this.plays++;
    this.paused = false;
    this.listeners.forEach((listener) => listener());
    return Promise.resolve();
  }
  pause(): void { this.paused = true; }
  addEventListener(_type: 'play', listener: () => void): void { this.listeners.add(listener); }
  removeEventListener(_type: 'play', listener: () => void): void { this.listeners.delete(listener); }
}

tests.push(
  ['protecting pauses a playing element and play() is then refused without reaching the element', async () => {
    const element = new FakeElement();
    const release = refusePlayback(element);
    assert.equal(element.paused, true);
    await element.play();
    assert.equal(element.plays, 0, 'the refused call must not reach the element');
    assert.equal(element.paused, true);
    release();
  }],
  ['anything that starts regardless (autoplay, source swap) is paused again', () => {
    const element = new FakeElement();
    const release = refusePlayback(element);
    element.paused = false;
    element.listeners.forEach((listener) => listener());
    assert.equal(element.paused, true);
    release();
  }],
  ['releasing puts the element back as it was: its own play(), no listener left', async () => {
    const element = new FakeElement();
    const release = refusePlayback(element);
    release();
    assert.equal(Object.prototype.hasOwnProperty.call(element, 'play'), false);
    assert.equal(element.listeners.size, 0);
    await element.play();
    assert.equal(element.plays, 1);
  }],
  ['media keys cannot play a protected video, and work again once it is open', () => {
    let blocked = true;
    let played = 0;
    const handler = playUnlessBlocked(() => blocked, () => played++);
    handler();
    assert.equal(played, 0);
    blocked = false;
    handler();
    assert.equal(played, 1);
  }],
  ['the OS media overlay learns nothing about a protected video', () => {
    const record = { title: 'Some Film', subtitle: 'S1E2', artwork: 'https://x/poster.jpg' };
    assert.deepEqual(mediaSessionRecord('open', record), record);
    for (const state of ['protected', 'blocked'] as const) {
      assert.deepEqual(mediaSessionRecord(state, record), { title: 'CloudStream' });
    }
  }],
);

let failed = 0;
for (const [name, run] of tests) {
  try { await run(); console.log('  ok  ', name); } catch (error) { failed++; console.log('  FAIL', name, error); }
}
console.log(failed ? `${failed} of ${tests.length} FAILED` : `${tests.length} passed`);
process.exit(failed ? 1 : 0);
