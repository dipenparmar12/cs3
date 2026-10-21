/**
 * What picking an audio track in the player's menu has to do.
 *
 * The menu lists the tracks the inspection found (ffprobe, or the segment's
 * PMT). Four things can carry the change out, cheapest first:
 *
 * - `live`: the element or hls.js switches in place. Chromium exposes
 *   `HTMLMediaElement.audioTracks` only with the `AudioVideoTracks` Blink
 *   feature (`main.ts`); with it, a two-track MP4 or WebM switches 440 → 880 Hz
 *   in place with the position kept (measured, Electron 43, 2026-10-21).
 * - `none`: the track asked for is the one already playing.
 * - `prepare`: re-prepare with the chosen index. The decision engine remuxes
 *   that track in (video copied), because the element starts on the default.
 * - `convert`: the contents were never measured, so only the forced re-encode
 *   is known to work. It used to be the answer for every direct file, which
 *   sent a soundtrack change to mpv's window or a software video encode.
 */
import { languagesMatch } from '../../../electron/media/decisionEngine.ts';

export type AudioSwitchRoute = 'live' | 'none' | 'prepare' | 'convert';

export interface AudioSwitchInput {
  /** The menu's pick: an index into the inspection's audio list. */
  index: number;
  /** The element or hls.js offers a track that is the pick (`liveTrackFor`). */
  liveMatch: boolean;
  /**
   * A progressive file whose video the inspection measured: the decision
   * engine can remux the pick in. Not DASH, whose Shaka session would be
   * re-attached unchanged, and not a record whose languages went unread.
   */
  measured: boolean;
  /** HLS whose languages sit inside the TS segments; hls.js plays the first. */
  inSegments: boolean;
  /** The element is playing a conversion, not the source itself. */
  isConverted: boolean;
  /** The track the element plays when nobody picks one. */
  defaultIndex: number;
}

export function audioSwitchRoute(input: AudioSwitchInput): AudioSwitchRoute {
  if (input.liveMatch) return 'live';
  if (!input.isConverted) {
    const playing = input.inSegments ? 0 : input.defaultIndex;
    if (input.index === playing) return 'none';
  }
  return input.measured || input.inSegments ? 'prepare' : 'convert';
}

/**
 * The live track a probed one means.
 *
 * Same count: the same position. A container lists its audio in the order
 * ffprobe numbers it, while the ids are the file's own track numbers (`"2"`,
 * `"3"` in a file whose video is track 1). Different counts (hls.js lists one
 * rendition group where the manifest may hold one per bitrate): the language,
 * when exactly one live track carries it. Otherwise nothing, rather than a
 * guess that plays the wrong dub.
 */
export function liveTrackFor<T extends { language?: string }>(
  live: T[],
  probe: { index: number; language?: string },
  probeCount: number
): T | undefined {
  if (live.length < 2) return undefined;
  if (live.length === probeCount) return live[probe.index];
  if (!probe.language || probe.language === 'und') return undefined;
  const same = live.filter((track) => languagesMatch(track.language, probe.language));
  return same.length === 1 ? same[0] : undefined;
}

/** How a live track is addressed: its own id, else its position. */
export function liveTrackId(track: { id?: string }, position: number): string | number {
  return track.id !== undefined && track.id !== '' ? track.id : position;
}

interface SwitchableTrack {
  id?: string;
  enabled: boolean;
}

/**
 * Enables exactly the track `trackId` names, by id alone. Matching the id *or*
 * the position enabled two tracks at once when ids and positions overlap
 * (`"1"`, `"2"`), and the element mixed both soundtracks.
 *
 * The new track goes on before the others go off, so the element is never
 * left with no audio enabled. Answers whether anything matched.
 */
export function enableLiveTrack(list: ArrayLike<SwitchableTrack>, trackId: string | number): boolean {
  const wanted = String(trackId);
  let matched = -1;
  for (let i = 0; i < list.length; i++) {
    if (String(liveTrackId(list[i], i)) === wanted) {
      matched = i;
      break;
    }
  }
  if (matched < 0) return false;
  list[matched].enabled = true;
  for (let i = 0; i < list.length; i++) if (i !== matched) list[i].enabled = false;
  return true;
}

/**
 * A track's label, unless it is the MP4 handler's name. Chromium reports the
 * `hdlr` box as the label, which in most muxers' output is `SoundHandler` or
 * similar (measured: every track of an ffmpeg MP4), and says nothing.
 */
export function liveTrackLabel(label: string | undefined): string | undefined {
  const text = label?.trim();
  if (!text) return undefined;
  if (/handler$/i.test(text) || /^core media audio$/i.test(text) || /^iso media file/i.test(text)) {
    return undefined;
  }
  return text;
}
