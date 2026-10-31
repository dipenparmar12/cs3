/**
 * What the first bytes of a source really are (Provider Compatibility Audit
 * PRD §7): magic numbers, never the URL's extension, so a URL's claim can be
 * set beside the body and the disagreement reported.
 *
 * `<MPD` makes DASH; any other XML is `xml-other` (an error page served as XML
 * is the H-01 case). A PNG or JPEG header followed by MPEG-TS sync bytes is
 * the image-wrapped TS some hosts serve to dodge filters. Pure.
 */
export type SniffKind =
  | 'm3u8'
  | 'mpd'
  | 'mp4'
  | 'mkv'
  | 'ts'
  | 'png+ts'
  | 'jpeg+ts'
  | 'flv'
  | 'avi'
  | 'ogg'
  | 'mp3'
  | 'aac'
  | 'flac'
  | 'html'
  | 'json'
  | 'xml-other'
  | 'archive'
  | 'torrent'
  | 'image'
  | 'empty'
  | 'unknown';

export interface SniffResult {
  kind: SniffKind;
  confidence: 'high' | 'low';
  evidence: string;
}

/** The broad class a kind belongs to, for comparing a body with a claim. */
export type MediaClass = 'manifest' | 'video' | 'audio' | 'page' | 'data' | 'image' | 'other';

export function classOf(kind: SniffKind): MediaClass {
  switch (kind) {
    case 'm3u8':
    case 'mpd':
      return 'manifest';
    case 'mp4':
    case 'mkv':
    case 'ts':
    case 'png+ts':
    case 'jpeg+ts':
    case 'flv':
    case 'avi':
    case 'ogg':
      return 'video';
    case 'mp3':
    case 'aac':
    case 'flac':
      return 'audio';
    case 'html':
      return 'page';
    case 'json':
    case 'xml-other':
      return 'data';
    case 'image':
      return 'image';
    default:
      return 'other';
  }
}

const TS_PACKET = 188;

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, i) => bytes[offset + i] === byte);
}

/** Sync byte 0x47 at `start` and every 188 bytes after, for at least three packets. */
function tsFrom(bytes: Uint8Array, start: number): boolean {
  let packets = 0;
  for (let i = start; i < bytes.length; i += TS_PACKET) {
    if (bytes[i] !== 0x47) return false;
    packets++;
  }
  return packets >= 3;
}

/** The first TS sync run after an image header, within the bytes read. */
function wrappedTs(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length - TS_PACKET * 3, 16 * 1024);
  for (let i = 8; i <= limit; i++) if (bytes[i] === 0x47 && tsFrom(bytes, i)) return true;
  return false;
}

function text(bytes: Uint8Array, length = 512): string {
  let out = '';
  const end = Math.min(bytes.length, length);
  // A UTF-8 byte-order mark is not part of the text.
  const start = startsWith(bytes, [0xef, 0xbb, 0xbf]) ? 3 : 0;
  for (let i = start; i < end; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

export function sniff(bytes: Uint8Array): SniffResult {
  const hit = (kind: SniffKind, evidence: string, confidence: 'high' | 'low' = 'high'): SniffResult => ({
    kind,
    confidence,
    evidence,
  });
  if (bytes.length === 0) return hit('empty', 'no bytes');

  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) {
    return wrappedTs(bytes) ? hit('png+ts', 'PNG header, then TS sync bytes') : hit('image', 'PNG header');
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return wrappedTs(bytes) ? hit('jpeg+ts', 'JPEG header, then TS sync bytes') : hit('image', 'JPEG header');
  }
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38]) || (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8))) {
    return hit('image', 'GIF or WebP header');
  }
  if (bytes[0] === 0x47 && tsFrom(bytes, 0)) return hit('ts', 'TS sync byte every 188 bytes');
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return hit('mkv', 'EBML header');
  const box = text(bytes.subarray(4, 8), 4);
  if (box === 'ftyp' || box === 'styp' || box === 'moof' || box === 'moov') return hit('mp4', `${box} box`);
  if (startsWith(bytes, [0x46, 0x4c, 0x56])) return hit('flv', 'FLV header');
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && text(bytes.subarray(8, 12), 4) === 'AVI ') return hit('avi', 'RIFF AVI');
  if (startsWith(bytes, [0x4f, 0x67, 0x67, 0x53])) return hit('ogg', 'OggS');
  if (startsWith(bytes, [0x66, 0x4c, 0x61, 0x43])) return hit('flac', 'fLaC');
  if (startsWith(bytes, [0x49, 0x44, 0x33]) || (bytes[0] === 0xff && (bytes[1] & 0xe6) === 0xe2)) {
    return hit('mp3', 'ID3 tag or MPEG audio frame', 'low');
  }
  if (bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0) return hit('aac', 'ADTS frame', 'low');
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x52, 0x61, 0x72, 0x21]) || startsWith(bytes, [0x37, 0x7a, 0xbc, 0xaf]) || startsWith(bytes, [0x1f, 0x8b])) {
    return hit('archive', 'zip, rar, 7z or gzip header');
  }

  const head = text(bytes).trimStart();
  if (head.startsWith('#EXTM3U')) return hit('m3u8', '#EXTM3U');
  if (head.startsWith('d8:announce') || head.startsWith('d4:info')) return hit('torrent', 'bencoded dictionary');
  const lower = head.toLowerCase();
  if (/<mpd[\s>]/.test(lower)) return hit('mpd', '<MPD');
  if (lower.startsWith('<!doctype html') || lower.startsWith('<html') || /<(head|body|iframe|script)[\s>]/.test(lower)) {
    return hit('html', 'HTML markup');
  }
  if (lower.startsWith('<?xml') || lower.startsWith('<')) return hit('xml-other', 'XML that is not an MPD');
  if (head.startsWith('{') || head.startsWith('[')) return hit('json', 'JSON', 'low');
  return hit('unknown', 'no known signature', 'low');
}
