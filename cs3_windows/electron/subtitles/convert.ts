/**
 * Subtitle files as they actually arrive, turned into something `<track>` accepts.
 *
 * Two Android behaviours are reproduced here, and both were missing. The Android
 * app parses SubRip, WebVTT **and SubStation Alpha**, and it runs every file
 * through `juniversalchardet` before parsing it. Neither is decoration:
 *
 * - **`.ass` / `.ssa` is a large fraction of anime and of fansubbed releases**,
 *   and it is not remotely SubRip. Feeding one through an SRT converter emits
 *   `[Script Info]`, `Style:` and `Dialogue:` lines as if they were cues, which
 *   the browser either rejects outright or renders as garbage on screen.
 * - **Subtitles are routinely not UTF-8.** Windows-1252 for Western European,
 *   CP1251 for Cyrillic, GBK for Chinese, EUC-KR for Korean, Windows-1256 for
 *   Arabic. Decoding those as UTF-8 produces replacement characters rather than
 *   an error — the file loads, the timings are right, and every accented
 *   character is a black diamond. That reads as a bad subtitle file rather than
 *   as a decoding bug, which is why it survives.
 *
 * Pure and separately testable: every failure here is silent and is attributed
 * to whoever uploaded the subtitle.
 */
import chardet from 'chardet';

/** Cue text that survives conversion. Everything else is styling we drop. */
const ASS_OVERRIDE_TAGS = /\{[^}]*\}/g;
const ASS_DRAWING_MODE = /\\p[1-9]/;

/**
 * Decodes subtitle bytes, preferring UTF-8 and detecting only when it is wrong.
 *
 * The order matters. Detection is statistical and gets short files wrong, while
 * valid UTF-8 is *checkable* — `TextDecoder` in fatal mode either accepts the
 * bytes or throws. So the common case is answered exactly and the detector is
 * only consulted for files that are provably not UTF-8.
 *
 * A byte-order mark wins over both: it is the file stating its own encoding.
 */
export function decodeSubtitle(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // Provably not UTF-8, so a guess is now the best available answer.
  }

  const detected = chardet.detect(Buffer.from(bytes));
  /**
   * A detection of UTF-8 is rejected out of hand, because we just disproved it.
   *
   * Detectors are statistical and short samples defeat them — `chardet` answers
   * "UTF-8" for a four-byte Windows-1252 string. Trusting that after
   * `TextDecoder` has already thrown on the same bytes reintroduces exactly the
   * replacement characters this function exists to avoid.
   */
  if (detected && !/^utf-?8$/i.test(detected)) {
    try {
      const decoded = new TextDecoder(detected).decode(bytes);
      /**
       * And a decode that produced U+FFFD is a wrong decode.
       *
       * `TextDecoder` only throws in fatal mode; otherwise it substitutes and
       * reports success. The substitution character *is* the failure, so it is
       * checked for rather than relied on not happening.
       */
      if (!decoded.includes('\uFFFD')) return decoded;
    } catch {
      // Node knows more encoding *names* than TextDecoder has labels for.
    }
  }

  /**
   * Windows-1252 rather than UTF-8 as the last resort.
   *
   * It is a single-byte encoding, so it cannot fail and it never produces a
   * replacement character — every byte maps to something. Falling back to UTF-8
   * here would be choosing the one decoder already proven wrong for this file.
   */
  return new TextDecoder('windows-1252').decode(bytes);
}

/**
 * Converts SubRip to WebVTT.
 *
 * The differences that matter are small but total: WebVTT needs the `WEBVTT`
 * header, and its timestamps use a `.` for the fractional separator where
 * SubRip uses `,`. A file missing either is rejected outright by the browser.
 */
export function srtToVtt(srt: string): string {
  const body = srt
    // A BOM before the WEBVTT header invalidates the file.
    .replace(/^﻿/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // 00:00:41,330 --> 00:00:43,400  ==>  00:00:41.330 --> 00:00:43.400
    .replace(
      /(\d{1,2}:\d{2}:\d{2}),(\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}),(\d{1,3})/g,
      '$1.$2 --> $3.$4'
    );

  return body.startsWith('WEBVTT') ? body : `WEBVTT\n\n${body}`;
}

