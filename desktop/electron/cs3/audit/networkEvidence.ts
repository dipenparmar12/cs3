import { detectChallenge } from '../../torrent/botChallenge.ts';
import { detectQuirks, type QuirkCode, type SourceObservation } from './quirks.ts';
import { auditUrl, printable, type Reason } from './schema.ts';
import { classOf, sniff, type SniffResult } from './sourceSniff.ts';
import type { Judgement } from './stageEvidence.ts';

/**
 * What the network said, for S2 (does the provider's site answer?) and S7
 * (can a source be fetched, how, and what is it really?), Provider
 * Compatibility Audit PRD §6.1, §6.5. The runner makes the requests through
 * the Electron network worker; this reads the answers. Pure.
 *
 * S2 is what separates "site dead" from "plugin broken" (H-06). S7 records
 * the URL's claim beside the body's, and a source that cannot be judged by
 * light means is inconclusive, never a failure.
 */
export interface WorkerAnswer {
  ok: boolean;
  error?: string;
  status?: number;
  headers?: Record<string, string>;
  /** The final URL, after redirects. */
  url?: string;
  redirects?: string[];
  body?: Uint8Array;
  bytes?: number;
}

function header(answer: WorkerAnswer | undefined, name: string): string | undefined {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(answer?.headers ?? {})) if (key.toLowerCase() === wanted) return value;
  return undefined;
}

function bodyText(answer: WorkerAnswer, bytes = 8192): string {
  const body = answer.body ?? new Uint8Array(0);
  let text = '';
  for (let i = 0; i < Math.min(body.length, bytes); i++) text += String.fromCharCode(body[i]);
  return text;
}

/** A challenge, a block or a rate limit, as the reason it makes a stage inconclusive. */
function wall(answer: WorkerAnswer): Reason | null {
  const verdict = detectChallenge({ status: answer.status ?? 0, headers: answer.headers, bodyPrefix: bodyText(answer) });
  if (verdict.kind === 'cloudflare-challenge' || verdict.kind === 'ddos-guard') return 'challenge';
  if (verdict.kind === 'rate-limited') return 'rate-limited';
  if (verdict.kind === 'cloudflare-block') return 'geo-blocked';
  return null;
}

/** Registrar and hosting "this domain is for sale" pages. */
const PARKED = /domain (is|may be) for sale|buy this domain|this domain (has expired|is parked)|parkingcrew|sedoparking|domain parking/i;

/** S2: one GET of the provider's `mainUrl`. */
export function judgeSite(answer: WorkerAnswer): Judgement {
  const evidence: Record<string, unknown> = {
    status: answer.status,
    redirects: answer.redirects?.length ?? 0,
    finalHost: answer.url ? safeHost(answer.url) : undefined,
    server: header(answer, 'server'),
  };
  if (!answer.ok) return { outcome: 'fail', message: printable(answer.error ?? 'no answer'), evidence };
  const blocked = wall(answer);
  if (blocked) return { outcome: 'inconclusive', reason: blocked, evidence };
  const status = answer.status ?? 0;
  const page = bodyText(answer, 16384);
  if (PARKED.test(page)) return { outcome: 'fail', message: 'The domain is parked or for sale.', evidence: { ...evidence, parked: true } };
  if (status >= 500) return { outcome: 'fail', message: `HTTP ${status}`, evidence };
  if (status === 404 || status === 410) return { outcome: 'fail', message: `HTTP ${status} on the front page`, evidence };
  // A 401 or 403 front page is usually bot protection with no marker we know; not a dead site.
  if (status === 401 || status === 403) return { outcome: 'inconclusive', reason: 'challenge', evidence };
  return { outcome: 'pass', evidence };
}

