import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The three ways a film can keep playing while the user does something else,
 * and the rule for which one applies.
 *
 * ## Why there are three and not one
 *
 * They are not variations on a theme; they are different mechanisms with
 * different reach, and each is the *only* answer in some situation:
 *
 * | Mechanism | Moves | Works when |
 * |---|---|---|
 * | In-app mini player | nothing — a CSS geometry change | always, but only while this app is the front window |
 * | Native Picture-in-Picture | the `<video>` element's rendering surface, to an OS window | only while the element is what is playing |
 * | App window always-on-top | a window level | always, whatever is inside the window |
 * | mpv `ontop` | a window level | only while the native engine holds the stream |
 *
 * The middle row is the reason this is not simply "pin the window". PiP is what
 * people mean when they say "like Chrome does it" — a small OS window with the
 * system's own controls, resizable, outliving the app losing focus, and
 * genuinely above full-screen applications. It is also unavailable for exactly
 * the content this app most often plays: a stream routed to mpv renders in
 * mpv's window and a handoff to VLC renders in VLC's, and neither has a
 * `<video>` element to detach. So PiP is offered when it can work and the
 * window pin is what makes the feature exist for everything else.
 *
 * ## What is load-bearing
 *
 * **The element is never remounted.** Entering PiP moves where the surface is
 * composited; the element stays exactly where it is in the React tree. That is
 * the same rule the in-app mini player follows and for the same reason —
 * recreating the element ends the stream, loses the position, and renegotiates
 * the swarm. Anything here that unmounts the video to change how it floats has
 * broken the feature it was adding.
 *
 * **PiP is asked for, never assumed.** `requestPictureInPicture` rejects for
 * several ordinary reasons — no metadata yet, no video track, a user gesture
 * requirement, the platform simply not supporting it — and a rejection has to
 * come back as a sentence rather than as an unhandled promise. `isSupported`
 * reflects what the document says it can do; `error` reflects what actually
 * happened when we tried.
 *
 * **The Media Session is set, or the PiP window is mute chrome.** A native PiP
 * window draws its own play/pause and next/previous buttons and wires them to
 * `navigator.mediaSession` action handlers. Without handlers those controls are
 * either absent or dead, which reads as the floating player being broken rather
 * than as metadata being missing — and the OS also uses the same record for the
 * media keys on the keyboard, which people expect to work.
 */

export type FloatingMode = 'mini' | 'floating' | 'pip' | 'background';
export type BackgroundPlayback = 'continue' | 'audio-only' | 'pause';

export interface FloatingPlayerOptions {
  video: React.RefObject<HTMLVideoElement | null>;
  /** True while the player is minimised, hidden, or otherwise out of the way. */
  isFloating: boolean;
  mode: FloatingMode;
  backgroundPlayback: BackgroundPlayback;
  alwaysOnTop: boolean;
  /** The native engine is holding the stream, so the element has nothing to detach. */
  isNativeEngine: boolean;
  /** For the Media Session record the OS and the PiP window read. */
  metadata: { title: string; subtitle?: string; artwork?: string };
  /** Transport, so the PiP window's own buttons and the media keys reach us. */
  controls: {
    play: () => void;
    pause: () => void;
    seekBy: (seconds: number) => void;
    seekTo?: (seconds: number) => void;
    next?: () => void;
    previous?: () => void;
  };
}

export interface FloatingPlayerState {
  /** This build and this element can enter Picture-in-Picture. */
  isPipSupported: boolean;
  isPip: boolean;
  /** Why the last attempt did not work. Cleared by the next successful one. */
  error: string | null;
  enterPip: () => Promise<void>;
  exitPip: () => Promise<void>;
  togglePip: () => Promise<void>;
}

