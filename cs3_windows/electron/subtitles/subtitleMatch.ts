/**
 * Which subtitle file is the right one for what is playing.
 *
 * OpenSubtitles answers a search with dozens of files per language, and they
 * are not interchangeable: each was timed against one release, and a subtitle
 * timed for the 2h 10m extended cut drifts minutes out of sync on the
 * theatrical one. The old picker treated every English file as equal and took
 * the first three in feed order, which is why English "sometimes showed and
 * sometimes did not" — on a bad draw all three were for another release and the
 * duration check threw them out.
 *
 * Pure and tested, for `ottPlatforms.ts`'s reason: every wrong answer here is
 * silent and plausible, and is blamed on the subtitle rather than the choice.
 *
 * The score is a ranking, not a verdict. It never removes a result — the viewer
 * can still pick anything by hand — it orders them and marks the one the app
 * would pick itself.
 */

export interface RankableSubtitle {
  id: string;
  lang: string;
  langName: string;
  origin: 'opensubtitles' | 'provider';
  releaseName?: string;
  fileName?: string;
  downloads?: number;
  /** 0–10, as OpenSubtitles publishes it; absent or 0 means unrated. */
  rating?: number;
  year?: number;
  hearingImpaired?: boolean;
  machineTranslated?: boolean;
  /** Translates only the lines not in the film's own language ("forced"). */
  foreignPartsOnly?: boolean;
  trusted?: boolean;
}

export interface MatchContext {
  /** The playing source's release name, e.g. `Dune.Part.Two.2024.1080p.WEB-DL-EVO`. */
  releaseName?: string;
  year?: number;
}

export interface Ranked<T> {
  result: T;
  /** 0–100. */
  score: number;
  /** Short phrases saying why, for the row's tooltip. */
  reasons: string[];
}

/** Release-name vocabulary that means the same thing spelled differently. */
const SYNONYMS: Record<string, string> = {
  'web-dl': 'webdl',
  webdl: 'webdl',
  web: 'webdl',
  webrip: 'webrip',
  bluray: 'bluray',
  'blu-ray': 'bluray',
  bdrip: 'bluray',
  brrip: 'bluray',
  bdremux: 'bluray',
  remux: 'bluray',
  hdtv: 'hdtv',
  dvdrip: 'dvd',
  dvd: 'dvd',
  '4k': '2160p',
  uhd: '2160p',
  x264: 'h264',
  'h.264': 'h264',
  avc: 'h264',
  x265: 'h265',
  'h.265': 'h265',
  hevc: 'h265',
};

/** Words that appear in every release of everything and say nothing. */
const NOISE = new Set(['the', 'a', 'an', 'of', 'and', 'srt', 'sub', 'subs', 'eng', 'english', 'en']);

/** What kind of release a name describes: its source, resolution, codec and group. */
export function releaseTokens(name: string | undefined): Set<string> {
  const tokens = new Set<string>();
  if (!name) return tokens;
  // Joined spellings first, so splitting on punctuation cannot tear them apart.
  const parts = name
    .toLowerCase()
    .replace(/\.(srt|ass|ssa|vtt|sub)$/, '')
    .replace(/web[-. ]?dl/g, 'webdl')
    .replace(/blu[-. ]?ray/g, 'bluray')
    .replace(/[hx][-. ]?26([45])/g, (_m, n) => (n === '4' ? 'h264' : 'h265'))
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  for (const raw of parts) {
    const token = SYNONYMS[raw] ?? raw;
    if (NOISE.has(token) || /^\d{4}$/.test(token)) continue;
    tokens.add(token);
  }
  return tokens;
}

/** The release group — the last dash-separated word, which is how scene names end. */
export function releaseGroup(name: string | undefined): string | undefined {
  const match = name
    ?.replace(/\.(srt|ass|ssa|vtt|sub|mkv|mp4)$/i, '')
    .match(/-([A-Za-z0-9]{2,})(?:\[[^\]]*\])?$/);
  return match?.[1].toLowerCase();
}

/** Which of a result's names describes the release best; the file name often does. */
function namesOf(result: RankableSubtitle): string[] {
  return [result.releaseName, result.fileName].filter((n): n is string => Boolean(n));
}

const KIND_TOKENS = ['webdl', 'webrip', 'bluray', 'hdtv', 'dvd'];
const RESOLUTION_TOKENS = ['2160p', '1080p', '720p', '576p', '480p'];

