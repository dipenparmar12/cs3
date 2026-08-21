import type { ResilientFetch } from '../networkResilience.ts';

/** What one probe of a source that would not open concluded. */
export interface UnreadableSource {
  status?: number;
  reason: string;
  /** True when the link itself is gone or refused, so no decoder would help. */
  dead: boolean;
}

/**
 * Asks the source itself why it could not be read.
 *
 * The distinction it draws is the one the rest of the app acts on. A 4xx or 5xx
 * means the link is gone or refused and no decoder would have helped — so the
 * player fails over immediately instead of spending ffmpeg's startup and the
 * element's timeout on it, and the error panel suppresses the download button
 * and the external-player offer, because a 404 plays no better in VLC. A source
 * that answers 200 and still cannot be probed is a real format problem, and gets
 * the opposite treatment.
 *
 * Its own module because both sides need it and neither owns it: the
 * composition root wires it into `PlaybackEngine`, and the external-player
 * handlers call it before offering to hand a stream over. It lived in `main.ts`
 * when that file was both.
 */
export function describeUnreadableSource(
  fetcher: ResilientFetch,
  url: string
): Promise<UnreadableSource> {
  return probe(fetcher, url);
}

/**
 * Whether this address is one of our own servers.
 *
 * The torrent engine, the media proxy and the transcoder all serve from
 * loopback, and they are not third-party CDNs that can expire a link. The
 * distinction matters because `dead` is acted on: `PlaybackEngine.prepare`
 * refuses outright and the player skips to the next source.
 */
function isLoopback(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
  } catch {
    return false;
  }
}

async function probe(fetcher: ResilientFetch, url: string): Promise<UnreadableSource> {
  if (!/^https?:\/\//i.test(url)) {
    return { reason: 'This source could not be read.', dead: false };
  }
  try {
    /**
     * GET with a one-byte range: some hosts refuse HEAD outright, and a range
     * keeps this from pulling a film to find out whether it exists.
     *
     * Through the resilient path deliberately. This answer decides whether a
     * link is reported dead, and a single transient HTTP/2 reset would otherwise
     * condemn a source that works perfectly on the next attempt.
     */
    const response = await fetcher.fetch(
      url,
      {
        method: 'GET',
        headers: { Range: 'bytes=0-0' },
        signal: AbortSignal.timeout(12_000),
      },
      { operation: 'source-probe' }
    );
    try {
      await response.body?.cancel();
    } catch {
      // Nothing to cancel.
    }

    if (response.status >= 400) {
      return {
        status: response.status,
        dead: true,
        reason:
          response.status === 404 || response.status === 410
            ? `This link no longer exists (HTTP ${response.status}). It has probably expired — try another source.`
            : `The source refused this request (HTTP ${response.status}). The link may have expired, or need credentials this app does not have.`,
      };
    }

    return {
      status: response.status,
      dead: false,
      reason:
        'The source is reachable but its format could not be read. It may use a container or codec that cannot be played here.',
    };
  } catch (error) {
    /**
     * A transport failure against **our own** loopback server is not a dead
     * link, and calling it one was skipping torrents that were simply still
     * finding peers.
     *
     * The torrent engine does not answer a byte until the first piece lands.
     * From a cold swarm that regularly takes longer than this probe's timeout,
     * so the probe reported "The source could not be reached" — and because
     * `dead` makes `prepare` refuse and the player advance to the next source,
     * the app walked the whole list without playing anything. The session logs
     * show it plainly: forty-two of sixty-six playback attempts were loopback
     * URLs, and the timeouts are all on `/webtorrent/` paths.
     *
     * Status codes are still trusted, including from loopback: the proxy
     * forwards the upstream status, so a 403 arriving here really is the CDN
     * refusing. It is only the *transport* verdict that is wrong for a server we
     * are running ourselves.
     */
    if (isLoopback(url)) {
      return {
        dead: false,
        reason:
          'The stream has not produced any data yet. A torrent still finding peers, or a slow ' +
          'upstream host, will start on its own — the source itself is not gone.',
      };
    }
    return {
      dead: true,
      reason: `The source could not be reached: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}
