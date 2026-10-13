/**
 * The player's one on-screen indicator for routine keyboard actions — volume,
 * seeking, speed, subtitle switches.
 *
 * These used to be toasts: one 4-second pill per key press, stacked three
 * deep, so holding ↑ or tapping → five times filled the bottom of the film with
 * "Volume: 55%", "Volume: 60%", "Volume: 65%". A press now updates the single
 * indicator in place, and a run of seeks adds up — five taps of → read "+50s",
 * not five separate "+10s". Toasts are kept for things that happened *to* the
 * viewer (a download finished), not things they just did.
 *
 * Pure: the component owns the timer, this owns what the indicator says.
 */

export type OsdAction =
  | { kind: 'volume'; volume: number; muted: boolean }
  /** A relative seek; `position` is where it lands, after clamping. */
  | { kind: 'seek'; delta: number; position: number; duration: number }
  /** An absolute jump (a number key, Home, End). Ends any run of relative seeks. */
  | { kind: 'jump'; position: number; duration: number }
  | { kind: 'speed'; speed: number }
  | { kind: 'text'; text: string };

export type OsdState =
  | { kind: 'volume'; volume: number; muted: boolean }
  | { kind: 'seek'; position: number; duration: number; netDelta: number | null }
  | { kind: 'speed'; speed: number }
  | { kind: 'text'; text: string };

/** How long the indicator stays after the last press. */
export const OSD_VISIBLE_MS = 1200;

/**
 * The indicator after one more action. `previous` is what is on screen now
 * (null once it has faded), which is what decides whether a seek continues a
 * run: a press while "+20s" is still showing makes it "+30s".
 */
export function nextOsd(previous: OsdState | null, action: OsdAction): OsdState {
  switch (action.kind) {
    case 'volume':
      return { kind: 'volume', volume: clamp01(action.volume), muted: action.muted };
    case 'seek': {
      const run = previous?.kind === 'seek' && previous.netDelta !== null ? previous.netDelta : 0;
      return {
        kind: 'seek',
        position: action.position,
        duration: action.duration,
        netDelta: run + action.delta,
      };
    }
    case 'jump':
      return { kind: 'seek', position: action.position, duration: action.duration, netDelta: null };
    case 'speed':
      return { kind: 'speed', speed: action.speed };
    case 'text':
      return { kind: 'text', text: action.text };
  }
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function timecode(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

function signedDuration(delta: number): string {
  const abs = Math.abs(Math.round(delta));
  const sign = delta < 0 ? '−' : '+';
  if (abs >= 60) {
    const m = Math.floor(abs / 60);
    const s = abs % 60;
    return s > 0 ? `${sign}${m}m ${s}s` : `${sign}${m}m`;
  }
  return `${sign}${abs}s`;
}

/** What the indicator draws: a main figure, an optional smaller one, an optional level bar. */
export function describeOsd(state: OsdState): { primary: string; secondary?: string; level?: number } {
  switch (state.kind) {
    case 'volume':
      return state.muted || state.volume === 0
        ? { primary: 'Muted', level: 0 }
        : { primary: `${Math.round(state.volume * 100)}%`, level: state.volume };
    case 'seek': {
      const where =
        state.duration > 0 ? `${timecode(state.position)} / ${timecode(state.duration)}` : timecode(state.position);
      return state.netDelta === null || Math.round(state.netDelta) === 0
        ? { primary: where }
        : { primary: signedDuration(state.netDelta), secondary: where };
    }
    case 'speed':
      return { primary: `${state.speed}×`, secondary: 'Speed' };
    case 'text':
      return { primary: state.text };
  }
}
