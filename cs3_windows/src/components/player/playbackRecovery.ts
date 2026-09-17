/**
 * What to do when a transport gives up on a stream.
 *
 * The player has three ways to put a source on screen — the `<video>` element
 * directly, hls.js driving Media Source Extensions, and Shaka driving them for
 * DASH — and until now only the first of them was wired to the failover ladder.
 * An element that errors calls `forceTranscodeRef`, which re-decides the source
 * with `force`, which routes it to mpv; hls.js's fatal error handler read, in
 * full:
 *
 * ```ts
 * hls.on(Hls.Events.ERROR, (_evt, data) => {
 *   if (data.fatal) setError(`Playback error: ${data.details}`);
 * });
 * ```
 *
 * — a dead end. Every HLS source hls.js could not demux was reported to the
 * viewer as `Playback error: fragParsingError` and abandoned there, with mpv
 * idle, the next candidate untried and the *same bytes* downloading perfectly
 * well from the download button four inches away. That is the whole of the
 * reported "it downloads but it will not stream": the transport that fails most
 * often was the one transport with no way back.
 *
 * So failures are classified here instead, once, for every transport, and the
 * classification is a decision about *what would change the outcome*:
 *
 * - Nothing arrived → ask the transport to fetch again, within a budget.
 * - Bytes arrived and could not be read → hand the source to another engine.
 *   Re-fetching identical bytes produces an identical refusal, and mpv carries
 *   its own FFmpeg and the platform's hardware decoders, so a bitstream that
 *   defeated hls.js's JavaScript demuxer is very often ordinary to it.
 * - The engine ladder is already spent → the source is genuinely unplayable;
 *   say so and let the session try the next one.
 *
 * Pure and separately tested because the situations it decides between are
 * expensive to reproduce on purpose: a CDN that serves MPEG-TS with AC-3 audio
 * hls.js cannot demux, a signed segment URL that expires mid-film, a playlist
 * that 404s on its third variant.
 */

/** Which transport reported the failure. Shaka and hls.js name things differently. */
export type PlaybackTransportKind = 'hls' | 'dash';

export type RecoveryAction =
  /** Non-fatal; the transport recovers on its own and the viewer sees nothing. */
  | { kind: 'ignore' }
  /** Ask the transport to resume fetching — `hls.startLoad()`. */
  | { kind: 'reload'; reason: string }
  /** Ask the transport to rebuild its buffer — `hls.recoverMediaError()`. */
  | { kind: 'recover-media'; reason: string }
  /** Hand the source to the next engine (mpv, then ffmpeg), or give up on it. */
  | { kind: 'escalate'; reason: string };

/** How many of each recovery this stream has already spent. */
export interface RecoveryBudget {
  reloads: number;
  mediaRecoveries: number;
}

export const EMPTY_BUDGET: RecoveryBudget = { reloads: 0, mediaRecoveries: 0 };

/**
 * Two fetch retries and one buffer rebuild.
 *
 * hls.js has already exhausted its own per-request retries before it calls an
 * error fatal, so these are retries of the *loading*, not of the request — and
 * a stream that needs more than two is a stream that will be better served by
 * an engine that demuxes it itself than by a fourth attempt at the same bytes.
 */
export const RECOVERY_LIMITS: RecoveryBudget = { reloads: 2, mediaRecoveries: 1 };

/**
 * Errors where the bytes arrived and the demuxer refused them.
 *
 * These never retry. `fragParsingError` is the measured case: Castle TV serves a
 * perfectly ordinary MPEG-TS ladder whose audio hls.js's JavaScript demuxer
 * cannot read, and the same playlist opens in mpv without comment. Asking for
 * the same segment again produces the same refusal, one round trip later, and
 * the viewer waits through every one of them.
 */
const UNREADABLE_BY_TRANSPORT = new Set([
  'fragParsingError',
  'manifestIncompatibleCodecsError',
  'bufferAddCodecError',
  'bufferIncompatibleCodecsError',
  'remuxAllocError',
  'levelParsingError',
  'manifestParsingError',
]);

/**
 * Errors where nothing arrived and another attempt is worth one round trip.
 *
 * A film is thousands of segments; one of them timing out is not a verdict on
 * the source. `startLoad()` is hls.js's own answer to exactly this.
 */
const TRANSIENT_FETCH = new Set([
  'fragLoadError',
  'fragLoadTimeOut',
  'fragGap',
  'levelLoadError',
  'levelLoadTimeOut',
  'levelEmptyError',
  'levelSwitchError',
  'keyLoadError',
  'keyLoadTimeOut',
  'audioTrackLoadError',
  'audioTrackLoadTimeOut',
]);

/**
 * Errors in the buffer rather than in the bytes.
 *
 * `recoverMediaError()` tears the buffer down and re-appends, which genuinely
 * fixes a stall on a discontinuity. It fixes nothing about a codec, which is why
 * the codec refusals above are deliberately not in this set.
 */
