import { classOf, type MediaClass, type SniffResult } from './sourceSniff.ts';

/**
 * Nonstandard responses, named (Provider Compatibility Audit PRD §7, N-1 to
 * N-17). Each detector reads what S6 and S7 already observed and fires only on
 * its own evidence; a clean MP4 over HTTPS with the right type fires nothing.
 * A quirk is a fact about the source, not a verdict: whether the app copes is
 * what S8 and S9 then show. Pure.
 */
export type QuirkCode =
  | 'N-1'
  | 'N-2'
  | 'N-3'
  | 'N-4'
  | 'N-5'
  | 'N-6'
  | 'N-7'
  | 'N-8'
  | 'N-9'
  | 'N-10'
  | 'N-11'
  | 'N-12'
  | 'N-13'
  | 'N-14'
  | 'N-15'
  | 'N-16'
  | 'N-17';

export const QUIRK_LABELS: Record<QuirkCode, string> = {
  'N-1': 'ext-mismatch',
  'N-2': 'mime-mismatch',
  'N-3': 'wrapped-ts',
  'N-4': 'disguised-hls',
  'N-5': 'redirector',
  'N-6': 'envelope',
  'N-7': 'html-page-as-stream',
  'N-8': 'unsupported-scheme',
  'N-9': 'torrent',
  'N-10': 'live',
  'N-11': 'drm',
  'N-12': 'range',
  'N-13': 'header-gated',
  'N-14': 'encoded',
  'N-15': 'subtitle-odd',
  'N-16': 'archive',
  'N-17': 'side-files',
};

export interface SourceObservation {
  /** Read for its scheme and extension only; never stored. */
  url: string;
  contentType?: string;
  sniff?: SniffResult;
  /** Hops followed before the final answer. */
  redirects?: number;
  range?: 'honoured' | 'ignored' | 'bounded-only' | 'refused';
  /** Headers the differential retry showed the source needs (names). */
  requiredHeaders?: string[];
  contentEncoding?: string;
  /** `null`: the answer stated no length. */
  contentLength?: number | null;
  /** The provider declared it a torrent or magnet (`isTorrentLink`). */
  torrent?: boolean;
  drm?: string;
  live?: boolean;
  /** HLS media segment URLs, as the manifest names them. */
  segmentUrls?: string[];
  audioTracks?: number;
  playlistParts?: number;
  /** A subtitle the provider offered, as sniffed: extension, BOM, charset. */
  subtitle?: { format: string; bom?: boolean; charset?: string };
}

export interface Quirk {
  code: QuirkCode;
  label: string;
  detail: string;
}

const EXTENSION_CLASS: Record<string, MediaClass> = {
  m3u8: 'manifest',
  mpd: 'manifest',
  mp4: 'video',
  m4v: 'video',
  mkv: 'video',
  webm: 'video',
  ts: 'video',
  avi: 'video',
  flv: 'video',
  mp3: 'audio',
  aac: 'audio',
  m4a: 'audio',
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  gif: 'image',
  webp: 'image',
  ico: 'image',
  css: 'other',
  txt: 'other',
  js: 'other',
  html: 'page',
  htm: 'page',
  php: 'page',
  json: 'data',
  xml: 'data',
};

