import type { ExtractorLink, SubtitleFile } from './api';

export const PlaybackBackend = {
  Web: 'WebBackend (HTML5/MSE)',
  Native: 'NativeBackend (MPV/VLC)',
} as const;
export type PlaybackBackend = (typeof PlaybackBackend)[keyof typeof PlaybackBackend];

export const AspectRatioMode = {
  Fit: 'Fit',
  Crop: 'Crop',
  Stretch: 'Stretch',
  SixteenNine: '16:9',
  FourThree: '4:3',
} as const;
export type AspectRatioMode = (typeof AspectRatioMode)[keyof typeof AspectRatioMode];

export interface PlaybackState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number; // 0 to 1
  isMuted: boolean;
  playbackSpeed: number; // 0.25 to 3.0
  aspectRatio: AspectRatioMode;
  isFullscreen: boolean;
  isPiP: boolean;
  activeSource?: ExtractorLink;
  activeSubtitle?: SubtitleFile;
  subtitleOffset: number; // in seconds (+/-)
  backend: PlaybackBackend;
}

/**
 * How much of an external player we can actually drive.
 *
 * `full` means commands reach it and its position comes back — our controls are
 * a real remote. `none` means the file is playing and we have no channel to it:
 * the app tracks that a handoff happened and stops there.
 *
 * Declared rather than assumed because the alternative is a seek bar that does
 * nothing. A viewer who drags it, sees no response, and concludes the app is
 * broken is worse off than one who was told plainly that this player cannot be
 * controlled from here.
 */
export type ExternalControlCapability = 'full' | 'none';

export interface ExternalPlaybackSnapshot {
  playerId: string;
  /**
   * May *downgrade* at runtime from `full` to `none` — VLC without its HTTP
   * module launches and plays perfectly while never answering a request, and
   * that is only discoverable by asking.
   */
  capability: ExternalControlCapability;
  state: 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'closed' | 'error';
  positionSeconds: number;
  durationSeconds: number;
  paused: boolean;
  /** 0–100, normalised from whatever scale the player reports natively. */
  volume: number;
  muted: boolean;
  error: string | null;
}