/**
 * `0:01:02.34` (ASS, centiseconds) → `00:01:02.340` (WebVTT, milliseconds).
 *
 * ASS writes one leading hour digit and two fractional digits; WebVTT wants two
 * and three. Emitting the ASS form produces a cue the browser silently drops,
 * so this is not cosmetic normalisation.
 */
function assTimestamp(value: string): string | null {
  const match = /^(\d+):(\d{2}):(\d{2})[.,](\d{1,3})$/.exec(value.trim());
  if (!match) return null;
  const [, hours, minutes, seconds, fraction] = match;
  const milliseconds = fraction.padEnd(3, '0').slice(0, 3);
  return `${hours.padStart(2, '0')}:${minutes}:${seconds}.${milliseconds}`;
}

/**
 * Converts SubStation Alpha to WebVTT.
 *
 * Only the `[Events]` section carries text. Its `Format:` line names the field
 * order, and **it is read rather than assumed**: `Dialogue:` lines are
 * comma-separated positional fields whose order is declared per file, and while
 * `Start`/`End`/`Text` are conventionally at fixed indices, ASS does not require
 * it. Hard-coding the positions works on most files and silently produces
 * subtitles that are all blank or all mistimed on the rest.
 *
 * `Text` is always last and may itself contain commas, so the split is bounded
 * by the field count and the remainder is the text — splitting on every comma
 * truncates any line of dialogue containing one.
 *
 * What is deliberately dropped: positioning, fonts, colours and karaoke timing.
 * WebVTT cannot express most of it, and a styled-but-wrong cue is worse than a
 * plain correct one. Drawing commands (`\p1`) are dropped entirely — they are
 * vector shapes, not words, and rendering their coordinate lists as dialogue
 * puts a wall of numbers over the picture.
 */
export function assToVtt(ass: string): string {
  const lines = ass.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  let inEvents = false;
  let fields: string[] = [];
  const cues: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('[')) {
      inEvents = /^\[events\]/i.test(trimmed);
      continue;
    }
    if (!inEvents) continue;

    if (/^Format\s*:/i.test(trimmed)) {
      fields = trimmed
        .slice(trimmed.indexOf(':') + 1)
        .split(',')
        .map((name) => name.trim().toLowerCase());
      continue;
    }

    if (!/^Dialogue\s*:/i.test(trimmed)) continue;

    const startIndex = fields.indexOf('start');
    const endIndex = fields.indexOf('end');
    const textIndex = fields.indexOf('text');
    if (startIndex < 0 || endIndex < 0 || textIndex < 0) continue;

    // Bounded split: `Text` is last and may contain commas of its own.
    const parts = trimmed.slice(trimmed.indexOf(':') + 1).split(',');
    if (parts.length < fields.length) continue;
    const text = parts.slice(textIndex).join(',');

    const start = assTimestamp(parts[startIndex]);
    const end = assTimestamp(parts[endIndex]);
    if (!start || !end) continue;

    if (ASS_DRAWING_MODE.test(text)) continue;

    const body = text
      .replace(ASS_OVERRIDE_TAGS, '')
      // `\N` is a hard line break; `\n` and `\h` are a soft break and a hard space.
      .replace(/\\N/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\\h/g, ' ')
      .trim();

    if (!body) continue;
    cues.push(`${start} --> ${end}\n${body}`);
  }

  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}

/**
 * Whichever format arrived, as WebVTT.
 *
 * Decided by content rather than by the URL's extension, for the same reason the
 * compatibility engine reads manifests rather than matching names: subtitle
 * links from providers routinely have no extension, or the wrong one. The
 * markers are unambiguous — `[Script Info]` or `[V4+ Styles]` for ASS, a
 * `WEBVTT` header for WebVTT — so nothing has to be guessed.
 */
export function toWebVtt(text: string): string {
  const head = text.slice(0, 4096);
  if (/^\s*﻿?WEBVTT/.test(head)) return text.replace(/^﻿/, '');
  if (/\[Script Info\]|\[V4\+? Styles\]|^\s*Dialogue\s*:/im.test(head)) return assToVtt(text);
  return srtToVtt(text);
}