function extensionOf(url: string): string | undefined {
  try {
    const last = new URL(url).pathname.split('/').pop() ?? '';
    const dot = last.lastIndexOf('.');
    return dot > 0 ? last.slice(dot + 1).toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

function schemeOf(url: string): string {
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(url.trim());
  return match ? match[1].toLowerCase() : '';
}

function contentTypeClass(contentType: string | undefined): MediaClass | undefined {
  const type = contentType?.split(';')[0].trim().toLowerCase();
  if (!type || type === 'application/octet-stream' || type === 'binary/octet-stream') return undefined;
  if (/mpegurl|dash\+xml/.test(type)) return 'manifest';
  if (type.startsWith('video/') || type === 'application/mp4') return 'video';
  if (type.startsWith('audio/')) return 'audio';
  if (type.startsWith('image/')) return 'image';
  if (type === 'text/html' || type === 'application/xhtml+xml') return 'page';
  if (type === 'application/json' || type.endsWith('/xml') || type.endsWith('+json')) return 'data';
  if (type.startsWith('text/')) return 'other';
  return undefined;
}

const PLAYABLE: ReadonlySet<MediaClass> = new Set<MediaClass>(['manifest', 'video', 'audio']);

export function detectQuirks(source: SourceObservation): Quirk[] {
  const found: Quirk[] = [];
  const add = (code: QuirkCode, detail: string) => found.push({ code, label: QUIRK_LABELS[code], detail });
  const scheme = schemeOf(source.url);
  const extension = extensionOf(source.url);
  const extensionClass = extension ? EXTENSION_CLASS[extension] : undefined;
  const sniffed = source.sniff && source.sniff.confidence === 'high' ? source.sniff : undefined;
  const bodyClass = sniffed ? classOf(sniffed.kind) : undefined;

  // A body that is media under a name that says otherwise, or the reverse.
  if (
    extensionClass &&
    bodyClass &&
    extensionClass !== bodyClass &&
    (PLAYABLE.has(bodyClass) || PLAYABLE.has(extensionClass)) &&
    !(extensionClass === 'page' && extension === 'php')
  ) {
    add('N-1', `.${extension} serves ${sniffed!.kind}`);
  }
  const typeClass = contentTypeClass(source.contentType);
  if (typeClass && bodyClass && typeClass !== bodyClass && (PLAYABLE.has(bodyClass) || PLAYABLE.has(typeClass))) {
    add('N-2', `${source.contentType} serves ${sniffed!.kind}`);
  }
  if (sniffed?.kind === 'png+ts' || sniffed?.kind === 'jpeg+ts') add('N-3', sniffed.evidence);
  const disguised = (source.segmentUrls ?? []).filter((url) => {
    const ext = extensionOf(url);
    return !ext || !PLAYABLE.has(EXTENSION_CLASS[ext] ?? 'other');
  });
  if (disguised.length > 0) add('N-4', `${disguised.length} of ${source.segmentUrls!.length} segments not named as media`);
  if ((source.redirects ?? 0) >= 2 || extension === 'php' || /\/go\//i.test(source.url)) {
    add('N-5', `${source.redirects ?? 0} redirects`);
  }
  if (source.sniff?.kind === 'json') add('N-6', 'JSON where media was expected');
  if (sniffed?.kind === 'html') add('N-7', 'an HTML page where media was expected');
  if (scheme && !['http', 'https', 'magnet'].includes(scheme)) add('N-8', `${scheme}://`);
  if (source.torrent || scheme === 'magnet' || sniffed?.kind === 'torrent') add('N-9', 'torrent lane');
  if (source.live) add('N-10', 'no end to the stream');
  if (source.drm) add('N-11', source.drm);
  if (source.range && source.range !== 'honoured') add('N-12', `range ${source.range}`);
  if (source.requiredHeaders?.length) add('N-13', `requires ${source.requiredHeaders.join(', ')}`);
  const encoding = source.contentEncoding?.toLowerCase();
  if ((encoding && encoding !== 'identity' && bodyClass && PLAYABLE.has(bodyClass)) || source.contentLength === null) {
    add('N-14', encoding && encoding !== 'identity' ? `content-encoding ${encoding}` : 'no length stated');
  }
  if (source.subtitle) {
    const format = source.subtitle.format.toLowerCase();
    const plain = (format === 'vtt' || format === 'srt') && !source.subtitle.bom;
    const charset = source.subtitle.charset?.toLowerCase();
    if (!plain || (charset && charset !== 'utf-8')) {
      add('N-15', [format, source.subtitle.bom ? 'BOM' : '', charset ?? ''].filter(Boolean).join(', '));
    }
  }
  if (sniffed?.kind === 'archive') add('N-16', 'an archive, not a stream');
  if ((source.audioTracks ?? 0) > 0 || (source.playlistParts ?? 0) > 1) {
    add('N-17', `${source.audioTracks ?? 0} audio files, ${source.playlistParts ?? 1} parts`);
  }
  return found;
}
