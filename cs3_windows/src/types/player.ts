import type { ExtractorLink, SubtitleFile } from './api';

export enum PlaybackBackend {
  Web = 'WebBackend (HTML5/MSE)',
  Native = 'NativeBackend (MPV/VLC)',
}

export enum AspectRatioMode {
  Fit = 'Fit',
  Crop = 'Crop',
  Stretch = 'Stretch',
  SixteenNine = '16:9',
  FourThree = '4:3',
}

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
