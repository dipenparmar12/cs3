import type { TorrentResult } from '../types/torrent';

/**
 * Turning a source list into something a person can read, paste, or feed to
 * another tool.
 *
 * The list on screen answers "which of these should I play". It deliberately
 * does not answer the question underneath it — **where is this actually coming
 * from, and what is the address?** — because a row wide enough to hold a signed
 * CDN URL is a row too wide to scan. Those facts still have to be reachable,
 * for three reasons that have nothing to do with debugging:
 *
 * - a viewer whose stream will not play can hand the link to a downloader or a
 *   browser that will,
 * - a provider that starts returning dead links can only be turned off if you
 *   can tell which extension and which repository it came from,
 * - and a report that names a file host ("Voe", "Server 3") names the
 *   *extractor*, not the provider that chose it.
 *
 * CSV is the default because the interesting operation on thirty sources is
 * sorting and filtering them, and every machine already has something that does
 * that. `toSourceText` exists for the case where it is going into a chat window
 * rather than a spreadsheet.
 */

export interface SourceProvenance {
  provider?: string;
  extensionName?: string;
  repositoryName?: string;
}

/** Column order is the export contract — appending is safe, reordering is not. */
export const SOURCE_EXPORT_COLUMNS = [
  '#',
  'Title',
  'Resolution',
  'Quality',
  'Video codec',
  'Audio',
  'Languages',
  'HDR',
  'Size',
  'Type',
  'Provider',
  'Extension',
  'Repository',
  'Host/extractor',
  'Seeders',
  'Identity',
  'URL',
  'Headers',
] as const;

function sizeLabel(bytes: number): string {
  if (!bytes) return '';
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${(bytes / 1e6).toFixed(0)} MB`;
}

/**
 * The address that actually identifies the source — never the loopback one.
 *
 * By the time a stream is playing, its URL has been through `mediaProxy` and
 * reads `http://127.0.0.1:<ephemeral>/…`. That names our own process, is dead
 * the moment the app closes, and is worse than useless to anyone receiving it:
 * it looks like a working link and is not one.
 */
export function sourceAddress(source: TorrentResult): string {
  return source.directUrl || source.magnet || source.torrentUrl || '';
}

/** What the row would say if it had unlimited width. */
export function sourceExportRow(
  source: TorrentResult,
  index: number,
  provenance?: SourceProvenance
): string[] {
  const parsed = source.parsed;
  const headers = source.directHeaders
    ? Object.entries(source.directHeaders)
        .map(([key, value]) => `${key}: ${value}`)
        .join('; ')
    : '';

  return [
    String(index + 1),
    source.title ?? '',
    parsed?.resolution ? `${parsed.resolution}p` : '',
    parsed?.source && parsed.source !== 'Unknown' ? parsed.source : '',
    parsed?.videoCodec && parsed.videoCodec !== 'Unknown' ? parsed.videoCodec : '',
    parsed?.audioCodecs?.join('/') ?? '',
    parsed?.languages?.join('/') ?? '',
    parsed?.hdr?.join('/') ?? '',
    sizeLabel(source.sizeBytes),
    source.directUrl ? (source.isM3u8 ? 'hls' : 'direct') : 'torrent',
    provenance?.provider ?? source.providerName ?? '',
    provenance?.extensionName ?? '',
    provenance?.repositoryName ?? '',
    /**
     * Kept as its own column rather than merged into Provider. For an extension
     * link `indexerName` is the *extractor* the provider picked — a file host —
     * and collapsing the two would attribute a dead link to whichever host was
     * unlucky instead of to the extension that chose it.
     */
    source.indexerName ?? '',
    source.seeders ? String(source.seeders) : '',
    source.infoHash ?? '',
    sourceAddress(source),
    headers,
  ];
}

/** RFC 4180: quote anything containing a comma, a quote or a newline. */
function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toSourceCsv(
  sources: TorrentResult[],
  provenanceFor?: (source: TorrentResult) => SourceProvenance | undefined
): string {
  const lines = [SOURCE_EXPORT_COLUMNS.map(csvCell).join(',')];
  sources.forEach((source, index) => {
    lines.push(sourceExportRow(source, index, provenanceFor?.(source)).map(csvCell).join(','));
  });
  return lines.join('\r\n');
}

/**
 * The same facts as prose, for pasting somewhere a spreadsheet is not going to
 * open — a chat window, an issue, a message to a provider maintainer.
 */
export function toSourceText(
  sources: TorrentResult[],
  provenanceFor?: (source: TorrentResult) => SourceProvenance | undefined,
  heading?: string
): string {
  const blocks = sources.map((source, index) => {
    const cells = sourceExportRow(source, index, provenanceFor?.(source));
    const facts = SOURCE_EXPORT_COLUMNS.map((column, column_index) => [column, cells[column_index]] as const)
      .filter(([column, value]) => column !== '#' && column !== 'Title' && value)
      .map(([column, value]) => `     ${column}: ${value}`)
      .join('\n');
    return `${index + 1}. ${source.title}\n${facts}`;
  });
  return `${heading ?? `Sources (${sources.length})`}\n\n${blocks.join('\n\n')}`;
}

/** A short "where did this come from" line: repository ▸ extension ▸ provider. */
export function provenanceChain(
  source: TorrentResult,
  provenance?: SourceProvenance
): string {
  return [
    provenance?.repositoryName,
    provenance?.extensionName,
    provenance?.provider ?? source.providerName,
  ]
    .filter(Boolean)
    .join(' ▸ ');
}

/** The host a direct link points at — the one part of a URL worth showing inline. */
export function sourceHost(source: TorrentResult): string | null {
  const address = source.directUrl;
  if (!address) return null;
  try {
    return new URL(address).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}