function safeHost(url: string): string | undefined {
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

export interface ReachSteps {
  /** The source URL as the provider gave it. */
  url: string;
  head?: WorkerAnswer;
  /** `Range: bytes=0-0`, read to one byte. */
  probe?: WorkerAnswer;
  /** `Range: bytes=0-65535`, with the header set that worked. */
  read?: WorkerAnswer;
  /** Headers a retry showed the source needs, by name. */
  requires?: string[];
  declared?: { isM3u8?: boolean; isDash?: boolean; torrent?: boolean; drm?: boolean };
}

export interface ReachJudgement extends Judgement {
  sniff?: SniffResult;
  quirks: QuirkCode[];
  /** Range behaviour, for the inspector (`boundedRanges`) and N-12. */
  range?: 'honoured' | 'ignored' | 'refused';
}

function rangeOf(probe: WorkerAnswer | undefined): ReachJudgement['range'] {
  if (!probe?.ok) return undefined;
  if (probe.status === 206) return 'honoured';
  if (probe.status === 416) return 'refused';
  if (probe.status === 200) return 'ignored';
  return undefined;
}

function headOf(head: WorkerAnswer | undefined): 'supported' | 'rejected' | 'lies' | undefined {
  if (!head) return undefined;
  if (!head.ok || head.status === 405 || head.status === 501) return 'rejected';
  if ((head.status ?? 0) >= 200 && (head.status ?? 0) < 300 && !header(head, 'content-length') && !header(head, 'content-type')) {
    return 'lies';
  }
  return (head.status ?? 0) < 400 ? 'supported' : 'rejected';
}

const PLAYABLE = new Set(['manifest', 'video', 'audio']);

/** S7: the request ladder's answers, read. */
export function judgeReach(steps: ReachSteps): ReachJudgement {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(steps.url)?.[1]?.toLowerCase() ?? '';
  const base: SourceObservation = { url: steps.url, torrent: steps.declared?.torrent, drm: steps.declared?.drm ? 'declared' : undefined };
  if (steps.declared?.torrent || scheme === 'magnet') {
    return { outcome: 'skipped', reason: 'torrent-lane', evidence: {}, quirks: detectQuirks(base).map((q) => q.code) };
  }
  if (scheme !== 'http' && scheme !== 'https') {
    return { outcome: 'unsupported', reason: 'not-offered', evidence: { scheme }, quirks: detectQuirks(base).map((q) => q.code) };
  }

  const read = steps.read;
  const range = rangeOf(steps.probe);
  const sniffed = read?.ok && read.body ? sniff(read.body) : undefined;
  const contentLength = header(read, 'content-length');
  const contentRange = header(steps.probe, 'content-range');
  const total = contentRange?.match(/\/(\d+)$/)?.[1];
  const observation: SourceObservation = {
    ...base,
    contentType: header(read, 'content-type'),
    sniff: sniffed,
    redirects: read?.redirects?.length ?? 0,
    range,
    requiredHeaders: steps.requires,
    contentEncoding: header(read, 'content-encoding'),
    // A length from either the answer or the range probe's total; `null` when neither stated one.
    contentLength: contentLength ? Number(contentLength) : total ? Number(total) : null,
  };
  const quirks = detectQuirks(observation).map((q) => q.code);
  const evidence: Record<string, unknown> = {
    url: auditUrl(read?.url ?? steps.url).shape,
    status: read?.status,
    redirects: read?.redirects?.length ?? 0,
    head: headOf(steps.head),
    range,
    totalBytes: total ? Number(total) : undefined,
    contentType: observation.contentType,
    sniff: sniffed?.kind,
    requires: steps.requires ?? [],
    quirks,
  };
  const out = (j: Omit<ReachJudgement, 'quirks' | 'sniff' | 'range' | 'evidence'>): ReachJudgement => ({
    ...j,
    evidence,
    quirks,
    sniff: sniffed,
    range,
  });

  if (!read || !read.ok) return out({ outcome: 'fail', message: printable(read?.error ?? 'the source did not answer') });
  const blocked = wall(read);
  if (blocked) return out({ outcome: 'inconclusive', reason: blocked });
  const status = read.status ?? 0;
  if (status >= 400) {
    const expired = /[?&](expires?|exp)=(\d{9,11})\b/i.exec(steps.url);
    const past = expired && Number(expired[2]) * 1000 < Date.now();
    return out({ outcome: 'fail', message: past ? `HTTP ${status}: the link has expired` : `HTTP ${status}` });
  }
  const bodyClass = sniffed ? classOf(sniffed.kind) : undefined;
  if (bodyClass && PLAYABLE.has(bodyClass)) return out({ outcome: 'pass' });
  if (sniffed?.kind === 'html') return out({ outcome: 'fail', message: 'An HTML page where media was expected.' });
  if (sniffed?.kind === 'json') return out({ outcome: 'fail', message: 'JSON where media was expected: the link is an envelope.' });
  if (sniffed?.kind === 'archive') return out({ outcome: 'fail', message: 'An archive, not a stream.' });
  if (sniffed?.kind === 'empty') return out({ outcome: 'fail', message: 'An empty body.' });
  // Nothing recognisable in the first bytes, but the server says media: let the inspector decide.
  const typeSaysMedia = /^(video|audio)\/|mpegurl|dash\+xml|octet-stream/i.test(observation.contentType ?? '');
  return typeSaysMedia ? out({ outcome: 'pass' }) : out({ outcome: 'inconclusive', reason: 'probe-incomplete' });
}
