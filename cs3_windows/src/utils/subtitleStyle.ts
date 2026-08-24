/**
 * How subtitles are drawn, in one place because two renderers need it.
 *
 * Default `<track>` rendering is small white text with no separation from the
 * picture, which disappears entirely over anything bright — snow, a white wall,
 * credits on a light background. Android has shipped a caption editor for years
 * and it is among the most-adjusted screens in that app; having nothing here
 * made subtitles something to endure rather than read.
 *
 * The settings are stored as numbers and enums rather than a composed CSS
 * string because the browser path styles `::cue` and the native path sets mpv
 * properties, and those two have no syntax in common. Deriving both from one
 * record is what stops them drifting apart — a viewer who sets 1.4x and then
 * routes a 4K HEVC file to mpv must not watch the subtitles change size.
 */

export type SubtitleBackground = 'none' | 'shadow' | 'outline' | 'box';
export type SubtitleWeight = 'normal' | 'bold';

export interface SubtitleStyle {
  /** Multiplier on the base cue size. */
  scale: number;
  /** `#rrggbb`. */
  color: string;
  /** How a cue is separated from the picture behind it. */
  background: SubtitleBackground;
  weight: SubtitleWeight;
  /** Percent of frame height to lift cues by. */
  position: number;
}

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  scale: 1,
  color: '#ffffff',
  /**
   * An outline, not a box.
   *
   * A box is the most legible option and also the most intrusive — it covers
   * the bottom of the frame whether or not anything behind it needed hiding.
   * An outline reads cleanly over almost everything and costs no picture, which
   * makes it the right default even though it is not the most readable setting
   * available.
   */
  background: 'outline',
  weight: 'normal',
  position: 0,
};

export const SUBTITLE_SCALES = [0.75, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2] as const;

/** Presets, because a colour picker is a poor control for four real choices. */
export const SUBTITLE_COLORS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '#ffffff', label: 'White' },
  { value: '#f2e14c', label: 'Yellow' },
  { value: '#d7dae0', label: 'Grey' },
  { value: '#8ce99a', label: 'Green' },
];

export const SUBTITLE_BACKGROUNDS: ReadonlyArray<{
  value: SubtitleBackground;
  label: string;
  hint: string;
}> = [
  { value: 'outline', label: 'Outline', hint: 'Readable over most scenes, covers nothing' },
  { value: 'shadow', label: 'Shadow', hint: 'Softer, less separation on busy pictures' },
  { value: 'box', label: 'Box', hint: 'Most readable, hides part of the frame' },
  { value: 'none', label: 'None', hint: 'Plain text — hard to read over bright scenes' },
];

/**
 * The tokens the stylesheet's `::cue` rules read.
 *
 * Returned as a plain object so it can be spread into an existing inline style
 * without the caller knowing which properties exist.
 */
export function subtitleCssVariables(style: SubtitleStyle): Record<string, string> {
  const shadow =
    style.background === 'outline'
      ? // Four offsets rather than `-webkit-text-stroke`, which thins glyphs by
        // drawing the stroke inside the letterform and makes small text worse
        // exactly where the outline was supposed to help.
        '-1px -1px 2px #000, 1px -1px 2px #000, -1px 1px 2px #000, 1px 1px 2px #000'
      : style.background === 'shadow'
        ? '0 2px 4px rgba(0, 0, 0, 0.9)'
        : 'none';

  return {
    '--cue-scale': String(style.scale),
    '--cue-color': style.color,
    '--cue-shadow': shadow,
    '--cue-bg': style.background === 'box' ? 'rgba(0, 0, 0, 0.75)' : 'transparent',
    '--cue-weight': style.weight === 'bold' ? '700' : '400',
    '--cue-lift': `${style.position}%`,
  };
}

/**
 * The same record as mpv properties.
 *
 * mpv sizes subtitles against a 720-line reference frame, so its default of 55
 * is the number our 1.0 has to mean; anything else and switching engines
 * mid-title would resize the text. `sub-border-size` of 0 is how "no outline"
 * is expressed — mpv has no separate toggle.
 */
export function subtitleMpvProperties(style: SubtitleStyle): Record<string, unknown> {
  return {
    'sub-font-size': Math.round(55 * style.scale),
    'sub-color': style.color,
    'sub-bold': style.weight === 'bold',
    'sub-border-size': style.background === 'outline' ? 3 : style.background === 'shadow' ? 1 : 0,
    'sub-shadow-offset': style.background === 'shadow' ? 2 : 0,
    'sub-back-color': style.background === 'box' ? '#000000BF' : '#00000000',
    // mpv measures from the bottom in the same direction the CSS lift does, so
    // one number drives both without a sign flip to get wrong.
    'sub-pos': Math.round(100 - style.position),
  };
}
