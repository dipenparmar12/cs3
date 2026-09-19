/**
 * What YouTube will tell us about a video without an API key.
 *
 * ## The gap this fills, measured
 *
 * Cinemeta hands back 2–5 YouTube ids per title and no usable description of
 * any of them — `trailers[].type` is the string `"Trailer"` on every entry
 * including the teasers, and `trailerStreams[].title` is the *film's* name
 * repeated. So without this the gallery would be five identical cards reading
 * "Trailer".
 *
 * The **oEmbed endpoint** closes that, and it is the rare third-party lookup
 * that costs almost nothing:
 *
 *     GET https://www.youtube.com/oembed?url=<watch url>&format=json
 *     → { title, author_name, author_url, thumbnail_url, … }
 *
 * Measured 2026-09-18, twelve ids issued in parallel: **201 ms for all of
 * them**, ~190 ms each. It needs no key, no quota and no account, which is the
 * binding constraint on every source in this directory — see
 * `src/types/metadata.ts` for why a key embedded in a distributed GPL client is
 * both a licence violation and a key that gets revoked for everyone at once.
 *
 * ## What it does not give, and why that is accepted rather than worked around
 *
 * **No duration and no publish date.** Both sit in the watch page's
 * `ytInitialPlayerResponse`, at roughly byte 748,000 of a 1.28 MB document —
 * about a megabyte and a second per card to print "2:31" under a thumbnail.
 * Measured, not assumed. The fields stay on `TitleVideo` and are filled from
 * yt-dlp's reply when a video is actually played, which costs nothing extra
 * because that call has to happen anyway.
 *
 * ## A 404 here is useful, not a failure
 *
 * oEmbed answers 401/404 for a video that has been removed, made private or is
 * region-blocked. That is the one liveness check available before a card is
 * drawn, and it is worth acting on: a trailer that cannot be played is better
 * dropped than offered. So an id that answers *with an error status* is
 * excluded, while an id whose request *failed to complete* keeps its card —
 * because those are opposite facts, and treating a dropped connection as
 * "removed" would empty the gallery every time the network hiccuped.
 *
 * ## What is not sent
 *
 * The id of a public video, and nothing else. No query, no title the viewer
 * typed, no account. Same guarantee `discovery.ts` and `enrichmentService.ts`
 * make.
 */

import { HttpError, fetchJson } from '../torrent/http.ts';

const OEMBED = 'https://www.youtube.com/oembed';

/** Long enough for a slow round trip, short enough not to hold the fan-out. */
const TIMEOUT_MS = 8_000;

/**
 * How many ids are asked about at once.
 *
 * The measurement above was twelve in parallel with no throttling and no
 * failures, and a title never has more than a handful — so this is a guard
 * against a pathological catalogue entry rather than a rate limit anyone has
 * hit.
 */
const MAX_LOOKUPS = 12;

export interface YouTubeVideoFacts {
  title: string;
  publisher?: string;
  thumbnailUrl?: string;
}

interface OEmbedReply {
  title?: string;
  author_name?: string;
  thumbnail_url?: string;
}

/**
 * The video id in any address YouTube uses.
 *
 * Three spellings are in circulation across the catalogues and the provider
 * corpus — `watch?v=`, `youtu.be/` and `/embed/` — and they address the same
 * video. Reading them all is what makes the id a usable dedupe key; matching
 * only the first would let one video arrive twice as two cards.
 */
export function youTubeIdFrom(value: string): string | null {
  const text = (value ?? '').trim();
  if (!text) return null;
  // A bare id, which is what Cinemeta's `trailers[].source` actually contains.
  if (/^[\w-]{11}$/.test(text)) return text;
  try {
    const url = new URL(text);
    if (!/(^|\.)youtube\.com$|(^|\.)youtu\.be$/i.test(url.hostname)) return null;
    if (url.hostname.endsWith('youtu.be')) {
      const id = url.pathname.slice(1);
      return /^[\w-]{11}$/.test(id) ? id : null;
    }
    const param = url.searchParams.get('v');
    if (param && /^[\w-]{11}$/.test(param)) return param;
    const embed = url.pathname.match(/^\/(?:embed|shorts|v)\/([\w-]{11})/);
    return embed ? embed[1] : null;
  } catch {
    return null;
  }
}

/** The thumbnail for an id, addressable without a request. */
export function youTubeThumbnail(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

/**
 * What each id is, and which ids no longer resolve.
 *
 * Returns both halves rather than one map with holes in it, because the caller
 * has to treat them differently: a video with no facts keeps its card and its
 * fallback title, and a video that is *gone* loses its card entirely. Collapsing
 * them would either show dead trailers or drop live ones on a bad connection.
 */
export async function describeYouTubeVideos(
  ids: string[],
  signal?: AbortSignal
): Promise<{ facts: Map<string, YouTubeVideoFacts>; removed: Set<string> }> {
  const facts = new Map<string, YouTubeVideoFacts>();
  const removed = new Set<string>();

  const wanted = [...new Set(ids.filter(Boolean))].slice(0, MAX_LOOKUPS);
  if (wanted.length === 0) return { facts, removed };

  await Promise.all(
    wanted.map(async (id) => {
      const watch = `https://www.youtube.com/watch?v=${id}`;
      const address = `${OEMBED}?url=${encodeURIComponent(watch)}&format=json`;
      try {
        const reply = await fetchJson<OEmbedReply>(address, {
          signal,
          timeoutMs: TIMEOUT_MS,
          retries: 0,
        });
        if (!reply?.title) return;
        facts.set(id, {
          title: reply.title,
          publisher: reply.author_name,
          thumbnailUrl: reply.thumbnail_url ?? youTubeThumbnail(id),
        });
      } catch (error) {
        /**
         * Only an answer counts as an answer.
         *
         * `fetchJson` throws for both a 404 and a dead socket, and those mean
         * opposite things here — the first is YouTube saying the video is gone,
         * the second is us not having asked successfully. `HttpError` carries
         * the status, so the two are told apart by type rather than by reading
         * a message; anything that is not an `HttpError` leaves the card alone,
         * which is the safe direction.
         */
        const status = error instanceof HttpError ? error.status : undefined;
        if (status === 401 || status === 403 || status === 404) removed.add(id);
      }
    })
  );

  return { facts, removed };
}
