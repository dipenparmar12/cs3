/**
 * What the privacy gate asks of a player, decided from facts and nothing else.
 *
 * Poster artwork, the Navbar control and the emergency key all read the same
 * adult state; this is the one place that turns it into "may this video be
 * seen and heard right now". The player carries the verdict into whichever
 * engine holds the stream.
 *
 *  - `open`      not adult, or adult and revealed on purpose — play as usual.
 *  - `protected` adult and permitted, but blurred: paused and hidden, and only
 *                an explicit Play or Unblur lets it back.
 *  - `blocked`   adult and adult content is off: nothing plays at all.
 *
 * Settings still loading count as `protected`, never `open` and never
 * `blocked`: the answer is not known, and a video must not flash in the gap.
 */
export type PlaybackPrivacy = 'open' | 'protected' | 'blocked';

export interface AdultVisibility {
  loaded: boolean;
  allowed: boolean;
  blurred: boolean;
  revealedKeys: ReadonlySet<string>;
}

export function playbackPrivacy(
  adultMedia: boolean,
  adult: AdultVisibility,
  itemKey: string
): PlaybackPrivacy {
  if (!adultMedia) return 'open';
  if (!adult.loaded) return 'protected';
  if (!adult.allowed) return 'blocked';
  if (!adult.blurred || adult.revealedKeys.has(itemKey)) return 'open';
  return 'protected';
}

export interface PrivacyContext {
  /** The video is playing right now. */
  playing: boolean;
  /** Privacy itself paused it earlier and nobody has touched it since. */
  ownsPause: boolean;
  /** The viewer pressed Play on a protected video. */
  wantsPlay: boolean;
  /** The player is on screen, not hidden behind another screen. */
  inFront: boolean;
}

/**
 * What to do to the transport when the verdict changes.
 *
 * Resume is owned: only a pause that privacy made is undone, and only while
 * the player is in front — unblurring from another screen must not start
 * sound in a player the viewer cannot see. A pause the viewer made is theirs.
 */
export function privacyAction(
  was: PlaybackPrivacy,
  now: PlaybackPrivacy,
  context: PrivacyContext
): 'pause' | 'resume' | 'none' {
  if (was === now) return 'none';
  if (now !== 'open') return was === 'open' && context.playing ? 'pause' : 'none';
  if (context.wantsPlay) return 'resume';
  return context.ownsPause && context.inFront ? 'resume' : 'none';
}

/** The slice of an `HTMLMediaElement` the guard touches, so it can be tested without a DOM. */
export interface GuardableMedia {
  paused: boolean;
  play: () => Promise<void>;
  pause: () => void;
  addEventListener: (type: 'play', listener: () => void) => void;
  removeEventListener: (type: 'play', listener: () => void) => void;
}

/**
 * Pauses the element and refuses `play()` on this instance until released.
 *
 * Refusing at the instance means no call site has to know about privacy, and
 * no sound starts in the gap before an event handler could pause it. The
 * `play` listener catches anything that starts regardless (the `autoplay`
 * attribute, a source swap). Releasing deletes the override, so the prototype's
 * `play` is back and the element was never replaced or reloaded.
 */
export function refusePlayback(element: GuardableMedia): () => void {
  if (!element.paused) element.pause();
  element.play = () => Promise.resolve();
  const stop = () => element.pause();
  element.addEventListener('play', stop);
  return () => {
    delete (element as { play?: unknown }).play;
    element.removeEventListener('play', stop);
  };
}

/** A transport command from outside the player (media keys, PiP) that is dropped while protected. */
export function playUnlessBlocked(blocked: () => boolean, play: () => void): () => void {
  return () => {
    if (!blocked()) play();
  };
}

/**
 * What the OS media overlay may know. Title and artwork are exactly what a
 * lock screen or media-key flyout would put in front of whoever is passing.
 */
export function mediaSessionRecord(
  state: PlaybackPrivacy,
  record: { title: string; subtitle?: string; artwork?: string }
): { title: string; subtitle?: string; artwork?: string } {
  return state === 'open' ? record : { title: 'CloudStream' };
}
