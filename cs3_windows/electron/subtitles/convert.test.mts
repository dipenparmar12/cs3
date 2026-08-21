/**
 * Subtitle decoding and conversion.
 *
 *   bun run test:subtitles
 *   node --experimental-strip-types electron/subtitles/convert.test.mts
 *
 * Every failure this pins is silent, and every one of them looks like a bad
 * upload rather than a bug here. A mis-decoded file loads with correct timings
 * and black diamonds where the accents were; an ASS file run through the SubRip
 * converter emits `[Script Info]` as a cue. Neither raises anything.
 */
import assert from 'node:assert/strict';
import { assToVtt, decodeSubtitle, srtToVtt, toWebVtt } from './convert.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

const encode = (text: string, encoding: BufferEncoding = 'utf8') =>
  new Uint8Array(Buffer.from(text, encoding));

// --- decoding --------------------------------------------------------------

test('UTF-8 is decoded as UTF-8 rather than detected', () => {
  // Detection is statistical and gets short files wrong; valid UTF-8 is
  // checkable, so the common case is answered exactly.
  assert.equal(decodeSubtitle(encode('Ça va — déjà vu')), 'Ça va — déjà vu');
});

test('a UTF-8 BOM is honoured and stripped', () => {
  // A BOM left in place lands before the WEBVTT header and invalidates the file.
  const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...encode('WEBVTT')]);
  assert.equal(decodeSubtitle(withBom), 'WEBVTT');
});

test('UTF-16 is recognised from its BOM', () => {
  const utf16 = new Uint8Array([0xff, 0xfe, ...encode('hi', 'utf16le')]);
  assert.equal(decodeSubtitle(utf16), 'hi');
});

test('a Windows-1252 file is not mangled into replacement characters', () => {
  // 0xE9 is `é` in Windows-1252 and an invalid UTF-8 lead byte. Decoded as
  // UTF-8 it becomes U+FFFD, which is the black-diamond bug.
  const latin1 = new Uint8Array([0x43, 0x61, 0x66, 0xe9]); // "Café"
  const decoded = decodeSubtitle(latin1);
  assert.doesNotMatch(decoded, /�/);
  assert.match(decoded, /Caf./);
});

test('a Cyrillic file survives as text rather than as diamonds', () => {
  const cyrillic = new Uint8Array(Buffer.from('Привет мир, как дела сегодня', 'utf8'));
  assert.doesNotMatch(decodeSubtitle(cyrillic), /�/);
});

// --- SubRip ----------------------------------------------------------------

test('SubRip gains a header and dotted timestamps', () => {
  const vtt = srtToVtt('1\n00:00:41,330 --> 00:00:43,400\nHello\n');
  assert.match(vtt, /^WEBVTT/);
  assert.match(vtt, /00:00:41\.330 --> 00:00:43\.400/);
});

// --- SubStation Alpha ------------------------------------------------------

const ASS = `[Script Info]
Title: Example
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize
Style: Default,Arial,20

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.50,0:00:03.25,Default,,0,0,0,,{\\an8\\c&HFFFFFF&}Hello, world
Dialogue: 0,0:00:04.00,0:00:06.00,Default,,0,0,0,,First line\\NSecond line
Dialogue: 0,0:00:07.00,0:00:08.00,Default,,0,0,0,,{\\p1}m 0 0 l 100 0 100 100
Comment: 0,0:00:09.00,0:00:10.00,Default,,0,0,0,,not a cue
`;

test('ASS becomes WebVTT with padded, millisecond timestamps', () => {
  // ASS writes one hour digit and centiseconds; WebVTT wants two and
  // milliseconds, and silently drops any cue that says otherwise.
  const vtt = assToVtt(ASS);
  assert.match(vtt, /^WEBVTT/);
  assert.match(vtt, /00:00:01\.500 --> 00:00:03\.250/);
});

test('override tags are stripped but the dialogue is not', () => {
  // `{\an8\c&HFFFFFF&}` is positioning and colour. WebVTT cannot express most
  // of it, and a styled-but-wrong cue is worse than a plain correct one.
  const vtt = assToVtt(ASS);
  assert.match(vtt, /Hello, world/);
  assert.doesNotMatch(vtt, /\\an8|&HFFFFFF/);
});

test('text containing a comma is not truncated at it', () => {
  // `Dialogue:` fields are comma-separated and `Text` is last, so an unbounded
  // split loses everything after the first comma in the line.
  assert.match(assToVtt(ASS), /Hello, world/);
});

test('`\\N` becomes a real line break', () => {
  assert.match(assToVtt(ASS), /First line\nSecond line/);
});

test('drawing commands are dropped rather than rendered as dialogue', () => {
  // `\p1` switches to vector drawing mode; the "text" is a coordinate list.
  // Printing it puts a wall of numbers over the picture.
  assert.doesNotMatch(assToVtt(ASS), /m 0 0 l 100 0/);
});

test('Comment lines are not cues', () => {
  assert.doesNotMatch(assToVtt(ASS), /not a cue/);
});

test('the Format line is read, not assumed', () => {
  // ASS declares its field order per file. Hard-coded indices work on most
  // files and silently mistime or blank the rest.
  const reordered = `[Events]
Format: Start, End, Text
Dialogue: 0:00:02.00,0:00:04.00,Reordered fields
`;
  const vtt = assToVtt(reordered);
  assert.match(vtt, /00:00:02\.000 --> 00:00:04\.000/);
  assert.match(vtt, /Reordered fields/);
});

// --- dispatch --------------------------------------------------------------

test('the format is decided by content, not by the URL', () => {
  // Provider subtitle links routinely have no extension, or the wrong one.
  assert.match(toWebVtt(ASS), /00:00:01\.500/);
  assert.match(toWebVtt('1\n00:00:01,000 --> 00:00:02,000\nSrt\n'), /00:00:01\.000/);
});

test('WebVTT is passed through rather than converted again', () => {
  const already = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nAlready\n';
  assert.equal(toWebVtt(already), already);
});

test('an ASS file with no Script Info header is still recognised', () => {
  const bare = '[Events]\nFormat: Start, End, Text\nDialogue: 0:00:01.00,0:00:02.00,Bare\n';
  assert.match(toWebVtt(bare), /00:00:01\.000 --> 00:00:02\.000/);
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
