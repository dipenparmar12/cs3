/**
 * What an MPEG-TS segment carries, read from its program tables.
 *
 * Why this exists: an HLS media playlist can carry several audio languages as
 * separate elementary streams *inside* each segment, with no `#EXT-X-MEDIA`
 * line to announce them. Castle TV (CNC Verse) ships exactly that — one H.264
 * stream and four AAC streams tagged `eng`/`hin`/`tam`/`tel` in every `.jpg`
 * segment (measured 2026-10-14). The manifest fast path saw no audio
 * renditions and invented a single track, so the player never offered a
 * choice, while VLC listed all four.
 *
 * The PAT and PMT sit in the first few packets of every segment, so 64 KB of
 * the first segment answers the question at the cost of one ranged request —
 * not an ffprobe run. Pure: bytes in, streams out; `null` when the bytes are
 * not transport stream or the tables are not in them.
 */

export interface TsElementaryStream {
  pid: number;
  /** The PMT `stream_type`. */
  streamType: number;
  kind: 'video' | 'audio';
  /** ffprobe's name for the codec, so it compares with probe output. */
  codec: string;
  /** ISO 639-2 code from the language descriptor (0x0A), when present. */
  language?: string;
}

const PACKET = 188;
const SYNC = 0x47;

/** stream_type → codec, for the types that name their codec outright. */
const STREAM_TYPES: Record<number, { kind: 'video' | 'audio'; codec: string }> = {
  0x01: { kind: 'video', codec: 'mpeg1video' },
  0x02: { kind: 'video', codec: 'mpeg2video' },
  0x1b: { kind: 'video', codec: 'h264' },
  0x24: { kind: 'video', codec: 'hevc' },
  0x03: { kind: 'audio', codec: 'mp2' },
  0x04: { kind: 'audio', codec: 'mp2' },
  0x0f: { kind: 'audio', codec: 'aac' },
  0x11: { kind: 'audio', codec: 'aac_latm' },
  0x81: { kind: 'audio', codec: 'ac3' },
  0x87: { kind: 'audio', codec: 'eac3' },
};

/** Private data (0x06) is audio only when a descriptor says which codec. */
const PRIVATE_AUDIO_DESCRIPTORS: Record<number, string> = {
  0x6a: 'ac3',
  0x7a: 'eac3',
  0x7b: 'dts',
};

/** The offset of the first packet boundary, or -1 when this is not TS. */
function alignment(bytes: Uint8Array): number {
  const limit = Math.min(bytes.length - PACKET * 2, PACKET * 4);
  for (let offset = 0; offset < limit; offset++) {
    if (bytes[offset] === SYNC && bytes[offset + PACKET] === SYNC && bytes[offset + PACKET * 2] === SYNC) {
      return offset;
    }
  }
  return -1;
}

/** The PSI section starting in this packet's payload, or null. */
function sectionIn(bytes: Uint8Array, at: number): Uint8Array | null {
  const unitStart = (bytes[at + 1] & 0x40) !== 0;
  if (!unitStart) return null;
  const adaptation = (bytes[at + 3] >> 4) & 0x3;
  if (adaptation === 0 || adaptation === 2) return null; // no payload
  let payload = at + 4;
  if (adaptation === 3) payload += 1 + bytes[at + 4];
  const pointer = bytes[payload];
  const start = payload + 1 + pointer;
  const end = at + PACKET;
  if (start + 3 > end) return null;
  const length = ((bytes[start + 1] & 0x0f) << 8) | bytes[start + 2];
  // A table that spills into the next packet is not read; real PMTs fit in one.
  if (start + 3 + length > end) return null;
  return bytes.subarray(start, start + 3 + length);
}

export function readTsStreams(bytes: Uint8Array): TsElementaryStream[] | null {
  const first = alignment(bytes);
  if (first < 0) return null;

  let pmtPid = -1;
  for (let at = first; at + PACKET <= bytes.length; at += PACKET) {
    if (bytes[at] !== SYNC) return null;
    const pid = ((bytes[at + 1] & 0x1f) << 8) | bytes[at + 2];

    if (pmtPid < 0 && pid === 0x0000) {
      const pat = sectionIn(bytes, at);
      if (!pat || pat[0] !== 0x00) continue;
      // Programs run from byte 8 to the CRC; program 0 is the network table.
      for (let i = 8; i + 4 <= pat.length - 4; i += 4) {
        const program = (pat[i] << 8) | pat[i + 1];
        if (program === 0) continue;
        pmtPid = ((pat[i + 2] & 0x1f) << 8) | pat[i + 3];
        break;
      }
      continue;
    }

    if (pmtPid >= 0 && pid === pmtPid) {
      const pmt = sectionIn(bytes, at);
      if (!pmt || pmt[0] !== 0x02) continue;
      const programInfo = ((pmt[10] & 0x0f) << 8) | pmt[11];
      const streams: TsElementaryStream[] = [];
      const end = pmt.length - 4; // CRC32
      for (let i = 12 + programInfo; i + 5 <= end; ) {
        const streamType = pmt[i];
        const esPid = ((pmt[i + 1] & 0x1f) << 8) | pmt[i + 2];
        const infoLength = ((pmt[i + 3] & 0x0f) << 8) | pmt[i + 4];
        let language: string | undefined;
        let privateCodec: string | undefined;
        for (let d = i + 5; d + 2 <= i + 5 + infoLength && d + 2 <= end; ) {
          const tag = pmt[d];
          const size = pmt[d + 1];
          if (tag === 0x0a && size >= 3) {
            const code = String.fromCharCode(pmt[d + 2], pmt[d + 3], pmt[d + 4]).trim();
            if (/^[a-z]{3}$/i.test(code)) language = code.toLowerCase();
          }
          if (PRIVATE_AUDIO_DESCRIPTORS[tag]) privateCodec = PRIVATE_AUDIO_DESCRIPTORS[tag];
          d += 2 + size;
        }
        const known =
          STREAM_TYPES[streamType] ??
          (streamType === 0x06 && privateCodec ? { kind: 'audio' as const, codec: privateCodec } : undefined);
        if (known) streams.push({ pid: esPid, streamType, kind: known.kind, codec: known.codec, language });
        i += 5 + infoLength;
      }
      return streams;
    }
  }
  return null;
}
