/**
 * What a torrent failure was, as one of a closed set with the pipeline stage
 * it happened at (Torrent PRD §2.3).
 *
 * Read from the engine's own wording, which already names the cause
 * (`torrentEngine.ts`); this only gives it a kind and a stage, so logs and the
 * issue ledger can count them. Anything unrecognised is `stream-failed` at the
 * playback stage, never guessed into a more specific kind. Pure.
 */
export type TorrentFailureKind =
  | 'invalid-input'
  | 'not-imported'
  | 'engine-start'
  | 'metadata-timeout'
  | 'no-peers'
  | 'no-media'
  /** Peers answered, but the start of the chosen file never arrived in time. */
  | 'file-not-ready'
  | 'stream-failed';

export type TorrentFailureStage = 'input' | 'engine' | 'metadata' | 'peers' | 'files' | 'playback';

export interface TorrentFailure {
  kind: TorrentFailureKind;
  stage: TorrentFailureStage;
}

const RULES: Array<[RegExp, TorrentFailure]> = [
  [/not imported/i, { kind: 'not-imported', stage: 'input' }],
  [/invalid (magnet|torrent|infohash)|not a (magnet|torrent)|no file was chosen/i, { kind: 'invalid-input', stage: 'input' }],
  [/binding the torrent port|did not report a port|EADDRINUSE/i, { kind: 'engine-start', stage: 'engine' }],
  [/timed out fetching torrent metadata/i, { kind: 'metadata-timeout', stage: 'metadata' }],
  [/no peers/i, { kind: 'no-peers', stage: 'peers' }],
  [/does not contain/i, { kind: 'no-media', stage: 'files' }],
  [/waiting for enough data/i, { kind: 'file-not-ready', stage: 'files' }],
];

export function classifyTorrentFailure(message: string): TorrentFailure {
  for (const [pattern, failure] of RULES) if (pattern.test(message)) return failure;
  return { kind: 'stream-failed', stage: 'playback' };
}
