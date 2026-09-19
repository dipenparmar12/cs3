import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Hls from 'hls.js';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Play,
  RotateCcw,
  X,
} from 'lucide-react';

import type { TitleVideo } from '../../types/metadata';
import {
  buildTrailerQueue,
  current as currentOf,
  step,
  upNext,
  type TrailerQueue,
} from '../../utils/trailerQueue';
import { describeError } from '../../utils/errors';

/**
 * Trailers, in a window of their own.
 *
 * ## Why this is not the player
 *
 * A trailer used to open `VideoPlayer` — the full-bleed surface, the source
 * panel, the failover ladder, the floating modes, the episode list — as a
 * `PlaybackRequest` carrying `promo: true`. Everything that would have been
 * wrong for a promo was absent rather than suppressed, so it was *correct*, and
 * it was still the wrong answer: a two-minute teaser took over the app exactly
 * as the film does, spending the one signal that says "this is the thing you
 * chose to watch" on something nobody chose to watch. Getting back to the page
 * being read meant leaving playback.
 *
 * So this is a dialog, it is deliberately small, and it carries the browser's
 * own controls rather than a copy of the player's. That last part is the
 * separation and not a shortcut: a control bar that looks like the player's
 * invites every expectation the player sets — pick a source, download this,
 * resume where I left off, play the next episode — and not one of them is true
 * here.
 *
 * ## What it keeps, because these rules are not negotiable
 *
 * **`media:prepare` is still the only source of a playable URL** (INV-RACE-1).
 * `videos:resolve` answers with a provider-level, proxied address; it is
 * classified here exactly as a chosen source is, nothing is assigned to the
 * element before that answer arrives, and nothing is decided from the URL
 * string. A `NATIVE_MPV` verdict is reported rather than assigned — Chromium
 * would take the URL, fail, and report as broken a stream mpv opens without
 * comment — though `bestPromoStream` prefers a pre-muxed H.264/AAC rung
 * precisely so that verdict is not reached for a trailer.
 *
 * **A prepared session is closed when it is left.** A promo whose two halves
 * were muxed holds an ffmpeg process, and stepping through six trailers without
 * closing them holds six.
 *
 * ## Autoplay
 *
 * On `ended` the next entry is *offered*, with a five-second countdown. The
 * countdown is what makes it an offer: a trailer ending is the moment somebody
 * decides whether they are still watching, and a popup that answers for them is
 * one they have to go and interrupt. Which entry is next — and the two places
 * the queue refuses to go — is `trailerQueue.ts`, where it is tested.
 */

/** Where the current entry has got to. One entry, one state. */
type Stage =
  | { phase: 'resolving' }
  | { phase: 'ready'; url: string; isHls: boolean }
  | { phase: 'error'; message: string; needsComponents?: boolean };

const AUTOPLAY_SECONDS = 5;