/** 0–1: how closely a subtitle's release resembles the one playing. */
export function releaseSimilarity(result: RankableSubtitle, playing: string | undefined): number {
  if (!playing) return 0;
  const want = releaseTokens(playing);
  const wantGroup = releaseGroup(playing);
  let best = 0;
  for (const name of namesOf(result)) {
    const have = releaseTokens(name);
    let score = 0;
    // Same group is the strongest single signal: the same people encoded both.
    if (wantGroup && releaseGroup(name) === wantGroup) score += 0.5;
    // Same kind of source (web vs disc vs broadcast) shares a cut and a timing.
    if (KIND_TOKENS.some((k) => want.has(k) && have.has(k))) score += 0.3;
    if (RESOLUTION_TOKENS.some((r) => want.has(r) && have.has(r))) score += 0.1;
    // Anything else in common — streaming service tags, `extended`, `repack`.
    const shared = [...want].filter((t) => have.has(t) && !KIND_TOKENS.includes(t) && !RESOLUTION_TOKENS.includes(t)).length;
    score += Math.min(0.1, shared * 0.02);
    best = Math.max(best, score);
  }
  return Math.min(1, best);
}

/**
 * Scores one result. Weights, in order of how much each one predicts a
 * subtitle that is in sync:
 *
 * - **Shipped with the stream** (40): the provider published it beside this
 *   exact link, so its timeline is this file's.
 * - **Same release** (up to 40): group, then source kind, then resolution.
 * - **Popularity** (up to 25): downloads, on a log scale. Hundreds of
 *   thousands of downloads of one file is a strong sign it fits the common cut.
 * - **Rating** (up to 10), **trusted uploader** (5).
 * - **Penalties**: a different year (−35, it is probably another work),
 *   machine translation (−15), hearing-impaired annotations (−4: most people
 *   do not want "[door creaks]", but it is still a correct subtitle).
 */
export function scoreSubtitle(result: RankableSubtitle, context: MatchContext): Ranked<RankableSubtitle> {
  const reasons: string[] = [];
  let score = 20;

  if (result.origin === 'provider') {
    score += 40;
    reasons.push('published with this stream');
  }

  const similarity = releaseSimilarity(result, context.releaseName);
  if (similarity > 0) {
    score += similarity * 40;
    // Named from the evidence, not from the score: a high score can be built
    // from shared tags alone, and "same group" would then be a false claim.
    const group = releaseGroup(context.releaseName);
    if (group && namesOf(result).some((name) => releaseGroup(name) === group)) reasons.push('same release group');
    else if (similarity >= 0.3) reasons.push('same kind of release');
  }

  if (result.downloads && result.downloads > 0) {
    score += Math.min(25, (Math.log10(result.downloads + 1) / 6) * 25);
    if (result.downloads >= 10_000) reasons.push(`${compact(result.downloads)} downloads`);
  }
  if (result.rating && result.rating > 0) score += (Math.min(10, result.rating) / 10) * 10;
  if (result.trusted) {
    score += 5;
    reasons.push('trusted uploader');
  }

  if (context.year && result.year && Math.abs(result.year - context.year) > 1) {
    score -= 35;
    reasons.push(`listed as ${result.year}`);
  }
  /**
   * "Forced" files carry only the lines spoken in another language — a sign
   * held up on screen, a scene in Russian. Chosen as *the* subtitle they show
   * almost nothing, which reads as subtitles not working. Still offered, last.
   */
  const forced = result.foreignPartsOnly || namesOf(result).some((name) => /(^|[^a-z])forced([^a-z]|$)/i.test(name));
  if (forced) {
    score -= 30;
    reasons.push('foreign dialogue only');
  }
  if (result.machineTranslated) {
    score -= 15;
    reasons.push('machine translated');
  }
  if (result.hearingImpaired) {
    score -= 4;
    reasons.push('hearing impaired');
  }

  return { result, score: Math.max(0, Math.min(100, Math.round(score))), reasons };
}

/**
 * Every result scored and ordered best first, and the top of each language
 * marked — the one the app would choose, and the one the panel stars.
 */
export function rankSubtitles<T extends RankableSubtitle>(
  results: T[],
  context: MatchContext
): Array<T & { matchScore: number; best: boolean; matchReasons: string[] }> {
  const scored = results.map((result) => ({ ...scoreSubtitle(result, context), result }));
  scored.sort((a, b) => b.score - a.score);
  const starred = new Set<string>();
  return scored.map(({ result, score, reasons }) => {
    const best = !starred.has(result.lang);
    starred.add(result.lang);
    return { ...result, matchScore: score, best, matchReasons: reasons };
  });
}

function compact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(value);
}