export function useFloatingPlayer(options: FloatingPlayerOptions): FloatingPlayerState {
  const { video, isFloating, mode, backgroundPlayback, alwaysOnTop, isNativeEngine } = options;
  const [isPip, setIsPip] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Support is a property of the document *and* of the element, and the element
   * half changes as a source loads: a `<video>` with no metadata yet has no
   * video track and PiP rejects. Recomputed on the events that can change it
   * rather than read once on mount.
   */
  const [isPipSupported, setIsPipSupported] = useState(false);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const update = () => {
      setIsPipSupported(
        typeof document !== 'undefined' &&
          document.pictureInPictureEnabled === true &&
          !element.disablePictureInPicture &&
          element.readyState >= 1 &&
          // A stream routed to mpv leaves the element empty on purpose; offering
          // PiP for it would produce a floating black rectangle.
          !isNativeEngine
      );
    };
    update();
    element.addEventListener('loadedmetadata', update);
    element.addEventListener('emptied', update);
    return () => {
      element.removeEventListener('loadedmetadata', update);
      element.removeEventListener('emptied', update);
    };
  }, [video, isNativeEngine]);

  /**
   * PiP can also be left from the OS window's own close button, so the flag is
   * driven by the element's events rather than by our own calls. Setting it
   * optimistically would leave the UI offering "exit" for a window the user
   * already closed.
   */
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const onEnter = () => {
      setIsPip(true);
      setError(null);
    };
    const onLeave = () => setIsPip(false);
    element.addEventListener('enterpictureinpicture', onEnter);
    element.addEventListener('leavepictureinpicture', onLeave);
    return () => {
      element.removeEventListener('enterpictureinpicture', onEnter);
      element.removeEventListener('leavepictureinpicture', onLeave);
    };
  }, [video]);

  const enterPip = useCallback(async () => {
    const element = video.current;
    if (!element) return;
    try {
      if (document.pictureInPictureElement === element) return;
      await element.requestPictureInPicture();
      setError(null);
    } catch (cause) {
      /**
       * Reported, not swallowed. The refusals are ordinary — no metadata yet,
       * no gesture, a platform without PiP — and each of them looks identical
       * from the outside: a button that does nothing.
       */
      setError(
        cause instanceof Error
          ? `The floating window could not open: ${cause.message}`
          : 'The floating window could not open.'
      );
    }
  }, [video]);

  const exitPip = useCallback(async () => {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
    } catch {
      // Leaving PiP fails only when it has already been left, which is the
      // state the caller wanted.
    }
  }, []);

  const togglePip = useCallback(async () => {
    if (document.pictureInPictureElement) await exitPip();
    else await enterPip();
  }, [enterPip, exitPip]);

  // --- the window pin ------------------------------------------------------

  /**
   * Applied whenever the floating state or the preference changes, and
   * *unapplied* on unmount.
   *
   * Leaving the app pinned above every other window after the player closed
   * would be the single most annoying thing in this file: it is not visible
   * anywhere, it survives navigation, and the control that would undo it is
   * inside a player that no longer exists.
   */
  useEffect(() => {
    const wanted = alwaysOnTop && isFloating && mode !== 'background';
    void window.cloudstream?.setWindowAlwaysOnTop?.(wanted);
    void window.cloudstream?.setMpvOnTop?.(wanted);
    return () => {
      if (wanted) {
        void window.cloudstream?.setWindowAlwaysOnTop?.(false);
        void window.cloudstream?.setMpvOnTop?.(false);
      }
    };
  }, [alwaysOnTop, isFloating, mode]);

  // --- background policy ---------------------------------------------------

  /**
   * `pause` is enforced here; `continue` is the absence of enforcement.
   *
   * `audio-only` is honest about being asymmetric. On the native engine it
   * genuinely drops the video track, which on the 4K HEVC files that get routed
   * there is real work not being done. On the `<video>` element there is
   * nothing equivalent — an offscreen element keeps decoding what it was given,
   * and re-negotiating the source to a track-less stream would be a far larger
   * change than the setting is worth — so there it means only that no picture
   * is being shown, which is already true.
   */
  const wasPlayingRef = useRef(false);
  useEffect(() => {
    const element = video.current;
    if (backgroundPlayback === 'pause') {
      if (isFloating && mode === 'background') {
        if (element && !element.paused) {
          wasPlayingRef.current = true;
          options.controls.pause();
        }
      } else if (wasPlayingRef.current) {
        // Resumed only if *we* paused it. A viewer who paused by hand before
        // walking away must not have the film start again when they come back.
        wasPlayingRef.current = false;
        options.controls.play();
      }
      return;
    }

    const audioOnly = backgroundPlayback === 'audio-only' && isFloating && mode === 'background';
    void window.cloudstream?.setMpvVideoEnabled?.(!audioOnly);
    // `options.controls` is rebuilt every render by its callers; depending on it
    // would run this on every frame of a seek.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backgroundPlayback, isFloating, mode, video]);

  // --- the Media Session record -------------------------------------------

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const session = navigator.mediaSession;
    try {
      session.metadata = new MediaMetadata({
        title: options.metadata.title,
        artist: options.metadata.subtitle,
        album: 'CloudStream',
        artwork: options.metadata.artwork
          ? [{ src: options.metadata.artwork, sizes: '512x512' }]
          : undefined,
      });
    } catch {
      // `MediaMetadata` rejects an artwork URL it cannot parse; the transport
      // handlers below are the half that matters and must still be installed.
    }

    const handlers: Array<[MediaSessionAction, MediaSessionActionHandler | null]> = [
      ['play', () => options.controls.play()],
      ['pause', () => options.controls.pause()],
      ['seekbackward', () => options.controls.seekBy(-10)],
      ['seekforward', () => options.controls.seekBy(10)],
      [
        'seekto',
        (details) => {
          if (typeof details.seekTime === 'number') options.controls.seekTo?.(details.seekTime);
        },
      ],
      ['nexttrack', options.controls.next ? () => options.controls.next?.() : null],
      ['previoustrack', options.controls.previous ? () => options.controls.previous?.() : null],
    ];

    for (const [action, handler] of handlers) {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // Not every action is implemented on every platform, and an unknown one
        // throws. One missing button is not a reason to lose the rest.
      }
    }

    return () => {
      for (const [action] of handlers) {
        try {
          session.setActionHandler(action, null);
        } catch {
          // Same as above, on the way out.
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.metadata.title, options.metadata.subtitle, options.metadata.artwork]);

  return { isPipSupported, isPip, error, enterPip, exitPip, togglePip };
}