export const TrailerPopup: React.FC<{
  /** Everything the gallery drew, so the queue matches what is on screen. */
  videos: TitleVideo[];
  /** The card that was pressed. */
  startId: string;
  /** The film or series, for the dialog's second line. */
  titleName?: string;
  onClose: () => void;
}> = ({ videos, startId, titleName, onClose }) => {
  /**
   * Built once, from the list as it stood when the card was pressed. Extended
   * metadata arrives in pieces, so rebuilding it on every update would let a
   * late source reorder the rail underneath somebody halfway through it.
   */
  const [queue, setQueue] = useState<TrailerQueue>(() => buildTrailerQueue(videos, startId));
  const video = currentOf(queue);
  const next = useMemo(() => upNext(queue), [queue]);
  const previous = useMemo(() => step(queue, -1), [queue]);

  const [stage, setStage] = useState<Stage>({ phase: 'resolving' });
  const [attempt, setAttempt] = useState(0);
  const [autoplay, setAutoplay] = useState(true);
  /** Counts down after `ended`; null whenever nothing is queued up. */
  const [countdown, setCountdown] = useState<number | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);

  const go = useCallback((delta: number) => {
    setQueue((held) => step(held, delta) ?? held);
    setCountdown(null);
    setAttempt(0);
  }, []);

  // Escape closes, consumed in the capture phase so it stops here — see
  // `useDismissable` for how a bubbling Escape came to end playback.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  // The viewer's stored level, read and never written: a trailer is not where
  // somebody decides how loud films are, and a film at 30% followed by a teaser
  // at 100% is the whole reason this is read at all.
  useEffect(() => {
    void (async () => {
      const response = await window.cloudstream?.getPlayerPreferences?.();
      const element = videoRef.current;
      if (!response?.ok || !element) return;
      element.volume = Math.min(1, Math.max(0, response.preferences.volume));
      element.muted = response.preferences.muted;
    })();
  }, []);

  /** Resolve, then classify. Nothing is attached until both have answered. */
  useEffect(() => {
    if (!video) return;
    let cancelled = false;
    let opened = '';
    setStage({ phase: 'resolving' });
    setCountdown(null);

    void (async () => {
      const api = window.cloudstream;
      try {
        const resolved = await api?.resolvePromoVideo?.(video.url);
        if (cancelled) return;
        if (!resolved?.ok || !resolved.streamUrl) {
          setStage({
            phase: 'error',
            // Named, never silent. A missing component is an install and a
            // removed video is nothing: two actions, two sentences.
            message: resolved?.needsComponents
              ? 'Playing trailers needs yt-dlp, which Settings → Components can install.'
              : (resolved?.error ?? 'That trailer could not be opened.'),
            needsComponents: resolved?.needsComponents,
          });
          return;
        }

        const prepared = await api?.preparePlaybackStream({
          url: resolved.streamUrl,
          isM3u8: resolved.isM3u8,
          isDash: resolved.isDash,
        });
        if (cancelled) {
          if (prepared?.sessionId) void api?.closePlaybackStream(prepared.sessionId);
          return;
        }
        if (!prepared?.ok || !prepared.playbackUrl) {
          setStage({
            phase: 'error',
            message: prepared?.error ?? 'This trailer could not be prepared for playback.',
            needsComponents: prepared?.needsComponents,
          });
          return;
        }

        opened = prepared.sessionId ?? '';
        const strategy = prepared.capability.requiredStrategy;
        if (strategy === 'NATIVE_MPV') {
          // Assigning it anyway is the bug this branch exists to avoid: the
          // element fails on a stream the native engine plays perfectly, and
          // the trailer is reported broken.
          setStage({
            phase: 'error',
            message: 'This video needs the native player, which trailers do not use.',
          });
          return;
        }

        setStage({
          phase: 'ready',
          url: prepared.playbackUrl,
          // From the classification, never from the address: providers serve
          // playlists from `.php` URLs and from URLs with no extension at all.
          isHls: strategy === 'HLS_NATIVE' || prepared.capability.transport === 'hls',
        });
      } catch (error) {
        if (!cancelled) setStage({ phase: 'error', message: describeError(error) });
      }
    })();

    return () => {
      cancelled = true;
      if (opened) void window.cloudstream?.closePlaybackStream(opened);
    };
  }, [video, attempt]);

  /** Attach. Only ever reached with a classified URL in hand (INV-RACE-1). */
  useEffect(() => {
    const element = videoRef.current;
    if (!element || stage.phase !== 'ready') return;

    let hls: Hls | null = null;
    if (stage.isHls && Hls.isSupported()) {
      hls = new Hls({ enableWorker: true });
      hls.loadSource(stage.url);
      hls.attachMedia(element);
    } else {
      element.src = stage.url;
    }
    void element.play().catch(() => {
      /* Autoplay can be refused; the controls are right there. */
    });

    return () => {
      hls?.destroy();
      if (!hls) {
        element.removeAttribute('src');
        element.load();
      }
    };
  }, [stage]);

  /**
   * The countdown, armed by `ended` and disarmed by anything the viewer does.
   *
   * `go` clears it, so pressing Next, Previous or Cancel during the count
   * cannot also fire the advance a second later.
   */
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      go(1);
      return;
    }
    const timer = setTimeout(
      () => setCountdown((left) => (left === null ? null : left - 1)),
      1000
    );
    return () => clearTimeout(timer);
  }, [countdown, go]);

  const handleEnded = useCallback(() => {
    if (autoplay && next) setCountdown(AUTOPLAY_SECONDS);
  }, [autoplay, next]);

  if (!video) return null;

  const position =
    queue.videos.length > 1 ? `${queue.index + 1} of ${queue.videos.length}` : null;
  const context = [titleName, position].filter(Boolean).join(' · ');

  return (
    <div className="modal-backdrop trailer-popup__backdrop" role="presentation" onClick={onClose}>
      <div
        className="trailer-popup"
        role="dialog"
        aria-modal="true"
        aria-label={`${video.label}${titleName ? ` — ${titleName}` : ''}`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="trailer-popup__head">
          <div className="trailer-popup__titles">
            {/* The label is what the video is; the publisher's full title,
                which usually repeats the film's name, is the tooltip. */}
            <strong className="trailer-popup__label" title={video.title}>
              {video.label}
            </strong>
            {context && <span className="trailer-popup__context">{context}</span>}
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-icon"
            onClick={onClose}
            title="Close (Esc)"
            aria-label="Close trailer"
          >
            <X size={15} />
          </button>
        </header>

        <div className="trailer-popup__stage">
          {/* One element for the whole queue: remounting per entry throws away
              the volume and the mute the viewer has just set. */}
          <video
            ref={videoRef}
            className="trailer-popup__video"
            controls
            playsInline
            onEnded={handleEnded}
            onError={() =>
              setStage((held) =>
                held.phase === 'ready'
                  ? { phase: 'error', message: 'This trailer would not play.' }
                  : held
              )
            }
          />

          {stage.phase === 'resolving' && (
            <div className="trailer-popup__overlay" role="status">
              <Loader2 size={20} className="spin" />
              <span>Getting the trailer…</span>
            </div>
          )}

          {stage.phase === 'error' && (
            <div className="trailer-popup__overlay trailer-popup__overlay--error" role="alert">
              <AlertTriangle size={20} />
              <span>{stage.message}</span>
              {!stage.needsComponents && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setAttempt((count) => count + 1)}
                >
                  <RotateCcw size={13} /> Try again
                </button>
              )}
            </div>
          )}

          {countdown !== null && next && (
            <div className="trailer-popup__overlay trailer-popup__overlay--next" role="status">
              <span className="trailer-popup__next-heading">Up next</span>
              <strong className="trailer-popup__next-label">{next.label}</strong>
              <div className="trailer-popup__next-actions">
                <button type="button" className="btn btn-primary btn-sm" onClick={() => go(1)}>
                  <Play size={13} /> Play now
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setCountdown(null)}
                >
                  Cancel
                </button>
              </div>
              <span className="trailer-popup__countdown">Starting in {countdown}s</span>
            </div>
          )}
        </div>

        <footer className="trailer-popup__foot">
          <div className="trailer-popup__steps">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => go(-1)}
              disabled={!previous}
            >
              <ChevronLeft size={14} /> Previous
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => go(1)}
              disabled={!next}
            >
              Next <ChevronRight size={14} />
            </button>
          </div>

          {/* Stated rather than implied: a video starting on its own with
              nothing having said it would is the surprise this label removes. */}
          <label className="trailer-popup__autoplay">
            <input
              type="checkbox"
              checked={autoplay}
              onChange={(event) => {
                setAutoplay(event.target.checked);
                if (!event.target.checked) setCountdown(null);
              }}
            />
            <span>{next ? `Autoplay — up next: ${next.label}` : 'Autoplay'}</span>
          </label>
        </footer>
      </div>
    </div>
  );
};
