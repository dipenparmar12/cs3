import type { HistoryEvent } from '../types/history.ts';
import { formatHistorySize, formatRuntime } from './format.ts';

/**
 * Columns for Media History CSV export.
 * Column order is part of the export contract — appending is safe, reordering is not.
 */
export const HISTORY_EXPORT_COLUMNS = [
  '#',
  'Event ID',
  'Media Key',
  'Title',
  'Year',
  'Type',
  'Season',
  'Episode',
  'Episode Title',
  'Action',
  'Status',
  'Timestamp (ISO)',
  'Date Time (Local)',
  'Duration (sec)',
  'Duration (formatted)',
  'Provider',
  'Host / Extractor',
  'Source Title',
  'Resolution',
  'Quality',
  'Video Codec',
  'Audio Codecs',
  'Languages',
  'Size (Bytes)',
  'Size (formatted)',
  'Seeders',
  'Direct Source URL',
  'Magnet URI',
  'Media Details URL',
  'Discovered Sources Count',
  'Failure Reason',
  'Diagnostic Stage',
  'Diagnostic Code',
  'Diagnostic Details',
  'Request Headers',
] as const;

/** RFC 4180: quote any cell containing comma, quote, or newlines */
function csvCell(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return '';
  const str = String(value);
  return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

/**
 * Converts a single HistoryEvent into a CSV row array.
 */
export function historyExportRow(event: HistoryEvent, index: number): string[] {
  const src = event.source;
  const diag = event.diagnostics;

  const headers = src?.directHeaders && Object.keys(src.directHeaders).length > 0
    ? Object.entries(src.directHeaders)
        .map(([k, v]) => `${k}: ${v}`)
        .join('; ')
    : '';

  const dateLocal = new Date(event.timestamp).toLocaleString();
  const dateIso = new Date(event.timestamp).toISOString();

  return [
    String(index + 1),
    event.id ?? '',
    event.mediaKey ?? '',
    event.title ?? '',
    event.year ? String(event.year) : '',
    event.type ? String(event.type) : '',
    event.season !== undefined ? String(event.season) : '',
    event.episode !== undefined ? String(event.episode) : '',
    event.episodeTitle ?? '',
    event.action ?? '',
    event.status ?? '',
    dateIso,
    dateLocal,
    event.durationSeconds ? String(event.durationSeconds) : '',
    event.durationSeconds ? (formatRuntime(event.durationSeconds) ?? '') : '',
    src?.providerName ?? '',
    src?.indexerName ?? '',
    src?.sourceName ?? '',
    src?.resolution ? `${src.resolution}p` : '',
    src?.quality ?? '',
    src?.videoCodec ?? '',
    src?.audioCodecs?.join(' / ') ?? '',
    src?.languages?.join(' / ') ?? '',
    src?.sizeBytes ? String(src.sizeBytes) : '',
    src?.sizeBytes ? formatHistorySize(src.sizeBytes) : '',
    src?.seeders !== undefined ? String(src.seeders) : '',
    src?.directUrl ?? '',
    src?.magnet ?? '',
    event.mediaUrl ?? '',
    event.sourcesDiscovered?.length ? String(event.sourcesDiscovered.length) : '',
    event.failureReason ?? '',
    diag?.stage ?? '',
    diag?.code ?? '',
    diag?.details ?? '',
    headers,
  ];
}

/**
 * Converts an array of HistoryEvents into a complete RFC 4180 CSV string.
 */
export function toHistoryCsv(events: HistoryEvent[]): string {
  const rows: string[] = [HISTORY_EXPORT_COLUMNS.map(csvCell).join(',')];

  events.forEach((ev, idx) => {
    rows.push(historyExportRow(ev, idx).map(csvCell).join(','));
  });

  return rows.join('\r\n');
}

/**
 * Triggers a client-side download of the CSV file in the browser or Electron.
 */
export function downloadHistoryCsv(events: HistoryEvent[], filename?: string): void {
  const csv = toHistoryCsv(events);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;

  const dateStr = new Date().toISOString().slice(0, 10);
  link.download = filename || `cloudstream-media-history-${dateStr}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
