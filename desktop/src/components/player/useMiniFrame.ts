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

export type MiniResizeDirection =
  | 'nw'
  | 'ne'
  | 'se'
  | 'sw'
  | 'n'
  | 's'
  | 'w'
  | 'e';

export interface ViewportBounds {
  innerWidth: number;
  innerHeight: number;
}

const STORAGE_KEY = 'cs3.miniPlayer.frame';

/** Below this the controls stop fitting and the window is a thumbnail. */
export const MIN_WIDTH = 280;
export const MAX_WIDTH = 900;
export const ASPECT = 16 / 9;

/** Kept clear of the edges so the window never looks clipped. */
export const MARGIN = 12;

export function clampFrame(frame: MiniFrame, viewport?: ViewportBounds): MiniFrame {
  const vpWidth = viewport?.innerWidth ?? (typeof window !== 'undefined' ? window.innerWidth : 1920);
  const vpHeight = viewport?.innerHeight ?? (typeof window !== 'undefined' ? window.innerHeight : 1080);
  const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, frame.width));
  const height = width / ASPECT;
  const maxX = Math.max(MARGIN, vpWidth - width - MARGIN);
  const maxY = Math.max(MARGIN, vpHeight - height - MARGIN);
  return {
    width,
    x: Math.min(maxX, Math.max(MARGIN, frame.x)),
    y: Math.min(maxY, Math.max(MARGIN, frame.y)),
  };
}

