/**
 * Why a torrent is slow, and which half of the answer we can do anything about.
 *
 * The report that prompted this module: the same magnet that saturates a
 * seedbox delivers a trickle here. That comparison is worth taking seriously
 * rather than dismissing, because it is mostly *not* about the swarm — the same
 * peers are on the other end of both. It is about how each side is connected to
 * the swarm, and the difference splits cleanly into three parts:
 *
 * 1. **Reachability.** A seedbox has a public IP with its listening port open,
 *    so peers dial *it*. Behind a home NAT — and behind CGNAT, where no amount
 *    of port forwarding helps — we can only dial out. A large share of the
 *    swarm is behind NAT too, and two unreachable peers can never connect, so
 *    the reachable subset of a 500-peer swarm can be well under half of it.
 *    This is the single biggest structural difference and it is *measurable*:
 *    an incoming connection is proof of reachability, and none over the life of
 *    a torrent is strong evidence against it.
 * 2. **Concurrency.** BitTorrent throughput is the sum of many slow peers, not
 *    one fast one. WebTorrent's per-peer request pipeline starts at two
 *    outstanding blocks and grows with that peer's measured speed, so aggregate
 *    speed tracks the *number* of connected peers far more closely than the
 *    quality of any of them. A connection cap is therefore a speed cap.
 * 3. **Piece order.** Sequential fetching is what makes a torrent playable
 *    seconds after pressing Play, and it costs throughput to get it: a peer
 *    that does not hold the specific next piece sits idle, where rarest-first
 *    would have taken something useful from it. That trade is right for
 *    streaming and simply wrong for a background download, which has no
 *    ordering requirement at all.
 *
 * Nothing here fixes (1) — an app cannot give a machine a public IP. What it
 * can do is stop *hiding* it. A named limitation can be worked around by the
 * user (forward a port, or accept it); an unnamed one reads as "this app is
 * slow", which is the report we got.
 *
 * This module is pure so the reasoning above can be tested. The engine holds
 * the sockets; this holds the arithmetic and the words.
 */

import type {
  PeerCensus,
  PeerClass,
  SwarmFinding,
  SwarmMode,
} from '../../src/types/torrent';

/**
 * `SwarmMode` is `'stream' | 'download'` and is deliberately not a user
 * preference. "Play this now" and "put this on disk" have genuinely different
 * optimal behaviour, and asking the user to choose would be asking them to
 * guess.
 */
export type { PeerCensus, PeerClass, SwarmFinding, SwarmMode };

export interface SwarmProfile {
  /**
   * WebTorrent's `strategy`. Sequential keeps the leading bytes contiguous,
   * which is what playback blocks on; rarest keeps every connected peer useful,
   * which is what throughput is made of.
   */
  strategy: 'sequential' | 'rarest';
  /** Whether to front-load the container header and index windows. */
  prioritiseHeadAndTail: boolean;
}

export const SWARM_PROFILES: Readonly<Record<SwarmMode, SwarmProfile>> = {
  stream: { strategy: 'sequential', prioritiseHeadAndTail: true },
  /**
   * A download has no playhead, so there is no reason to leave a peer idle for
   * want of one specific piece. Rarest-first is also what keeps a swarm healthy
   * — sequential clients all chase the same pieces and starve the tail.
   */
  download: { strategy: 'rarest', prioritiseHeadAndTail: false },
};

/**
 * Connections per torrent.
 *
 * WebTorrent's default is 55, which is conservative for a desktop client on a
 * home connection; mainstream clients run 100–300 per torrent and several
 * hundred globally. The ceiling that matters is file descriptors and the
 * router's NAT table, and neither is near 200 for a handful of torrents.
 *
 * A connection is not free — each one is a TCP or uTP socket with its own
 * buffers — so this is not "as high as possible". It is the point past which
 * added peers stop being the constraint.
 */
export const MAX_CONNS_PER_TORRENT = 200;

/**
 * Simultaneous requests to a single web seed (BEP-19).
 *
 * WebTorrent's default is 4. A web seed is plain HTTP, so its throughput scales
 * with parallel requests exactly like any other download, and 4 is a hard
 * ceiling that has nothing to do with the server's willingness. Where a torrent
 * has a web seed this is the closest thing to what a seedbox's bandwidth buys,
 * because it is the one peer that is never NAT-limited and never choking.
 */
export const MAX_WEB_CONNS = 12;

/**
 * Default listening port, pinned rather than ephemeral.
 *
 * An OS-assigned port changes every launch, which makes a manual router
 * forwarding rule impossible to write and forces UPnP to re-map on each start.
 * Pinning one is the difference between "reachable if the user forwards a port"
 * and "never reachable by anything but UPnP". 6881 is the historical BitTorrent
 * port and the one most router UIs already know by name.
 *
 * It is a *default*, not a requirement: the port may be taken, and a client
 * that cannot bind is worse than one on a random port, so the engine falls back.
 */
