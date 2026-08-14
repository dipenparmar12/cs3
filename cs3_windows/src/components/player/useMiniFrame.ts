import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Position and size for the floating mini player, dragged and resized by hand.
 *
 * ## Why this is a hook and not CSS
 *
 * `resize: both` gets close and fails on the two things that matter. It cannot
 * hold an aspect ratio, so a video window becomes letterboxed the moment it is
 * touched; and the handle it draws sits in the bottom-right corner, which is
 * exactly where a fixed-position window is when it is parked in the corner of
 * the screen — under the edge, unreachable. Both are fixable only by owning the
 * gesture.
 *
 * ## What is load-bearing
 *
 * **Pointer capture, not document listeners.** A drag that loses the pointer
 * over the `<video>` element leaves the window stuck to the cursor, because the
 * video swallows the `pointerup`. Capturing on the handle means every event in
 * the gesture arrives regardless of what is underneath.
 *
 * **Clamped to the viewport on every change, including resize of the window
 * itself.** A player parked at the right edge of a maximised window is off
 * screen entirely when the window is restored, and there is then no way to
 * reach it — the drag handle is the part that has gone.
 *
 * **Persisted.** Where someone puts this is a preference, not a per-session
 * accident, and a mini player that returns to the corner every time is one
 * people stop moving.
 */

export interface MiniFrame {
  /** Distance from the viewport's left and top, in pixels. */
  x: number;
  y: number;
  width: number;
}

const STORAGE_KEY = 'cs3.miniPlayer.frame';

/** Below this the controls stop fitting and the window is a thumbnail. */
const MIN_WIDTH = 280;
const MAX_WIDTH = 900;
const ASPECT = 16 / 9;

/** Kept clear of the edges so the window never looks clipped. */
const MARGIN = 12;

function clampFrame(frame: MiniFrame): MiniFrame {
  const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, frame.width));
  const height = width / ASPECT;
  const maxX = Math.max(MARGIN, window.innerWidth - width - MARGIN);
  const maxY = Math.max(MARGIN, window.innerHeight - height - MARGIN);
  return {
    width,
    x: Math.min(maxX, Math.max(MARGIN, frame.x)),
    y: Math.min(maxY, Math.max(MARGIN, frame.y)),
  };
}

function defaultFrame(): MiniFrame {
  const width = 420;
  return clampFrame({
    width,
    x: window.innerWidth - width - 24,
    y: window.innerHeight - width / ASPECT - 24,
  });
}

function restore(): MiniFrame {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultFrame();
    const parsed = JSON.parse(raw) as Partial<MiniFrame>;
    if (typeof parsed?.x !== 'number' || typeof parsed?.y !== 'number') return defaultFrame();
    return clampFrame({
      x: parsed.x,
      y: parsed.y,
      width: typeof parsed.width === 'number' ? parsed.width : 420,
    });
  } catch {
    return defaultFrame();
  }
}

export function useMiniFrame(active: boolean): {
  frame: MiniFrame;
  height: number;
  startDrag: (event: React.PointerEvent) => void;
  startResize: (event: React.PointerEvent) => void;
  reset: () => void;
} {
  const [frame, setFrame] = useState<MiniFrame>(() =>
    typeof window === 'undefined' ? { x: 24, y: 24, width: 420 } : restore()
  );
  const gesture = useRef<{
    kind: 'drag' | 'resize';
    pointerId: number;
    startX: number;
    startY: number;
    origin: MiniFrame;
  } | null>(null);

  // Persisted on change rather than on release: a drag that ends with the app
  // closing still keeps the position.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(frame));
    } catch {
      // Storage can be unavailable; the position simply does not persist.
    }
  }, [frame]);

  // The viewport changing can put the window out of reach — see the header.
  useEffect(() => {
    if (!active) return;
    const onResize = () => setFrame((current) => clampFrame(current));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [active]);

  const onPointerMove = useCallback((event: React.PointerEvent | PointerEvent) => {
    const active = gesture.current;
    if (!active || event.pointerId !== active.pointerId) return;
    const dx = event.clientX - active.startX;
    const dy = event.clientY - active.startY;

    if (active.kind === 'drag') {
      setFrame(clampFrame({ ...active.origin, x: active.origin.x + dx, y: active.origin.y + dy }));
      return;
    }

    // Resizing from the top-left corner: the bottom-right stays put, which is
    // what keeps a window parked in the corner of the screen from walking off
    // it as it grows.
    const width = active.origin.width - dx;
    const clamped = clampFrame({
      width,
      x: active.origin.x + (active.origin.width - Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width))),
      y:
        active.origin.y +
        (active.origin.width - Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width))) / ASPECT,
    });
    setFrame(clamped);
  }, []);

  const endGesture = useCallback((event: React.PointerEvent | PointerEvent) => {
    if (gesture.current && event.pointerId === gesture.current.pointerId) {
      gesture.current = null;
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    const move = (event: PointerEvent) => onPointerMove(event);
    const up = (event: PointerEvent) => endGesture(event);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [active, onPointerMove, endGesture]);

  const begin = (kind: 'drag' | 'resize') => (event: React.PointerEvent) => {
    // Only the primary button, and never a gesture that started on a control.
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    gesture.current = {
      kind,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: frame,
    };
  };

  return {
    frame,
    height: frame.width / ASPECT,
    startDrag: begin('drag'),
    startResize: begin('resize'),
    reset: () => setFrame(defaultFrame()),
  };
}
