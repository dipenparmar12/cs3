import { detectQuirks, type QuirkCode } from './quirks.ts';
import { auditHeaders, auditUrl, shapeFingerprint, type Outcome, type Reason } from './schema.ts';

/**
 * What one bridge reply means for its stage (Provider Compatibility Audit PRD
 * §6.1, S1–S6), read from the same JSON the app reads. The runner does the
 * I/O; this decides the outcome and keeps only redacted evidence: URL shapes,
 * header names, counts and shapes, never a title's or a link's value. Pure.
 *
 * A reply the bridge marks failed carries its message, for the runner to
 * classify with the app's taxonomy and attribute; nothing here guesses a cause.
 */
export interface Judgement {
  outcome: Outcome;
  reason?: Reason;
  /** The provider's or runtime's own words, when it failed. */
  message?: string;
  evidence: Record<string, unknown>;
  shapeFingerprint?: string;
}

/** The sidecar's envelope: `{ ok, result, error }`, with the provider's JSON in `result.json`. */
export interface RpcReply {
  ok: boolean;
  error?: string;
  result?: Record<string, unknown> & { json?: string };
}

type Json = Record<string, unknown>;

/** The provider's JSON from an envelope, or why there is none. */
export function bridgeJson(reply: RpcReply, field?: string): { json?: Json; error?: string } {
  if (!reply.ok) return { error: reply.error ?? 'The runtime did not answer.' };
  const raw = field ? (reply.result?.[field] as string | undefined) : reply.result?.json;
  if (typeof raw !== 'string') return { error: 'The runtime answered without a reply body.' };
  try {
    const json = JSON.parse(raw) as unknown;
    return json && typeof json === 'object' ? { json: json as Json } : { error: 'The reply is not an object.' };
  } catch {
    return { error: 'The reply is not JSON.' };
  }
}

const NOT_IMPLEMENTED = /does not implement|NotImplemented/i;
/** The provider wants the viewer's own account; the audit never signs in (§9). */
const NEEDS_LOGIN = /not logged in|login required|please log ?in|sign in to|requires? (an )?account|api key/i;

function failed(message: string, evidence: Json = {}): Judgement {
  // "Not implemented" is a capability the provider declares by omission, not a defect.
  if (NOT_IMPLEMENTED.test(message)) return { outcome: 'unsupported', reason: 'not-offered', evidence };
  if (NEEDS_LOGIN.test(message)) return { outcome: 'skipped', reason: 'needs-credentials', evidence };
  return { outcome: 'fail', message, evidence };
}

/** S1: the archive loaded and registered providers. */
export function judgeLoad(reply: RpcReply): Judgement & { providers: Json[] } {
  if (!reply.ok) return { ...failed(reply.error ?? 'load failed'), providers: [] };
  const providers = Array.isArray(reply.result?.providers) ? (reply.result!.providers as Json[]) : [];
  const evidence = { tier: reply.result?.tier, tierReason: reply.result?.tierReason, providers: providers.length };
  if (providers.length === 0) return { outcome: 'fail', message: 'The archive loaded and registered no provider.', evidence, providers };
  return { outcome: 'pass', evidence, providers };
}

/** S2 (declaration half): what the provider says it is. Adult-only means `NSFW` and no general type. */
export function declaration(provider: Json): {
  name: string;
  mainUrl?: string;
  lang?: string;
  types: string[];
  hasMainPage: boolean;
  adultOnly: boolean;
} {
  const types = Array.isArray(provider.supportedTypes) ? provider.supportedTypes.map(String) : [];
  const general = types.filter((t) => t !== 'NSFW' && t !== 'Others');
  return {
    name: String(provider.name ?? ''),
    mainUrl: typeof provider.mainUrl === 'string' ? provider.mainUrl : undefined,
    lang: typeof provider.lang === 'string' ? provider.lang : undefined,
    types,
    hasMainPage: provider.hasMainPage === true,
    adultOnly: types.includes('NSFW') && general.length === 0,
  };
}

/** S3: rows asked of `getMainPage`. Classes as `catalogue-e2e.mjs` names them. */
export type RowStatus = 'OK' | 'MULTI' | 'EMPTY' | 'DROPPED' | 'ERROR';

export function rowStatus(reply: RpcReply): { status: RowStatus; items: Json[]; message?: string } {
  const { json, error } = bridgeJson(reply);
  if (!json || json.ok === false || json.error) return { status: 'ERROR', items: [], message: error ?? String(json?.error ?? 'failed') };
  const lists = Array.isArray(json.sections) ? (json.sections as Json[]) : [];
  const raw = lists.flatMap((list) => (Array.isArray(list.items) ? (list.items as Json[]) : []));
  const usable = raw.filter((item) => typeof item?.url === 'string' && item.url);
  if (raw.length === 0) return { status: 'EMPTY', items: [] };
  if (usable.length === 0) return { status: 'DROPPED', items: [] };
  return { status: lists.length > 1 ? 'MULTI' : 'OK', items: usable };
}

export function judgeCatalogue(hasMainPage: boolean, rows: RpcReply[]): Judgement & { items: Json[] } {
  if (!hasMainPage) return { outcome: 'unsupported', reason: 'not-offered', evidence: {}, items: [] };
  const statuses = rows.map(rowStatus);
  const counts: Partial<Record<RowStatus, number>> = {};
  for (const s of statuses) counts[s.status] = (counts[s.status] ?? 0) + 1;
  const items = statuses.flatMap((s) => s.items);
  const evidence = { rows: rows.length, statuses: counts, items: items.length };
  if (items.length > 0) return { outcome: 'pass', evidence, items, shapeFingerprint: shapeFingerprint(items[0]) };
  const error = statuses.find((s) => s.status === 'ERROR');
  if (error) return { ...failed(error.message ?? 'failed', evidence), items };
  return { outcome: 'fail', message: rows.length ? 'Every row came back empty.' : 'The provider declares no rows.', evidence, items };
}

