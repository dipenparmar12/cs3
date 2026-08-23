/**
 * The two renderers have to agree.
 *
 * One stored record drives CSS `::cue` for the browser path and mpv properties
 * for the native one, and the failure this pins is silent: a viewer sets a size
 * and a colour, the engine routes a 4K HEVC file to mpv on its own, and the
 * subtitles come back a different size with none of the styling. Nothing
 * errors. The two mappings simply drifted.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_SUBTITLE_STYLE,
  SUBTITLE_BACKGROUNDS,
  subtitleCssVariables,
  subtitleMpvProperties,
  type SubtitleStyle,
} from './subtitleStyle.ts';

const style = (patch: Partial<SubtitleStyle> = {}): SubtitleStyle => ({
  ...DEFAULT_SUBTITLE_STYLE,
  ...patch,
});

// --- the default ------------------------------------------------------------

test('the default is an outline, which costs no picture', () => {
  assert.equal(DEFAULT_SUBTITLE_STYLE.background, 'outline');
  const css = subtitleCssVariables(DEFAULT_SUBTITLE_STYLE);
  // A box would hide the bottom of the frame whether or not anything behind it
  // needed hiding; the default must not do that.
  assert.equal(css['--cue-bg'], 'transparent');
  assert.notEqual(css['--cue-shadow'], 'none');
});

test('an unscaled default maps to mpv’s own default size', () => {
  // 55 is mpv's default against its 720-line reference frame. If 1.0 meant
  // anything else, switching engines mid-title would resize the text.
  assert.equal(subtitleMpvProperties(DEFAULT_SUBTITLE_STYLE)['sub-font-size'], 55);
});

// --- size -------------------------------------------------------------------

test('scale multiplies rather than replacing the browser default', () => {
  // `calc(1em * scale)` keeps the browser's viewport-based sizing and multiplies
  // it. A fixed pixel size would be wrong at every other window size.
  assert.equal(subtitleCssVariables(style({ scale: 1.5 }))['--cue-scale'], '1.5');
});

test('scale moves both renderers in the same direction', () => {
  const big = subtitleMpvProperties(style({ scale: 2 }))['sub-font-size'] as number;
  const small = subtitleMpvProperties(style({ scale: 0.75 }))['sub-font-size'] as number;
  assert.ok(big > 55 && small < 55, `expected 55 to sit between ${small} and ${big}`);
});

// --- background modes -------------------------------------------------------

test('every offered background produces a distinct browser rendering', () => {
  const seen = new Set<string>();
  for (const option of SUBTITLE_BACKGROUNDS) {
    const css = subtitleCssVariables(style({ background: option.value }));
    seen.add(`${css['--cue-bg']}|${css['--cue-shadow']}`);
  }
  // Four options that render identically would be four ways to change nothing.
  assert.equal(seen.size, SUBTITLE_BACKGROUNDS.length);
});

test('only the box mode paints over the picture', () => {
  for (const option of SUBTITLE_BACKGROUNDS) {
    const bg = subtitleCssVariables(style({ background: option.value }))['--cue-bg'];
    if (option.value === 'box') assert.notEqual(bg, 'transparent');
    else assert.equal(bg, 'transparent');
  }
});

test('none really means none, in both renderers', () => {
  const css = subtitleCssVariables(style({ background: 'none' }));
  assert.equal(css['--cue-shadow'], 'none');
  assert.equal(css['--cue-bg'], 'transparent');

  const mpv = subtitleMpvProperties(style({ background: 'none' }));
  assert.equal(mpv['sub-border-size'], 0);
  assert.equal(mpv['sub-shadow-offset'], 0);
});

test('outline is a border in mpv, not a shadow', () => {
  const mpv = subtitleMpvProperties(style({ background: 'outline' }));
  assert.ok((mpv['sub-border-size'] as number) > 0);
  assert.equal(mpv['sub-shadow-offset'], 0);
});

// --- colour and weight ------------------------------------------------------

test('the chosen colour reaches both renderers unchanged', () => {
  assert.equal(subtitleCssVariables(style({ color: '#f2e14c' }))['--cue-color'], '#f2e14c');
  assert.equal(subtitleMpvProperties(style({ color: '#f2e14c' }))['sub-color'], '#f2e14c');
});

test('bold is carried, not dropped on the native path', () => {
  assert.equal(subtitleCssVariables(style({ weight: 'bold' }))['--cue-weight'], '700');
  assert.equal(subtitleMpvProperties(style({ weight: 'bold' }))['sub-bold'], true);
  assert.equal(subtitleMpvProperties(style({ weight: 'normal' }))['sub-bold'], false);
});

// --- position ---------------------------------------------------------------

test('raising cues moves them the same way in both renderers', () => {
  // CSS lifts by a percentage; mpv counts `sub-pos` down from 100. A sign flip
  // here would send the two engines in opposite directions.
  assert.equal(subtitleCssVariables(style({ position: 15 }))['--cue-lift'], '15%');
  assert.equal(subtitleMpvProperties(style({ position: 15 }))['sub-pos'], 85);
});

test('the default position is the bottom of the frame in both', () => {
  assert.equal(subtitleCssVariables(style({ position: 0 }))['--cue-lift'], '0%');
  assert.equal(subtitleMpvProperties(style({ position: 0 }))['sub-pos'], 100);
});
