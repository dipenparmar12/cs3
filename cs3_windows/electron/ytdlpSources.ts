/**
 * What yt-dlp just told us about a page, as this app's source shape.
 *
 * Pure and separate from `ytdlpEngine.ts` for two reasons. `ytdlpEngine`
 * imports `electron`, so nothing that imports it can be tested under Node's
 * type stripping; and the mapping is where the failures that matter live.
 *
 * ## The three rules, and why each is a rule
 *
 * **The transport comes from `protocol`, never from the URL.** yt-dlp states
 * `m3u8_native` or `http_dash_segments` in the same object as the address, and
 * the implementation this replaces read `url.includes('.m3u8')` with that field
 * sitting unread beside it. AGENTS.md §5 settled this argument twice already —
 * `cs3/providerLinks.ts` exists because a provider's own answer outranks a guess
 * about a filename, and a `.php` route serving a playlist is routine.
 *
 * **A format with no audio is not a source.** The old mapper accepted any format
 * with `vcodec !== 'none'` *or* `acodec !== 'none'`, which on every site that
 * serves DASH — YouTube among them — means the top rows are video-only. Those
 * play perfectly and in total silence, which is the single most expensive class
 * of bug in this codebase's history (see the AC-3 finding: correct duration, no
 * error event, no sound). A viewer diagnoses that as a broken app, not as a
 * format choice, so an unpaired video stream is dropped.
 *
 * **Nothing is invented.** A page yt-dlp does not know produces no rows and a
 * reason; it never produces a search result standing in for the title. The
 * previous `searchAndExtract` fell back to `ytsearch1:<query> official trailer`,
 * which is a synthetic source under a different name — the one thing AGENTS.md
 * says never to reintroduce.
 */
import { directSourceIdentity } from './torrent/indexers/base.ts';
import { parseReleaseName } from './torrent/releaseParser.ts';
import type { ParsedRelease, TorrentResult } from '../src/types/torrent';

/** The subset of `yt-dlp --dump-single-json` this reads. */
export interface YtDlpFormat {
  url?: string;
  format_id?: string;
  format_note?: string;
  /** `https`, `m3u8_native`, `http_dash_segments`, `mhtml`… */
  protocol?: string;
  ext?: string;
  vcodec?: string;
  acodec?: string;
  height?: number;
  width?: number;
  tbr?: number;
  filesize?: number;
  filesize_approx?: number;
  http_headers?: Record<string, string>;
}

export interface YtDlpInfo {
  title?: string;
  webpage_url?: string;
  extractor?: string;
  extractor_key?: string;
  duration?: number;
  /** `YYYYMMDD`, yt-dlp's own spelling. */
  upload_date?: string;
  /**
   * Author-supplied subtitles, by language. **Not** `automatic_captions`.
   *
   * Machine transcription is a different claim about quality, and offering it
   * as a subtitle track means a viewer reads a guess at the dialogue believing
   * it is the dialogue. Where a publisher uploaded real subtitles they are
   * worth having, and where they did not the honest answer is none.
   */
  subtitles?: Record<string, Array<{ url?: string; ext?: string; name?: string }>>;
  formats?: YtDlpFormat[];
  http_headers?: Record<string, string>;
  url?: string;
  protocol?: string;
  ext?: string;
  height?: number;
  vcodec?: string;
  acodec?: string;
}

/** How many rows one page may contribute. */
export const MAX_ROWS = 8;

const NONE = (codec: string | undefined): boolean =>
  !codec || codec === 'none' || codec.startsWith('none');

/** True when the format carries both halves of a playable stream. */
function isPlayable(format: YtDlpFormat): boolean {
  if (!format.url) return false;
  // A manifest names its own tracks, so its top-level codec fields are often
  // unset — refusing those would drop every HLS and DASH row.
  if (isManifest(format.protocol)) return true;
  // `mhtml` is yt-dlp's storyboard format: a grid of thumbnails, not video.
  if (format.protocol === 'mhtml' || format.ext === 'mhtml') return false;
  return !NONE(format.vcodec) && !NONE(format.acodec);
}

function isManifest(protocol: string | undefined): boolean {
  return Boolean(protocol && (protocol.includes('m3u8') || protocol.includes('dash')));
}

export function isHls(protocol: string | undefined): boolean {
  return Boolean(protocol?.includes('m3u8'));
}

export function isDash(protocol: string | undefined): boolean {
  return Boolean(protocol?.includes('dash'));
}

/**
 * The rows one resolved page contributes.
 *
 * Ordered by height so the source picker's first row is the best one, deduped on
 * height plus transport — a site listing six bitrates of 1080p is offering one
 * choice to a viewer, and six rows of it push the 720p fallback off the screen.
 */
