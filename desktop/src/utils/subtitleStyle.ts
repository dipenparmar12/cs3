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
export type SubtitleHorizontalAlign = 'left' | 'center' | 'right';
export type SubtitleVerticalAlign = 'bottom' | 'center' | 'top';

export interface SubtitlePosition {
  /** Horizontal anchor: 0.0 (left) to 1.0 (right), 0.5 = center */
  x: number;
  /** Vertical distance from bottom edge: 0.0 (bottom) to 1.0 (top) */
  y: number;
  horizontalAlignment: SubtitleHorizontalAlign;
  verticalAlignment: SubtitleVerticalAlign;
}

export interface SubtitlePositionAdapter {
  getPosition(): SubtitlePosition;
  setPosition(pos: SubtitlePosition): Promise<void>;
  resetPosition(): Promise<void>;
  supportsDirectPositioning(): boolean;
}

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
  /** Opacity of the background box (0.0–1.0) when `background === 'box'`. */
  boxOpacity?: number;
  /** Line height multiplier (e.g. 1.1, 1.3, 1.5). */
  lineHeight?: number;
  /** Horizontal cue alignment. */
  horizontalAlign?: SubtitleHorizontalAlign;
  /** Normalized horizontal anchor (0.05–0.95, 0.5 = center). */
  positionX?: number;
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
  boxOpacity: 0.75,
  lineHeight: 1.3,
  horizontalAlign: 'center',
  positionX: 0.5,
};

export interface SubtitlePreset {
  id: string;
  label: string;
  description: string;
  patch: Partial<SubtitleStyle>;
}

/** Four ready-to-use presets covering common viewing conditions (PRD §5.1). */
export const SUBTITLE_PRESETS: ReadonlyArray<SubtitlePreset> = [
  {
    id: 'white-outline',
    label: 'White Outline',
    description: 'Clean white text with 4-way dark outline',
    patch: { color: '#ffffff', background: 'outline', weight: 'normal', scale: 1 },
  },
  {
    id: 'dark-box',
    label: 'Dark Box',
    description: 'High readability over bright scenes',
    patch: { color: '#ffffff', background: 'box', weight: 'normal', boxOpacity: 0.75 },
  },
  {
    id: 'high-contrast-yellow',
    label: 'Yellow High Contrast',
    description: 'Bold yellow with outline for fast scanning',
    patch: { color: '#f2e14c', background: 'outline', weight: 'bold', scale: 1.15 },
  },
  {
    id: 'soft-shadow',
    label: 'Soft Shadow',
    description: 'Minimal off-white with subtle drop shadow',
    patch: { color: '#d7dae0', background: 'shadow', weight: 'normal', scale: 1 },
  },
];

export const SUBTITLE_LINE_HEIGHTS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1.1, label: 'Compact' },
  { value: 1.3, label: 'Normal' },
  { value: 1.5, label: 'Spacious' },
];

/**
 * Bitmap subtitle formats (PGS / VOBSUB) render as pre-baked pixel images,
 * so font styling and free repositioning cannot be applied to them.
 */
export function isBitmapSubtitleTrack(trackLabelOrCodec?: string): boolean {
  if (!trackLabelOrCodec) return false;
  return /\b(pgs|hdmv_pgs_subtitle|vobsub|dvd_subtitle|dvdsub|bitmap)\b/i.test(trackLabelOrCodec);
}

/** ASS/SSA tracks carry embedded vector styling and coordinates. */
export function isAssSubtitleTrack(trackLabelOrCodec?: string): boolean {
  if (!trackLabelOrCodec) return false;
  return /\b(ass|ssa)\b|\.ass\b|\.ssa\b/i.test(trackLabelOrCodec);
}

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

  const boxOpacity = Math.max(0, Math.min(1, style.boxOpacity ?? 0.75));
  const lineHeight = style.lineHeight ?? 1.3;
  const horizontalAlign = style.horizontalAlign ?? 'center';
  const positionX = Math.max(0.05, Math.min(0.95, style.positionX ?? 0.5));
  const shiftXPercent = Math.round((positionX - 0.5) * 100);

  return {
    '--cue-scale': String(style.scale),
    '--cue-color': style.color,
    '--cue-shadow': shadow,
    '--cue-bg': style.background === 'box' ? `rgba(0, 0, 0, ${boxOpacity})` : 'transparent',
    '--cue-weight': style.weight === 'bold' ? '700' : '400',
    '--cue-lift': `${style.position}%`,
    '--cue-shift-x': `${shiftXPercent}%`,
    '--cue-line-height': String(lineHeight),
    '--cue-align': horizontalAlign,
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
export const MPV_BASE_SUB_FONT_SIZE = 42;

export function subtitleMpvProperties(style: SubtitleStyle): Record<string, unknown> {
  const boxOpacity = Math.max(0, Math.min(1, style.boxOpacity ?? 0.75));
  const alphaHex = Math.round(boxOpacity * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();
  const horizontalAlign = style.horizontalAlign ?? 'center';
  const positionX = Math.max(0.05, Math.min(0.95, style.positionX ?? 0.5));
  const marginX = horizontalAlign === 'center' ? Math.round(Math.abs(positionX - 0.5) * 200) : 28;

  return {
    'sub-font-size': Math.round(MPV_BASE_SUB_FONT_SIZE * style.scale),
    'sub-color': style.color,
    'sub-bold': style.weight === 'bold',
    'sub-border-size': style.background === 'outline' ? 3 : style.background === 'shadow' ? 1 : 0,
    'sub-shadow-offset': style.background === 'shadow' ? 2 : 0,
    'sub-back-color': style.background === 'box' ? `#${alphaHex}000000` : '#00000000',
    // mpv measures from the bottom in the same direction the CSS lift does, so
    // one number drives both without a sign flip to get wrong.
    'sub-pos': Math.round(100 - style.position),
    'sub-align-x': horizontalAlign,
    'sub-margin-x': marginX,
    'sub-ass-override': 'yes',
  };
}