export function computeResizedFrame(
  origin: MiniFrame,
  direction: MiniResizeDirection,
  dx: number,
  dy: number,
  viewport?: ViewportBounds
): MiniFrame {
  const vpWidth = viewport?.innerWidth ?? (typeof window !== 'undefined' ? window.innerWidth : 1920);
  const vpHeight = viewport?.innerHeight ?? (typeof window !== 'undefined' ? window.innerHeight : 1080);
  const originHeight = origin.width / ASPECT;
  const originRight = origin.x + origin.width;
  const originBottom = origin.y + originHeight;

  let width = origin.width;
  let x = origin.x;
  let y = origin.y;

  switch (direction) {
    case 'se': {
      // Top-left is anchored at (origin.x, origin.y)
      const delta = Math.abs(dx) >= Math.abs(dy * ASPECT) ? dx : dy * ASPECT;
      const targetWidth = origin.width + delta;
      const maxByRight = vpWidth - MARGIN - origin.x;
      const maxByBottom = (vpHeight - MARGIN - origin.y) * ASPECT;
      width = Math.min(targetWidth, MAX_WIDTH, maxByRight, maxByBottom);
      width = Math.max(MIN_WIDTH, width);
      x = origin.x;
      y = origin.y;
      break;
    }
    case 'nw': {
      // Bottom-right is anchored at (originRight, originBottom)
      const delta = Math.abs(-dx) >= Math.abs(-dy * ASPECT) ? -dx : -dy * ASPECT;
      const targetWidth = origin.width + delta;
      const maxByLeft = originRight - MARGIN;
      const maxByTop = (originBottom - MARGIN) * ASPECT;
      width = Math.min(targetWidth, MAX_WIDTH, maxByLeft, maxByTop);
      width = Math.max(MIN_WIDTH, width);
      x = originRight - width;
      y = originBottom - width / ASPECT;
      break;
    }
    case 'ne': {
      // Bottom-left is anchored at (origin.x, originBottom)
      const delta = Math.abs(dx) >= Math.abs(-dy * ASPECT) ? dx : -dy * ASPECT;
      const targetWidth = origin.width + delta;
      const maxByRight = vpWidth - MARGIN - origin.x;
      const maxByTop = (originBottom - MARGIN) * ASPECT;
      width = Math.min(targetWidth, MAX_WIDTH, maxByRight, maxByTop);
      width = Math.max(MIN_WIDTH, width);
      x = origin.x;
      y = originBottom - width / ASPECT;
      break;
    }
    case 'sw': {
      // Top-right is anchored at (originRight, origin.y)
      const delta = Math.abs(-dx) >= Math.abs(dy * ASPECT) ? -dx : dy * ASPECT;
      const targetWidth = origin.width + delta;
      const maxByLeft = originRight - MARGIN;
      const maxByBottom = (vpHeight - MARGIN - origin.y) * ASPECT;
      width = Math.min(targetWidth, MAX_WIDTH, maxByLeft, maxByBottom);
      width = Math.max(MIN_WIDTH, width);
      x = originRight - width;
      y = origin.y;
      break;
    }
    case 'e': {
      // Left and top anchored
      const targetWidth = origin.width + dx;
      const maxByRight = vpWidth - MARGIN - origin.x;
      const maxByBottom = (vpHeight - MARGIN - origin.y) * ASPECT;
      width = Math.min(targetWidth, MAX_WIDTH, maxByRight, maxByBottom);
      width = Math.max(MIN_WIDTH, width);
      x = origin.x;
      y = origin.y;
      break;
    }
    case 'w': {
      // Right and top anchored
      const targetWidth = origin.width - dx;
      const maxByLeft = originRight - MARGIN;
      const maxByBottom = (vpHeight - MARGIN - origin.y) * ASPECT;
      width = Math.min(targetWidth, MAX_WIDTH, maxByLeft, maxByBottom);
      width = Math.max(MIN_WIDTH, width);
      x = originRight - width;
      y = origin.y;
      break;
    }
    case 's': {
      // Top and left anchored
      const targetWidth = origin.width + dy * ASPECT;
      const maxByRight = vpWidth - MARGIN - origin.x;
      const maxByBottom = (vpHeight - MARGIN - origin.y) * ASPECT;
      width = Math.min(targetWidth, MAX_WIDTH, maxByRight, maxByBottom);
      width = Math.max(MIN_WIDTH, width);
      x = origin.x;
      y = origin.y;
      break;
    }
    case 'n': {
      // Bottom and left anchored
      const targetWidth = origin.width - dy * ASPECT;
      const maxByRight = vpWidth - MARGIN - origin.x;
      const maxByTop = (originBottom - MARGIN) * ASPECT;
      width = Math.min(targetWidth, MAX_WIDTH, maxByRight, maxByTop);
      width = Math.max(MIN_WIDTH, width);
      x = origin.x;
      y = originBottom - width / ASPECT;
      break;
    }
  }

  return clampFrame({ x, y, width }, { innerWidth: vpWidth, innerHeight: vpHeight });
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

export interface UseMiniFrameReturn {
  frame: MiniFrame;
  height: number;
  isDragging: boolean;
  isResizing: boolean;
  resizeDirection: MiniResizeDirection | null;
  startDrag: (event: React.PointerEvent) => void;
  startResize: {
    (direction: MiniResizeDirection): (event: React.PointerEvent) => void;
    (event: React.PointerEvent): void;
  };
  reset: () => void;
}

export function useMiniFrame(active: boolean): UseMiniFrameReturn {
  const [frame, setFrame] = useState<MiniFrame>(() =>
    typeof window === 'undefined' ? { x: 24, y: 24, width: 420 } : restore()
  );
  const [isDragging, setIsDragging] = useState(false);
  const [resizingDirection, setResizingDirection] = useState<MiniResizeDirection | null>(null);

  const gesture = useRef<{
    kind: 'drag' | 'resize';
    direction?: MiniResizeDirection;
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
    if (!active) {
      gesture.current = null;
      setIsDragging(false);
      setResizingDirection(null);
      return;
    }
    const onResize = () => setFrame((current) => clampFrame(current));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [active]);

  const onPointerMove = useCallback((event: React.PointerEvent | PointerEvent) => {
    const activeGesture = gesture.current;
    if (!activeGesture || event.pointerId !== activeGesture.pointerId) return;
    const dx = event.clientX - activeGesture.startX;
    const dy = event.clientY - activeGesture.startY;

    if (activeGesture.kind === 'drag') {
      setFrame(clampFrame({ ...activeGesture.origin, x: activeGesture.origin.x + dx, y: activeGesture.origin.y + dy }));
      return;
    }

    if (activeGesture.kind === 'resize') {
      const direction = activeGesture.direction ?? 'nw';
      setFrame(computeResizedFrame(activeGesture.origin, direction, dx, dy));
    }
  }, []);

  const endGesture = useCallback((event: React.PointerEvent | PointerEvent) => {
    if (gesture.current && event.pointerId === gesture.current.pointerId) {
      gesture.current = null;
      setIsDragging(false);
      setResizingDirection(null);
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

  const startDrag = useCallback((event: React.PointerEvent) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (
      target?.closest(
        'button, input, textarea, a, select, .player-mini__resize, .player-mini__resize-edge, [data-interactive], [data-no-drag]'
      )
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    gesture.current = {
      kind: 'drag',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: frame,
    };
    setIsDragging(true);
  }, [frame]);

  const beginResize = useCallback(
    (direction: MiniResizeDirection, event: React.PointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
      gesture.current = {
        kind: 'resize',
        direction,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        origin: frame,
      };
      setResizingDirection(direction);
    },
    [frame]
  );

  const startResize = useCallback(
    ((arg: MiniResizeDirection | React.PointerEvent = 'nw') => {
      if (typeof arg === 'string') {
        return (event: React.PointerEvent) => beginResize(arg, event);
      }
      return beginResize('nw', arg);
    }) as UseMiniFrameReturn['startResize'],
    [beginResize]
  );

  return {
    frame,
    height: frame.width / ASPECT,
    isDragging,
    isResizing: resizingDirection !== null,
    resizeDirection: resizingDirection,
    startDrag,
    startResize,
    reset: () => setFrame(defaultFrame()),
  };
}
