import { SWARM_PROFILES } from './swarmHealth.ts';

/** Leading bytes fetched first: a container header plus a GOP. */
export const HEAD_PRIORITY_BYTES = 16 * 1024 * 1024;

export interface PieceWindow {
  from: number;
  to: number;
  priority: number;
}

/** A file's place in the torrent's concatenated byte space. */
export interface FileSpan {
  offset: number;
  length: number;
}

export interface PiecePlan {
  strategy: 'sequential' | 'rarest';
  selections: PieceWindow[];
}

function piecesOf(span: FileSpan, pieceLength: number): { first: number; last: number } {
  return {
    first: Math.floor(span.offset / pieceLength),
    last: Math.floor((span.offset + span.length - 1) / pieceLength),
  };
}

/**
 * Which pieces of a torrent to ask the swarm for, given who holds it: at most
 * one stream (the file being played) and any explicit downloads. Pure.
 *
 * **A stream selects no whole-file range.** The player's own reads are what
 * WebTorrent fetches from: each HTTP range becomes a selection from that byte
 * to the end, at priority 1, so priority follows the playhead and a seek drops
 * the old read for a new one. The plan adds only two bounded windows for the
 * first read to find ready: the head, and the tail for containers that index
 * there.
 *
 * Before 2026-10-30 a stream also selected its whole file at priority 1 with
 * the windows on top. WebTorrent 3 merges overlapping non-stream selections
 * into one at the highest priority, so the windows became the whole file at
 * priority 10, walked in order from byte 0: a seek's read shared every peer
 * with that walk, and an MP4's `moov` waited its turn. Hence no window may
 * overlap another selection.
 *
 * An explicit download selects its whole file at priority 0, below any read.
 * While one exists on the torrent the stream windows are dropped (they would
 * merge into it); a streamed walk is sequential, so the head comes first anyway.
 */
export function planPieces(input: {
  pieceLength: number;
  stream?: FileSpan & { tailBytes: number };
  downloads: FileSpan[];
}): PiecePlan {
  const { pieceLength, stream } = input;
  const strategy = SWARM_PROFILES[stream ? 'stream' : 'download'].strategy;
  if (!(pieceLength > 0)) return { strategy, selections: [] };

  const selections: PieceWindow[] = input.downloads
    .filter((span) => span.length > 0)
    .map((span) => {
      const { first, last } = piecesOf(span, pieceLength);
      return { from: first, to: last, priority: 0 };
    });
  if (!stream || stream.length <= 0 || selections.length > 0) return { strategy, selections };

  const { first, last } = piecesOf(stream, pieceLength);
  const headEnd = Math.min(last, first + Math.ceil(HEAD_PRIORITY_BYTES / pieceLength) - 1);
  selections.push({ from: first, to: headEnd, priority: 10 });
  if (stream.tailBytes > 0) {
    const tailStart = Math.max(headEnd + 1, last - Math.ceil(stream.tailBytes / pieceLength) + 1);
    if (tailStart <= last) selections.push({ from: tailStart, to: last, priority: 9 });
  }
  return { strategy, selections };
}