/** S4: a search for a title the provider itself listed. */
export function judgeSearch(reply: RpcReply, provider: string): Judgement & { results: Json[] } {
  if (!reply.ok) return { ...failed(reply.error ?? 'search failed'), results: [] };
  const raw = (reply.result?.byProvider as Record<string, string> | undefined)?.[provider];
  let json: Json | undefined;
  try {
    json = raw ? (JSON.parse(raw) as Json) : undefined;
  } catch {
    json = undefined;
  }
  if (!json) return { outcome: 'fail', message: 'The search reply is not JSON.', evidence: {}, results: [] };
  if (json.ok === false) return { ...failed(String(json.error ?? 'search failed')), results: [] };
  const results = (Array.isArray(json.results) ? (json.results as Json[]) : []).filter((r) => typeof r?.url === 'string' && r.url);
  const evidence = { results: results.length };
  if (results.length === 0) return { outcome: 'fail', message: 'No results for a title the provider lists.', evidence, results };
  return { outcome: 'pass', evidence, results, shapeFingerprint: shapeFingerprint(results[0]) };
}

/** What a `loadLinks` handle is: an opaque blob or a page address (`cs3/extensionAddress.ts`). */
function handleKind(handle: string): 'json' | 'url' | 'opaque' {
  const trimmed = handle.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json';
  return /^https?:\/\//i.test(trimmed) ? 'url' : 'opaque';
}

/** S5: `load` gave a coherent title, and the handle `loadLinks` will be given. */
export function judgeDetail(reply: RpcReply, fallbackUrl: string): Judgement & { handle?: string } {
  const { json, error } = bridgeJson(reply);
  if (!json) return { ...failed(error ?? 'detail failed') };
  if (json.ok === false) return { ...failed(String(json.error ?? 'detail failed')) };
  if (json.found === false) return { outcome: 'fail', message: 'The provider has no detail page for its own result.', evidence: {} };
  const detail = ((json.detail as Json | undefined) ?? json) as Json;
  const episodes = Array.isArray(detail.episodes) ? (detail.episodes as Json[]) : [];
  const first = episodes[0];
  const handle = String(detail.dataUrl ?? first?.data ?? first?.url ?? fallbackUrl);
  const seasons = new Set(episodes.map((e) => e.season).filter((s) => s !== undefined && s !== null));
  return {
    outcome: 'pass',
    handle,
    evidence: {
      type: detail.type,
      hasYear: detail.year !== undefined && detail.year !== null,
      hasPlot: typeof detail.plot === 'string' && detail.plot.length > 0,
      hasPoster: Boolean(detail.posterUrl),
      episodes: episodes.length,
      seasons: seasons.size,
      handle: handleKind(handle),
    },
    shapeFingerprint: shapeFingerprint(detail),
  };
}

/** S6: what `loadLinks` handed back, in the provider's own words, redacted. */
export function judgeLinks(reply: RpcReply): Judgement & { links: Json[]; quirks: QuirkCode[] } {
  const { json, error } = bridgeJson(reply);
  if (!json) return { ...failed(error ?? 'links failed'), links: [], quirks: [] };
  const links = (Array.isArray(json.links) ? (json.links as Json[]) : []).filter((l) => typeof l?.url === 'string' && l.url);
  const subtitles = Array.isArray(json.subtitles) ? (json.subtitles as Json[]) : [];
  if (links.length === 0) {
    if (json.ok === false && json.error) return { ...failed(String(json.error)), links, quirks: [] };
    return { outcome: 'fail', message: 'The provider returned no link.', evidence: { subtitles: subtitles.length }, links, quirks: [] };
  }
  const quirks = new Set<QuirkCode>();
  const described = links.map((link) => {
    const url = String(link.url);
    const type = String(link.linkType ?? link.type ?? '');
    for (const quirk of detectQuirks({
      url,
      torrent: type === 'TORRENT' || type === 'MAGNET',
      drm: link.drm ? 'declared' : undefined,
      audioTracks: Array.isArray(link.audioTracks) ? link.audioTracks.length : 0,
      playlistParts: Array.isArray(link.playlist) ? link.playlist.length : 0,
    })) {
      quirks.add(quirk.code);
    }
    return {
      url: auditUrl(url).shape,
      source: link.source,
      quality: link.quality,
      type,
      isM3u8: link.isM3u8 === true,
      isDash: link.isDash === true,
      headers: Object.keys(auditHeaders(link.headers as Record<string, string> | undefined)),
      hasReferer: Boolean(link.referer),
      audioTracks: Array.isArray(link.audioTracks) ? link.audioTracks.length : 0,
      playlistParts: Array.isArray(link.playlist) ? link.playlist.length : 0,
      drm: Boolean(link.drm),
    };
  });
  return {
    outcome: 'pass',
    links,
    quirks: [...quirks],
    evidence: {
      links: links.length,
      extractors: [...new Set(links.map((l) => String(l.source ?? '')))],
      subtitles: subtitles.length,
      described,
      quirks: [...quirks],
    },
    shapeFingerprint: shapeFingerprint(json),
  };
}
