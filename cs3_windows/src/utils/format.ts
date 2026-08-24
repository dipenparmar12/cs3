/**
 * Human-readable numbers: sizes, transfer rates, durations.
 *
 * These were written six times across the renderer, and **the six did not
 * agree**. That is the reason this file exists and the reason it is shaped the
 * way it is.
 *
 * What the copies disagreed about, measured rather than guessed:
 *
 * | Call site               | zero answers    | base | MB decimals |
 * |-------------------------|-----------------|------|-------------|
 * | `DownloadCenter`        | `Unknown`       | 1024 | 0           |
 * | `PlayerDownloadPanel`   | `0 MB`          | 1024 | 0           |
 * | `SourcePanel`           | `—`             | 1000 | 0           |
 * | `HistoryView`           | `Unknown size`  | 1024 | 1           |
 * | `SourcePicker`          | `—`             | 1024 | adaptive    |
 * | `ProvenancePanel`       | `0 B`           | 1024 | 2           |
 *
 * A single `formatBytes` would have been shorter and would have changed what
 * six screens display — so the differences are **parameters**, not something to
 * average away. Every one is preserved exactly, and pinned by `format.test.mts`
 * against the strings the old implementations produced.
 *
 * The disagreement is worth a decision at some point: `Unknown` and `—` and
 * `0 MB` for the same condition is a UI inconsistency, and 1000 vs 1024 makes
 * the same file read as 4.29 GB in one list and 4.00 GB in another. Neither is
 * a refactoring question, which is why neither was answered here.
 *
 * Two conventions that are *not* accidental and should survive any such
 * decision:
 *
 * - **Release sizes use base 1000.** Providers and trackers quote SI, so a
 *   torrent listed as "4.3 GB" upstream must not be redrawn as "4.00 GB" here;
 *   the viewer comparing our list against the site it came from would read that
 *   as a different release.
 * - **Download progress uses base 1024**, matching what the OS file manager
 *   will say about the same file once it lands.
 */

const LADDER = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/**
 * The full unit ladder, with precision that falls away as the number grows.
 *
 * `950 MB` and `1.4 GB` both read cleanly; `950.0 MB` and `1 GB` do not. Bytes
 * are always whole, because a fraction of a byte is not a thing.
 */
export function formatBytes(bytes: number | undefined, empty = '—'): string {
  if (!bytes) return empty;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < LADDER.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${LADDER[unit]}`;
}

/**
 * A short B / KB / MB ladder for small artefacts — a `.cs3` archive, a manifest.
 *
 * Stops at MB deliberately: nothing this is used for reaches a gigabyte, and a
 * two-decimal MB is the readable precision at extension-archive scale.
 */
export function formatCompactBytes(bytes: number | undefined | null): string {
  // Absent is not zero. A size nobody reported must not read as an empty file.
  if (bytes === undefined || bytes === null || !Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export interface MediaSizeOptions {
  /** Shown for zero, `undefined`, or a negative. */
  empty: string;
  /** 1024 for anything the OS will also report; 1000 for release sizes. */
  base: 1000 | 1024;
  /** Decimals below one gigabyte. */
  mbDigits: 0 | 1;
}

/**
 * The MB-or-GB pair used wherever a whole film's size is shown.
 *
 * Only two units, because that is the entire useful range for media: nothing is
 * measured in kilobytes and nothing reaches a terabyte.
 */
export function formatMediaSize(
  bytes: number | undefined,
  { empty, base, mbDigits }: MediaSizeOptions
): string {
  if (!bytes || bytes <= 0) return empty;
  const mb = bytes / (base * base);
  if (mb >= base) return `${(mb / base).toFixed(2)} GB`;
  return `${mb.toFixed(mbDigits)} MB`;
}

/** Download-list sizes: binary units, `Unknown` when the source sent no length. */
export const formatDownloadSize = (bytes: number): string =>
  formatMediaSize(bytes, { empty: 'Unknown', base: 1024, mbDigits: 0 });

/**
 * The same, but reading `0 MB` rather than `Unknown`.
 *
 * The in-player panel shows this beside a live progress bar, where a running
 * transfer that has not yet reported a total should read as *nothing yet*, not
 * as *unknowable*.
 */
export const formatPanelSize = (bytes: number): string =>
  formatMediaSize(bytes, { empty: '0 MB', base: 1024, mbDigits: 0 });

/** Release sizes in a source list: SI units, to match what the provider quoted. */
export const formatReleaseSize = (bytes: number): string =>
  formatMediaSize(bytes, { empty: '—', base: 1000, mbDigits: 0 });

/** History rows, which carry one more decimal because the column is wider. */
export const formatHistorySize = (bytes?: number): string =>
  formatMediaSize(bytes, { empty: 'Unknown size', base: 1024, mbDigits: 1 });

/**
 * A transfer rate.
 *
 * `base` differs by caller for the same reason sizes do: the download list
 * matches the file manager, and the player's readout matches the SI figures the
 * rest of that surface quotes.
 */
export function formatTransferRate(bytesPerSecond: number, base: 1000 | 1024 = 1024): string {
  if (bytesPerSecond <= 0) return '0 KB/s';
  const mb = bytesPerSecond / (base * base);
  if (mb >= 1) return `${mb.toFixed(1)} MB/s`;
  return `${(bytesPerSecond / base).toFixed(0)} KB/s`;
}

/**
 * A playhead position, `h:mm:ss` or `m:ss`.
 *
 * The hour field is dropped below an hour rather than shown as `0:`, because a
 * seek bar reading `0:04:31` for a television episode wastes the width and
 * scans worse. Non-finite input answers `0:00`: `video.duration` is `NaN` until
 * metadata loads, and a timeline reading `NaN:NaN` looks like a crash.
 */
export function formatTimecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * A running time in prose — `95 min`, `2h 15m`.
 *
 * Answers `null` rather than a placeholder for an unknown duration, so the
 * caller can omit the field entirely instead of printing a dash into a row of
 * metadata that has plenty of real content in it.
 */
export function formatRuntime(seconds?: number): string | null {
  if (!seconds || seconds <= 0) return null;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
