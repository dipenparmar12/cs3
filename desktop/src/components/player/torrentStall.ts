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