export function mapYtDlpInfo(info: YtDlpInfo, pageUrl: string): TorrentResult[] {
  const title = info.title?.trim() || pageUrl;
  const origin = info.extractor_key || info.extractor || 'yt-dlp';

  const formats: YtDlpFormat[] = info.formats?.length
    ? info.formats
    : // A single-format extractor reports the stream at the top level rather
      // than in a list of one.
      info.url
      ? [{
          url: info.url,
          protocol: info.protocol,
          ext: info.ext,
          height: info.height,
          vcodec: info.vcodec,
          acodec: info.acodec,
          http_headers: info.http_headers,
        }]
      : [];

  const playable = formats.filter(isPlayable);

  const seen = new Set<string>();
  const rows: TorrentResult[] = [];

  for (const format of [...playable].sort(byQualityDescending)) {
    const key = `${format.height ?? 0}:${isHls(format.protocol)}:${isDash(format.protocol)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const label = format.format_note || (format.height ? `${format.height}p` : format.ext) || 'stream';
    const parsed = parseReleaseName(`${title} ${format.height ? `${format.height}p` : ''}`.trim());

    rows.push({
      infoHash: directSourceIdentity(format.url as string),
      directUrl: format.url as string,
      // Many sites 403 without the Referer and User-Agent yt-dlp negotiated;
      // the per-format headers win, because a manifest and its segments can be
      // served from different hosts.
      directHeaders: format.http_headers ?? info.http_headers,
      isM3u8: isHls(format.protocol) || undefined,
      isDash: isDash(format.protocol) || undefined,
      magnet: '',
      title: `${title} — ${label}`,
      sizeBytes: format.filesize ?? format.filesize_approx ?? 0,
      // Swarm health is meaningless for an HTTP stream; 1 keeps it above the
      // `minSeeders` floor that would otherwise reject every row.
      seeders: 1,
      leechers: 0,
      indexerId: 'yt-dlp',
      indexerName: origin,
      parsed: {
        ...parsed,
        resolution: (format.height || parsed.resolution) as ParsedRelease['resolution'],
      },
      score: format.height ?? 0,
      scoreReasons: [
        `Resolved by yt-dlp from ${origin}`,
        isHls(format.protocol) ? 'HLS playlist' : isDash(format.protocol) ? 'DASH manifest' : 'Progressive file',
      ],
    });

    if (rows.length >= MAX_ROWS) break;
  }

  return rows;
}

function byQualityDescending(a: YtDlpFormat, b: YtDlpFormat): number {
  return (b.height ?? 0) - (a.height ?? 0) || (b.tbr ?? 0) - (a.tbr ?? 0);
}

/**
 * The stream to play a trailer from.
 *
 * Deliberately not {@link mapYtDlpInfo}. That produces a *source list* for the
 * picker — eight rows, one per rung of a quality ladder, ranked and deduped,
 * because choosing between releases of a film is a real decision. Nobody makes
 * that decision about a two-minute trailer, so this answers with one stream and
 * the whole picker is skipped.
 *
 * Three rules, each of which changes what the viewer gets:
 *
 * **A pre-muxed progressive format wins over anything else.** It carries both
 * tracks in one file, so the compatibility engine has nothing to do: no remux,
 * no ffmpeg process, no routing to mpv and its separate window for a promo
 * clip. On YouTube that is format 22 (720p H.264 + AAC) or 18 (360p), and both
 * decode natively in Chromium.
 *
 * **Height is capped.** Above 1080 a trailer is a DASH ladder with separate
 * video and audio, which is exactly the shape that would drag in the
 * transcoder. The cap keeps this on the cheap path; nobody is studying grain
 * structure in a teaser.
 *
 * **A manifest is the fallback, never the preference.** Some extractors publish
 * only HLS. It plays — `media:prepare` classifies it and hls.js handles it —
 * but it costs a manifest fetch and a ladder, so it is taken only when there is
 * no muxed file at all.
 */
export const MAX_PROMO_HEIGHT = 1080;

export interface PromoStream {
  url: string;
  headers?: Record<string, string>;
  /**
   * A second address carrying the audio.
   *
   * Set only when the video half has none of its own, which on YouTube is
   * every rung above 360p. The caller muxes the two; see
   * `ContentService.resolvePromoVideo`.
   */
  audioUrl?: string;
  audioHeaders?: Record<string, string>;
  isM3u8?: boolean;
  isDash?: boolean;
  /** Height, where the extractor reported one. For the caller's diagnostics. */
  height?: number;
}

/**
 * The best trailer stream, given whether the app can mux two inputs.
 *
 * ## Measured 2026-09-18, and this is the whole reason the function is shaped
 * this way
 *
 * YouTube publishes exactly **one** muxed format — id 18, 360p H.264 + AAC —
 * and every rung above it is video-only DASH. Worse, that one muxed rung is
 * increasingly *refused*: across eight trailer ids taken from Cinemeta, format
 * 18 answered `HTTP 403` on **five of eight**, and yt-dlp itself gets the same
 * 403 when asked to download them, so it is the URL being rejected rather than
 * anything about how we fetch it. No extraction client changes that — `tv`,
 * `ios`, `android_vr`, `web_safari`, `mweb` and `tv_simply` were all measured
 * at 0 of 5.
 *
 * The separate rungs are fine. On the same eight, video 137 (1080p, avc1) and
 * audio 140 (m4a) both answered `HTTP 206` **every time**.
 *
 * So: when the app can mux — ffmpeg is in the box, so this is the default —
 * take the pair and get reliable 1080p. When it cannot, take format 18 and get
 * unreliable 360p, which is still better than refusing to play anything.
 */
export function pickPromoStream(info: YtDlpInfo, canMux: boolean): PromoStream | null {
  const formats: YtDlpFormat[] = info.formats?.length
    ? info.formats
    : info.url
      ? [{
          url: info.url,
          protocol: info.protocol,
          ext: info.ext,
          height: info.height,
          vcodec: info.vcodec,
          acodec: info.acodec,
          http_headers: info.http_headers,
        }]
      : [];

  const within = (format: YtDlpFormat) => (format.height ?? 0) <= MAX_PROMO_HEIGHT;

  if (canMux) {
    /**
     * A video-only rung and an audio-only rung, both progressive.
     *
     * `mp4`/`m4a` rather than whatever is highest: those are H.264 and AAC, so
     * the mux is a stream copy and the browser decodes the result natively. The
     * `webm` rungs beside them are VP9 and Opus, which would play too but give
     * ffmpeg a reason to re-encode on a machine without a VP9 decoder — paying
     * a whole CPU core for a trailer.
     */
    const video = formats
      .filter(
        (format) =>
          format.url &&
          !NONE(format.vcodec) &&
          NONE(format.acodec) &&
          !isManifest(format.protocol) &&
          format.ext === 'mp4' &&
          within(format)
      )
      .sort(byQualityDescending)[0];
    const audio = formats
      .filter(
        (format) =>
          format.url &&
          NONE(format.vcodec) &&
          !NONE(format.acodec) &&
          !isManifest(format.protocol) &&
          format.ext === 'm4a'
      )
      .sort((a, b) => (b.tbr ?? 0) - (a.tbr ?? 0))[0];

    if (video?.url && audio?.url) {
      return {
        url: video.url,
        headers: video.http_headers ?? info.http_headers,
        audioUrl: audio.url,
        audioHeaders: audio.http_headers ?? info.http_headers,
        height: video.height,
      };
    }
    // No usable pair — fall through to the single-stream rules below rather
    // than refusing: an extractor that publishes only muxed formats is the
    // ordinary case for every site that is not YouTube.
  }

  const playable = formats.filter(isPlayable);
  if (playable.length === 0) return null;

  // Muxed and progressive: both tracks, one file, nothing for the engine to do.
  const progressive = playable
    .filter((format) => !isManifest(format.protocol) && within(format))
    .sort(byQualityDescending);

  // Nothing under the cap is still better than nothing at all — a 4K-only
  // upload should play rather than be refused over a preference.
  const chosen =
    progressive[0] ??
    playable.filter((format) => !isManifest(format.protocol)).sort(byQualityDescending)[0] ??
    playable.filter((format) => within(format)).sort(byQualityDescending)[0] ??
    [...playable].sort(byQualityDescending)[0];

  if (!chosen?.url) return null;
  return {
    url: chosen.url,
    headers: chosen.http_headers ?? info.http_headers,
    isM3u8: isHls(chosen.protocol) || undefined,
    isDash: isDash(chosen.protocol) || undefined,
    height: chosen.height,
  };
}

/**
 * Whether a string is a page address this lane could be asked about.
 *
 * Deliberately not a list of the ~1,800 sites yt-dlp knows: that list changes
 * weekly, ships inside the binary, and asking it is what the resolve call
 * already does. Everything this needs to decide is whether the *user* handed
 * over a web page rather than a search term.
 */
export function looksLikeWebPage(value: string): boolean {
  const text = value.trim();
  if (!/^https?:\/\/\S+$/i.test(text)) return false;
  try {
    const url = new URL(text);
    return Boolean(url.hostname) && url.hostname.includes('.');
  } catch {
    return false;
  }
}
