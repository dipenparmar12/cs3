/**
 * When a torrent that never got going is given up on (spec: "detect stalled
 * torrents and fall back"). Pure.
 *
 * Before the first frame there is nothing to lose by moving on: the viewer is
 * looking at a spinner. No data and no peers for 20 s is a swarm that is not
 * there; no data for the engine's 45 s stall threshold is one that stopped.
 * Once playback has started the decision stays the viewer's (the overlay's
 * "Choose another source"): switching mid-film restarts the stream.
 */

/**
 * "The selected file is not ready" (Torrent PRD §2.3), as how far along its
 * start is: peers are connected and the leading bytes playback waits for have
 * not all arrived. `null` when that is not the state (no peers, stalled,
 * already playable, or the engine did not say how much it waits for). Never
 * 100 until the engine says the file is playable.
 */
export function startOfFilePercent(stats: {
  readyBytes: number;
  readyTargetBytes?: number;
  peers: number;
  isPlayable: boolean;
  isStalled: boolean;
}): number | null {
  if (stats.isPlayable || stats.isStalled || stats.peers === 0) return null;
  if (!stats.readyTargetBytes || stats.readyTargetBytes <= 0) return null;
  return Math.min(99, Math.max(0, Math.floor((stats.readyBytes / stats.readyTargetBytes) * 100)));
}

/** No bytes and nobody connected, before anything played. */
export const STARTUP_DEAD_SWARM_MS = 20_000;

export function shouldSkipStalledTorrent(input: {
  startedPlayback: boolean;
  stalledMs: number;
  peers: number;
  /** The engine's own verdict (45 s without data). */
  isStalled: boolean;
}): string | null {
  if (input.startedPlayback) return null;
  if (input.peers === 0 && input.stalledMs >= STARTUP_DEAD_SWARM_MS) {
    return `No peers connected and nothing arrived in ${Math.round(input.stalledMs / 1000)} s`;
  }
  if (input.isStalled) return `Nothing arrived from this torrent for ${Math.round(input.stalledMs / 1000)} s`;
  return null;
}