export const DEFAULT_TORRENT_PORT = 6881;

/** Peer shape as WebTorrent records it; only `type` is read. */
export interface PeerLike {
  type?: string;
}

export function classifyPeer(type: string | undefined): PeerClass {
  switch (type) {
    case 'tcpIncoming':
    case 'utpIncoming':
      return 'incoming';
    case 'webSeed':
      return 'webSeed';
    case 'webrtc':
      return 'webrtc';
    default:
      // `tcpOutgoing`, `utpOutgoing`, and anything a future version adds. An
      // unknown type is far more likely to be a dialled peer than an accepted
      // one, and over-reporting reachability is the failure that matters here.
      return 'outgoing';
  }
}

export function censusPeers(peers: Iterable<PeerLike>): PeerCensus {
  const census: PeerCensus = { total: 0, incoming: 0, outgoing: 0, webSeed: 0, webrtc: 0 };
  for (const peer of peers) {
    census.total++;
    census[classifyPeer(peer.type)]++;
  }
  return census;
}

export interface SwarmObservation {
  census: PeerCensus;
  /** How long this torrent has been connected. Reachability needs time to judge. */
  ageMs: number;
  mode: SwarmMode;
  /** Whether uTP is available in this build. */
  utpAvailable: boolean;
  /** The port actually bound, or 0 when the client has not started. */
  listenPort: number;
  maxConns: number;
}

/**
 * Long enough that "no incoming connections" means something.
 *
 * A tracker announce and a DHT bootstrap both have to complete before any peer
 * knows this client's address, and peers dial on their own schedule. Judging
 * reachability in the first few seconds would report every healthy torrent as
 * firewalled during startup, which is the sort of wrong that makes a diagnostic
 * worth ignoring.
 */
const REACHABILITY_GRACE_MS = 90_000;

/** Below this, the swarm itself is the limit and nothing local will help. */
const THIN_SWARM_PEERS = 5;

export function diagnoseSwarm(observation: SwarmObservation): SwarmFinding[] {
  const { census, ageMs, mode, utpAvailable, maxConns } = observation;
  const findings: SwarmFinding[] = [];

  if (census.incoming > 0) {
    findings.push({
      id: 'reachable',
      tone: 'good',
      summary: `${census.incoming} peer${census.incoming === 1 ? '' : 's'} connected to you`,
      advice: 'Your listening port is reachable, so the whole swarm can reach you.',
    });
  } else if (ageMs >= REACHABILITY_GRACE_MS) {
    findings.push({
      id: 'unreachable',
      tone: 'limit',
      summary: 'No peer has connected to you',
      advice:
        'Only peers you dial can be used, and peers behind their own NAT cannot be dialled — ' +
        'so a large part of the swarm is unreachable. Forwarding this port on your router, or ' +
        'enabling UPnP on it, is what a seedbox gets for free.',
    });
  } else {
    findings.push({
      id: 'reachability-unknown',
      tone: 'note',
      summary: 'Still learning whether peers can reach you',
    });
  }

  if (census.total > 0 && census.total < THIN_SWARM_PEERS) {
    findings.push({
      id: 'thin-swarm',
      tone: 'limit',
      summary: `Only ${census.total} peer${census.total === 1 ? '' : 's'} connected`,
      advice:
        'This release has few seeders. No setting changes that — a different source with a ' +
        'larger swarm will be faster than any amount of tuning.',
    });
  }

  // Report the ceiling only when it is actually being reached; a cap nobody is
  // near is not a limit, and naming it would be noise.
  if (census.total >= maxConns) {
    findings.push({
      id: 'connection-ceiling',
      tone: 'note',
      summary: `At the ${maxConns}-connection limit for this torrent`,
    });
  }

  if (!utpAvailable) {
    findings.push({
      id: 'no-utp',
      tone: 'limit',
      summary: 'uTP is unavailable in this build',
      advice:
        'Peers that only speak uTP cannot be reached, and TCP is what ISP traffic shapers ' +
        'throttle first.',
    });
  }

  if (mode === 'stream') {
    findings.push({
      id: 'sequential-cost',
      tone: 'note',
      summary: 'Fetching in order so playback can start early',
      advice:
        'Downloading the same torrent instead fetches out of order, which is faster overall.',
    });
  }

  return findings;
}

/**
 * A single sentence for the places that have room for one.
 *
 * Ordered by what the user can act on: a limit they can fix, then one they
 * cannot, then confirmation. "Downloading from 34 peers" is the right answer
 * when nothing is wrong — a diagnostic that always finds something to complain
 * about gets read as noise.
 */
export function summariseSwarm(findings: SwarmFinding[], census: PeerCensus): string {
  const limit = findings.find((f) => f.tone === 'limit');
  if (limit) return limit.summary;
  if (census.total === 0) return 'Looking for peers';
  return `Connected to ${census.total} peer${census.total === 1 ? '' : 's'}`;
}
