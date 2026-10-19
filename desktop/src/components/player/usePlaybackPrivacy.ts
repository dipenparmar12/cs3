import { useCallback, useEffect, useMemo, useRef } from 'react';
import { isAdultMedia, type AdultCheckable } from '../../utils/adultContent';
import { revealAdultItem, useAdultState } from '../../utils/useAdultMode';
import { playbackPrivacy, privacyAction, refusePlayback, type PlaybackPrivacy } from './playbackPrivacy';

interface PlaybackPrivacyOptions {
  /** What the player knows about the title; classified by the same rule as its poster. */
  media: AdultCheckable;
  /** What a per-video reveal is stored under. */
  itemKey: string;
  video: React.RefObject<HTMLVideoElement | null>;
  /** The native engine holds the stream, so the element has nothing to hide. */
  isNativeEngine: boolean;
  isPlaying: boolean;
  /** On screen, not stepped out to another screen. */
  inFront: boolean;
  pause: () => void;
  resume: () => void;
}

export interface PlaybackPrivacyState {
  state: PlaybackPrivacy;
  /** The viewer's Play on a protected video: reveals this video only, then plays. */
  requestPlay: () => void;
}

/**
 * Applies the privacy verdict to whichever engine holds the stream.
 *
 * The `<video>` element is never remounted or reloaded: it is paused, `play()`
 * is refused on the instance while the verdict is not `open` (so no call site
 * has to know, and no sound starts before a frame is hidden), and the caller
 * blurs it in the same render that the verdict changes. The native engine has
 * no CSS to lean on, so its video track is dropped — mpv closes the window and
 * stops decoding — and brought back only on `open`.
 */
export function usePlaybackPrivacy(options: PlaybackPrivacyOptions): PlaybackPrivacyState {
  const { media, itemKey, video, isNativeEngine } = options;
  const adult = useAdultState();
  const adultMedia = isAdultMedia(media, adult.adultProviders);
  const state = playbackPrivacy(adultMedia, adult, itemKey);

  const latest = useRef(options);
  latest.current = options;
  const previous = useRef<PlaybackPrivacy>(state);
  const ownsPause = useRef(false);
  const wantsPlay = useRef(false);

  useEffect(() => {
    const was = previous.current;
    previous.current = state;
    const { isPlaying, inFront, pause, resume } = latest.current;
    const action = privacyAction(was, state, {
      playing: isPlaying,
      ownsPause: ownsPause.current,
      wantsPlay: wantsPlay.current,
      inFront,
    });

    if (state !== 'open') {
      if (action === 'pause') {
        ownsPause.current = true;
        pause();
      }
      if (isNativeEngine) void window.cloudstream?.setMpvVideoEnabled?.(false);
      return;
    }

    const shouldResume = action === 'resume';
    ownsPause.current = false;
    wantsPlay.current = false;
    if (isNativeEngine && was !== 'open') {
      // The window comes back before the film moves, or the first frames play to nobody.
      void Promise.resolve(window.cloudstream?.setMpvVideoEnabled?.(true)).then(() => {
        if (shouldResume) resume();
      });
    } else if (shouldResume) {
      resume();
    }
  }, [state, isNativeEngine]);

  // The element path: refuse play() on the instance and re-pause anything that starts anyway.
  useEffect(() => {
    const element = video.current;
    if (!element || state === 'open') return;
    return refusePlayback(element);
  }, [state, video]);

  const requestPlay = useCallback(() => {
    if (state !== 'protected') return;
    wantsPlay.current = true;
    revealAdultItem(itemKey);
  }, [state, itemKey]);

  // Stable between renders: callers put it in dependency lists.
  return useMemo(() => ({ state, requestPlay }), [state, requestPlay]);
}
