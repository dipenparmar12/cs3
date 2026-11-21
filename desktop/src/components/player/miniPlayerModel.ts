export type FloatingPresentationMode = 'mini' | 'floating' | 'pip' | 'background';

export type ActiveMiniPresentation = 'windows' | 'app' | 'none';

export interface FloatingPresentationInput {
  mini: boolean;
  hidden: boolean;
  floatingMode: FloatingPresentationMode;
  isFloatingWindowOpen: boolean;
  isNativePipOpen: boolean;
  isNativeEngine: boolean;
}

/**
 * Resolves which mini-player surface owns playback right now.
 *
 * Windows-level floating playback and the in-app corner mini player are
 * mutually exclusive: when an OS-level floating window or Picture-in-Picture
 * window is open, the in-app `.player--mini` overlay must never render beside
 * it.
 */
export function resolveFloatingPresentation(input: FloatingPresentationInput): ActiveMiniPresentation {
  if (input.isFloatingWindowOpen || input.isNativePipOpen) {
    return 'windows';
  }
  if (input.isNativeEngine && input.floatingMode === 'pip' && input.hidden) {
    return 'windows';
  }
  if (input.mini && !input.hidden) {
    return 'app';
  }
  return 'none';
}

export interface MiniKeydownGuardInput {
  hidden: boolean;
  mini: boolean;
  isFocusInsidePlayer: boolean;
  isTextEntryTarget: boolean;
  isModalBlocking: boolean;
}

/**
 * Decides whether a keyboard shortcut should drive the in-app player.
 *
 * Full-screen/overlay mode owns shortcuts everywhere except text inputs.
 * Mini mode owns shortcuts whenever focus or interaction is inside `.player--mini`
 * (and not inside an editable text field), while yielding keys typed into app
 * search boxes or library filters outside the mini window.
 */
export function shouldHandlePlayerKeydown(input: MiniKeydownGuardInput): boolean {
  if (input.hidden || input.isModalBlocking || input.isTextEntryTarget) {
    return false;
  }
  if (input.mini) {
    return input.isFocusInsidePlayer;
  }
  return true;
}

export interface WorkAreaRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const DEFAULT_FLOAT_WIDTH = 440;
const FLOAT_MARGIN = 24;
const MIN_FLOAT_WIDTH = 280;
const MIN_FLOAT_HEIGHT = 158;

/**
 * Computes clamped 16:9 screen bounds for the detached Windows-level floating
 * player window, defaulting to the bottom-right corner of the primary display.
 */
export function computeFloatingWindowBounds(
  workArea: WorkAreaRect,
  saved?: Partial<WorkAreaRect> | null
): WorkAreaRect {
  const maxWidth = Math.max(MIN_FLOAT_WIDTH, Math.round(workArea.width - FLOAT_MARGIN * 2));
  const maxHeight = Math.max(MIN_FLOAT_HEIGHT, Math.round(workArea.height - FLOAT_MARGIN * 2));

  const rawWidth = saved?.width ?? DEFAULT_FLOAT_WIDTH;
  const width = Math.max(MIN_FLOAT_WIDTH, Math.min(maxWidth, Math.round(rawWidth)));
  const rawHeight = saved?.height ?? Math.round((width * 9) / 16);
  const height = Math.max(MIN_FLOAT_HEIGHT, Math.min(maxHeight, Math.round(rawHeight)));

  const defaultX = workArea.x + workArea.width - width - FLOAT_MARGIN;
  const defaultY = workArea.y + workArea.height - height - FLOAT_MARGIN;

  const rawX = saved?.x ?? defaultX;
  const rawY = saved?.y ?? defaultY;

  const minX = workArea.x;
  const maxX = Math.max(minX, workArea.x + workArea.width - width);
  const minY = workArea.y;
  const maxY = Math.max(minY, workArea.y + workArea.height - height);

  return {
    x: Math.round(Math.max(minX, Math.min(maxX, rawX))),
    y: Math.round(Math.max(minY, Math.min(maxY, rawY))),
    width,
    height,
  };
}

/**
 * Distinguishes an intentional click/tap from a window drag gesture.
 */
export function isPointerTap(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  maxDistancePx = 5
): boolean {
  const dx = endX - startX;
  const dy = endY - startY;
  return dx * dx + dy * dy <= maxDistancePx * maxDistancePx;
}
