/**
 * How much of how this app is built the viewer wants to see.
 *
 * ## One switch, not two
 *
 * The settings screen already had this idea — a *level* that hides rows whose
 * label only means something to someone who knows the internals — and its test
 * is exactly the one the rest of the app needs: **understanding this requires
 * knowing how the app is built.** Not "rare", not "dangerous".
 *
 * So this is that same switch, widened to the whole app rather than a second
 * one beside it. Two switches would have to agree about what "technical" means,
 * and the moment they disagreed the settings screen and the player would be
 * telling one person two different things about the same preference. The
 * settings level is now derived from this mode ({@link settingsLevelFor}), so
 * there is one stored value and one answer.
 *
 * ## Why the default is standard
 *
 * Someone who installed this to watch a film did not ask to see which engine
 * decoded it, which repository published the scraper, or what ffprobe made of
 * the container. Those are the app's workings, and a player that narrates them
 * reads as unfinished rather than as powerful. Everything stays one toggle
 * away, and nothing is deleted — `developer` reveals all of it.
 *
 * The old settings key is migrated rather than abandoned: a user who had
 * already chosen to see everything keeps seeing it.
 */

export type ExperienceMode = 'standard' | 'developer';

/**
 * Who a piece of the interface is for.
 *
 * `everyone` is the default for the same reason `shouldShow` defaults to
 * `basic`: an unclassified piece of UI is one nobody has thought about yet, and
 * hiding those would make standard mode silently lose features as the app
 * grows. The cost of the wrong default here is a viewer seeing something they
 * did not need; the cost of the other default is a control that vanishes and
 * nobody notices.
 */
export type Audience = 'everyone' | 'technical';

/** Where the mode lives. Shared with the settings screen's old key, migrated below. */
export const EXPERIENCE_MODE_KEY = 'cs3.experienceMode';

/** What the settings screen stored before the mode went app-wide. */
export const LEGACY_SETTINGS_LEVEL_KEY = 'cs3.settings.level';

/** Whether something written for `audience` should be shown in `mode`. */
export function shouldReveal(mode: ExperienceMode, audience: Audience = 'everyone'): boolean {
  return mode === 'developer' || audience === 'everyone';
}

/** The settings screen's own vocabulary, derived so there is one stored value. */
export function settingsLevelFor(mode: ExperienceMode): 'simple' | 'everything' {
  return mode === 'developer' ? 'everything' : 'simple';
}

/**
 * Reads the stored mode, honouring a choice made before this switch existed.
 *
 * Pure and taking both raw strings rather than touching `localStorage` itself,
 * because storage throws in a private window and returns null for a cleared
 * profile — and because this is the half worth testing. Anything unrecognised
 * is `standard`: a corrupt value must not be the one that reveals everything.
 */
export function readMode(stored: string | null, legacy: string | null = null): ExperienceMode {
  if (stored === 'developer') return 'developer';
  if (stored === 'standard') return 'standard';
  // Nothing stored under the new key: fall back to what the settings screen had.
  return legacy === 'everything' ? 'developer' : 'standard';
}

/**
 * A short sentence for a viewer, and the original kept for the details panel.
 *
 * The messages this app produces internally are good ones — they name the
 * provider, the status code, the stage — and that is exactly why they are the
 * wrong thing to put in front of someone who wanted to watch a film. `HTTP 403`
 * and `ffprobe timed out after 20000ms` describe our machinery; "this source
 * would not play" describes their situation.
 *
 * The original is never discarded, only demoted: `detail` is what "Show
 * details" reveals and what developer mode shows without asking. A message that
 * matches nothing here is already plain enough to pass through — that is the
 * same safe default as {@link Audience}, and it means a new internal message
 * reads slightly technical rather than disappearing.
 */
export interface PlainMessage {
  /** What a viewer is told. Always a complete, actionable sentence. */
  summary: string;
  /** The original, for `Show details` and for developer mode. */
  detail: string;
}

const PATTERNS: ReadonlyArray<[RegExp, string]> = [
  // Network reachability, in all the dialects the app produces.
  [
    /ENOTFOUND|ERR_NAME_NOT_RESOLVED|getaddrinfo|DNS/i,
    'That source could not be reached. Check your internet connection.',
  ],
  [
    /ECONNREFUSED|ECONNRESET|Connection reset|socket hang up|ERR_CONNECTION/i,
    'The connection to that source dropped. Trying again may work.',
  ],
  [/TimeoutError|timed out|ETIMEDOUT/i, 'That source took too long to answer.'],
  // Gone, versus refused — different actions for the viewer.
  [
    /\b(404|410)\b|no longer exists/i,
    'That source is no longer available. Another one should work.',
  ],
  [/\b40[13]\b|Forbidden|refused this request/i, 'That source would not let us play it.'],
  [/\b5\d\d\b|server error/i, 'That source is having problems right now.'],
  // The swarm, in words that do not require knowing what a swarm is.
  [/no peers|swarm looks dead|No data arrived/i, 'Nobody is sharing that file right now.'],
  // Decoding, which is the case where another source genuinely helps.
  [
    /codec|container|could not be read|could not decode|unrecognized file format/i,
    'This file is in a format that will not play here.',
  ],
  [/DRM|Widevine|PlayReady|EME/i, 'This source is protected and cannot be played here.'],
  // Our own machinery failing is not the viewer's fault and should not read as it.
  [
    /ffmpeg|ffprobe|conversion pipeline|transcode/i,
    'This file could not be prepared for playback.',
  ],
  [/sidecar|extension runtime|NoClassDefFound|LinkageError/i, 'An extension could not be run.'],
];

export function plainMessage(raw: string | null | undefined): PlainMessage {
  const detail = (raw ?? '').trim();
  if (!detail) {
    return { summary: 'Something went wrong.', detail: '' };
  }
  for (const [pattern, summary] of PATTERNS) {
    if (pattern.test(detail)) return { summary, detail };
  }
  return { summary: detail, detail };
}