const BUFFER_TROUBLE = new Set([
  'bufferAppendError',
  'bufferAppendingError',
  'bufferStalledError',
  'bufferSeekOverHole',
  'bufferNudgeOnStall',
  'bufferFullError',
]);

/**
 * The playlist itself, which is not a segment and does not get retried here.
 *
 * By the time hls.js calls a manifest load fatal it has already retried it; and
 * a manifest that cannot be fetched at all is a link problem the ladder above
 * reports honestly (expired signature, dead host) rather than a decode problem
 * a different engine would solve. It still escalates, because mpv fetches the
 * playlist through the same proxy with the same headers and occasionally gets an
 * answer where hls.js's XHR did not.
 */
const MANIFEST_LEVEL = new Set(['manifestLoadError', 'manifestLoadTimeOut']);

/**
 * HTTP statuses that mean another attempt is pointless.
 *
 * 403 is deliberately absent, and for the same reason it is not "definitive" in
 * `SourceCache`: expired signed URLs and hotlink protection both answer 403 and
 * both recover from a re-resolve, so a 403 escalates to the engine ladder like
 * anything else rather than being treated as a permanently dead byte range.
 */
const PERMANENT_STATUS = new Set([404, 410, 451]);

export function classifyHlsFailure(input: {
  fatal: boolean;
  /** `Hls.ErrorTypes` value — `networkError`, `mediaError`, `muxError`, … */
  type: string;
  /** `Hls.ErrorDetails` value — `fragParsingError`, `levelLoadError`, … */
  details: string;
  spent: RecoveryBudget;
  /** The status the origin answered with, when the failure was a fetch. */
  responseCode?: number;
}): RecoveryAction {
  const { fatal, type, details, spent, responseCode } = input;

  /**
   * hls.js reports a great deal that it then handles itself — a nudged stall, a
   * gap jumped, a level dropped. Treating one of those as a failure abandons a
   * stream that is still playing, which is the opposite of the problem this
   * module exists to fix.
   */
  if (!fatal) return { kind: 'ignore' };

  if (UNREADABLE_BY_TRANSPORT.has(details)) {
    return {
      kind: 'escalate',
      reason: 'This stream could not be read by the browser’s demuxer.',
    };
  }

  if (MANIFEST_LEVEL.has(details)) {
    return { kind: 'escalate', reason: 'This stream’s playlist could not be read.' };
  }

  /**
   * A key that will not load is not a decode problem, and no engine here holds a
   * CDM. It escalates so the ladder can report it by name rather than leaving
   * `keySystemNoAccess` on screen as if it were a codec.
   */
  if (type === 'keySystemError' || details === 'fragDecryptError') {
    return { kind: 'escalate', reason: 'This stream is encrypted and the key was refused.' };
  }

  if (TRANSIENT_FETCH.has(details)) {
    if (responseCode !== undefined && PERMANENT_STATUS.has(responseCode)) {
      return {
        kind: 'escalate',
        reason: `The source answered HTTP ${responseCode} for part of this stream.`,
      };
    }
    if (spent.reloads < RECOVERY_LIMITS.reloads) {
      return { kind: 'reload', reason: 'A part of this stream failed to load; fetching it again.' };
    }
    return { kind: 'escalate', reason: 'Parts of this stream kept failing to load.' };
  }

  if (BUFFER_TROUBLE.has(details)) {
    if (spent.mediaRecoveries < RECOVERY_LIMITS.mediaRecoveries) {
      return { kind: 'recover-media', reason: 'The video buffer stalled; rebuilding it.' };
    }
    return { kind: 'escalate', reason: 'The video buffer could not be kept fed.' };
  }

  /**
   * Everything unrecognised escalates rather than retrying.
   *
   * hls.js adds error details between releases, and a new one arriving should
   * cost the viewer a hand-off to an engine that can probably play it — not a
   * retry loop against an error nobody has classified.
   */
  return { kind: 'escalate', reason: `This stream stopped: ${details}.` };
}

/**
 * DASH, which has one answer.
 *
 * Shaka is the only thing here that can drive an `.mpd` through MSE, so a fatal
 * Shaka error has already exhausted the browser-side options — the remux and
 * native ladders below it are the remaining ones. There is no equivalent of
 * `startLoad()` worth reaching for: Shaka retries its own requests, and its
 * fatal errors are the ones it has already decided are not retryable.
 */
export function classifyDashFailure(reason: string): RecoveryAction {
  return { kind: 'escalate', reason: reason || 'This DASH stream could not be played.' };
}

export function spend(budget: RecoveryBudget, action: RecoveryAction): RecoveryBudget {
  if (action.kind === 'reload') return { ...budget, reloads: budget.reloads + 1 };
  if (action.kind === 'recover-media') {
    return { ...budget, mediaRecoveries: budget.mediaRecoveries + 1 };
  }
  return budget;
}
