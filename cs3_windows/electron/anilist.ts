import { postJson } from './torrent/http.ts';

/**
 * The one way this app talks to AniList.
 *
 * Four call sites query it — search suggestions, catalogue metadata, detail
 * load, and the home screen's seasonal anime row — and three of them had their
 * own copy of the same POST: build a body, call **global `fetch`**, check
 * `response.ok`, cast `response.json()`, read `data`. The copies had drifted to
 * three different timeouts and two different error messages for one service.
 *
 * Two things were wrong with them beyond the repetition.
 *
 * **They bypassed the injected fetch.** `torrent/http.ts` exists so the main
 * process can swap in Electron's `net.fetch`, which goes through Chromium's
 * network stack and therefore honours `app.configureHostResolver` and the
 * system proxy. Node's `fetch` honours neither. So the DNS-over-HTTPS setting
 * silently did nothing for AniList — on a connection where that setting is the
 * reason anything resolves at all, the anime rows were the ones that failed,
 * and nothing connected the two.
 *
 * **They read `data` without looking at `errors`.** GraphQL reports a bad
 * query, a rate limit or a server fault as **HTTP 200** with an `errors` array
 * beside a null `data`, so `response.ok` is true and the copies returned
 * `undefined` — which every caller renders as "no results". AniList rate-limits
 * aggressively (its documented budget is per-minute, and this app can issue a
 * suggestion query per keystroke), so the common failure was reported as an
 * empty catalogue rather than as a service saying "slow down". A rate limit the
 * viewer can wait out and a catalogue with nothing in it call for opposite
 * responses, and the two were indistinguishable.
 */

const ENDPOINT = 'https://graphql.anilist.co';

/** Matches the other catalogue services; AniList is not on the playback path. */
export const ANILIST_TIMEOUT_MS = 12_000;

interface GraphQlReply<T> {
  data?: T | null;
  errors?: Array<{ message?: string; status?: number }>;
}

/**
 * Runs one query and returns its `data`.
 *
 * Throws when AniList reports an error, rather than answering `undefined`:
 * every caller of this treats a missing field as "nothing found", and a
 * service fault reported that way is indistinguishable from an empty
 * catalogue. The taxonomy can classify a thrown message; it cannot classify an
 * empty array.
 */
export async function anilistQuery<T>(
  query: string,
  variables: Record<string, unknown>,
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<T> {
  const reply = await postJson<GraphQlReply<T>>(
    ENDPOINT,
    { query, variables },
    { signal: options.signal, timeoutMs: options.timeoutMs ?? ANILIST_TIMEOUT_MS }
  );

  const failure = reply.errors?.[0];
  if (failure) {
    // The status travels in the message so `classifyFailure` can read it: 429
    // is a timeout-shaped wait, 400 is our query being wrong, and those are
    // different rows in the issue ledger.
    const status = failure.status ? ` (HTTP ${failure.status})` : '';
    throw new Error(`AniList refused the query${status}: ${failure.message ?? 'no reason given'}`);
  }

  if (!reply.data) throw new Error('AniList answered with no data.');
  return reply.data;
}
