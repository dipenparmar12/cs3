import Hls from 'hls.js';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Frame previews for the seek bar, of the kind YouTube shows on hover.
 *
 * There is no thumbnail sprite to fetch here — streams come from arbitrary
 * providers and torrents — so frames are decoded locally from a second, hidden
 * video element that seeks independently of the one being watched. Driving the
 * visible element would yank playback around under the user's cursor.
 *
 * Three things keep that affordable:
 *
 * - **Bucketing.** Requests snap to a coarse time grid, so sweeping across the
 *   bar reuses frames instead of decoding one per pixel.
 * - **One seek in flight.** A seek issued while another is pending replaces it,
 *   rather than queueing a backlog the user has already scrubbed past.
 * - **A cache**, since scrubbing back and forth revisits the same buckets.
 *
 * For torrent-backed playback there is a further constraint: seeking into a
 * region that has not been downloaded stalls rather than returning a frame.
 * `availableFraction` bounds previews to what actually exists on disk.
 */

export interface TimelinePreview {
  /** Data URL of the frame nearest the requested time, if one is ready. */
  image: string | null;
  /** True while a frame for the current request is being decoded. */
  loading: boolean;
}

interface Options {
  streamUrl: string;
  mimeType: string;
  duration: number;
  /** 0–1 fraction of the file available locally; 1 for direct HTTP sources. */
  availableFraction?: number;
  enabled?: boolean;
}

/** Seconds per cache bucket. Coarse enough to be cheap, fine enough to be useful. */
const BUCKET_SECONDS = 10;
const THUMB_WIDTH = 208;
const MAX_CACHED_FRAMES = 60;

export function useTimelinePreview({
  streamUrl,
  mimeType,
  duration,
  availableFraction = 1,
  enabled = true,
}: Options) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cacheRef = useRef<Map<number, string>>(new Map());
  const pendingRef = useRef<number | null>(null);
  const seekingRef = useRef(false);
  const readyRef = useRef(false);

  const [preview, setPreview] = useState<TimelinePreview>({ image: null, loading: false });

  // --- hidden decoder ------------------------------------------------------

  useEffect(() => {
    if (!enabled || !streamUrl) return;

    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.crossOrigin = 'anonymous';
    video.playsInline = true;
    videoRef.current = video;
    canvasRef.current = document.createElement('canvas');

    cacheRef.current.clear();
    readyRef.current = false;
    setPreview({ image: null, loading: false });

    let hls: Hls | null = null;
    const isHls = /\.m3u8(\?|$)/i.test(streamUrl) || mimeType === 'application/x-mpegURL';

    if (isHls && Hls.isSupported()) {
      // Pin the preview decoder to the smallest rendition. Thumbnails are 208px
      // wide; fetching 1080p segments to shrink them would compete for the same
      // bandwidth the stream itself needs.
      hls = new Hls({ startLevel: 0, capLevelToPlayerSize: false, maxBufferLength: 4 });
      hls.loadSource(streamUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (hls) hls.currentLevel = 0;
        readyRef.current = true;
      });
    } else {
      video.src = streamUrl;
    }

    const onReady = () => {
      readyRef.current = true;
    };
    video.addEventListener('loadeddata', onReady);

    return () => {
      video.removeEventListener('loadeddata', onReady);
      hls?.destroy();
      video.removeAttribute('src');
      video.load();
      videoRef.current = null;
      canvasRef.current = null;
      cacheRef.current.clear();
      pendingRef.current = null;
      seekingRef.current = false;
    };
  }, [streamUrl, mimeType, enabled]);

  // --- frame capture -------------------------------------------------------

  const capture = useCallback((bucket: number) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return null;

    const ratio = video.videoHeight / video.videoWidth;
    canvas.width = THUMB_WIDTH;
    canvas.height = Math.round(THUMB_WIDTH * ratio) || 117;

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    let image: string;
    try {
      image = canvas.toDataURL('image/jpeg', 0.6);
    } catch {
      // A cross-origin source without permissive CORS taints the canvas and
      // makes export throw. Previews are optional, so give up quietly rather
      // than surfacing an error over a working player.
      return null;
    }

    const cache = cacheRef.current;
    cache.set(bucket, image);
    if (cache.size > MAX_CACHED_FRAMES) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    return image;
  }, []);

  const runSeek = useCallback(
    (bucket: number) => {
      const video = videoRef.current;
      if (!video || !readyRef.current) return;

      seekingRef.current = true;
      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked);
        const image = capture(bucket);
        seekingRef.current = false;

        // Only paint if this is still the bucket the pointer is over; the user
        // may have moved on while the seek completed.
        if (pendingRef.current === bucket) {
          setPreview({ image, loading: image === null });
          pendingRef.current = null;
        } else if (pendingRef.current !== null) {
          runSeek(pendingRef.current);
        }
      };

      video.addEventListener('seeked', onSeeked);
      try {
        video.currentTime = bucket;
      } catch {
        video.removeEventListener('seeked', onSeeked);
        seekingRef.current = false;
      }
    },
    [capture]
  );

  /** Called as the pointer moves along the seek bar. */
  const requestPreview = useCallback(
    (time: number) => {
      if (!enabled || !duration || !Number.isFinite(time)) return;

      // Refuse positions the torrent has not downloaded: seeking there stalls
      // the decoder and returns nothing anyway.
      if (availableFraction < 1 && time > duration * availableFraction) {
        setPreview({ image: null, loading: false });
        return;
      }

      const bucket = Math.max(0, Math.floor(time / BUCKET_SECONDS) * BUCKET_SECONDS);
      const cached = cacheRef.current.get(bucket);
      if (cached) {
        setPreview({ image: cached, loading: false });
        pendingRef.current = null;
        return;
      }

      pendingRef.current = bucket;
      setPreview((prev) => ({ image: prev.image, loading: true }));
      if (!seekingRef.current) runSeek(bucket);
    },
    [enabled, duration, availableFraction, runSeek]
  );

  const clearPreview = useCallback(() => {
    pendingRef.current = null;
    setPreview({ image: null, loading: false });
  }, []);

  return { preview, requestPreview, clearPreview };
}
