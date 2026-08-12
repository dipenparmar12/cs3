import {
  Resolution,
  ReleaseSource,
  VideoCodec,
  type SourcePreferences,
  type TorrentResult,
} from '../../src/types/torrent';
import { titleSimilarity, matchesEpisode } from './releaseParser';

/**
 * Scores and filters indexer results.
 *
 * The goal is that the top result is the one a careful human would pick: high
 * seeders (it will actually stream), correct episode, watchable quality, and not
 * a CAM rip mislabelled as 1080p. Scoring is additive and every contribution is
 * recorded in `scoreReasons` so the source picker can explain the ordering
 * instead of presenting an opaque list.
 */

const SOURCE_SCORES: Record<ReleaseSource, number> = {
  [ReleaseSource.Remux]: 100,
  [ReleaseSource.BluRay]: 90,
  [ReleaseSource.WebDL]: 85,
  [ReleaseSource.WebRip]: 70,
  [ReleaseSource.HDTV]: 55,
  [ReleaseSource.DVDRip]: 40,
  [ReleaseSource.SCR]: 10,
  [ReleaseSource.TS]: 5,
  [ReleaseSource.CAM]: 0,
  [ReleaseSource.Unknown]: 50,
};

const LOW_QUALITY_SOURCES: ReleaseSource[] = [
  ReleaseSource.CAM,
  ReleaseSource.TS,
  ReleaseSource.SCR,
];

/**
 * Expected bytes-per-minute at each resolution, used as a sanity check.
 * A "1080p" release far below its band is usually an upscale, a fake, or a CAM
 * with a misleading name; far above is a remux the user may not want to stream.
 */
const BYTES_PER_MINUTE: Record<number, { min: number; ideal: number }> = {
  [Resolution.UHD_4K]: { min: 60e6, ideal: 350e6 },
  [Resolution.QHD]: { min: 35e6, ideal: 180e6 },
  [Resolution.FHD]: { min: 18e6, ideal: 90e6 },
  [Resolution.HD]: { min: 8e6, ideal: 45e6 },
  [Resolution.SD]: { min: 3e6, ideal: 20e6 },
  [Resolution.LD]: { min: 1e6, ideal: 10e6 },
  [Resolution.Unknown]: { min: 0, ideal: 0 },
};

export interface RankContext {
  /** The title the user actually selected, for relevance checking. */
  expectedTitle?: string;
  expectedYear?: number;
  season?: number;
  episode?: number;
  /** Assumed runtime for the size sanity check. */
  runtimeMinutes?: number;
  preferences: SourcePreferences;
}

interface Contribution {
  points: number;
  reason: string;
}

function scoreSeeders(result: TorrentResult): Contribution {
  // Logarithmic: the difference between 1 and 20 seeders matters enormously;
  // between 500 and 2000 it barely matters at all.
  const points = Math.min(300, Math.round(Math.log2(result.seeders + 1) * 42));
  return { points, reason: `${result.seeders} seeders (+${points})` };
}

function scoreResolution(result: TorrentResult, prefs: SourcePreferences): Contribution {
  const actual = result.parsed.resolution;
  if (actual === Resolution.Unknown) {
    return { points: -10, reason: 'Unknown resolution (-10)' };
  }
  if (actual === prefs.preferredResolution) {
    return { points: 120, reason: `Preferred resolution ${actual}p (+120)` };
  }

  // Overshooting the preference is mildly penalised (bandwidth); undershooting
  // is penalised harder (visible quality loss).
  const steps = Object.values(Resolution).filter((r) => r > 0).sort((a, b) => b - a);
  const wantIndex = steps.indexOf(prefs.preferredResolution);
  const gotIndex = steps.indexOf(actual);
  const distance = Math.abs(wantIndex - gotIndex);
  const penalty = gotIndex < wantIndex ? distance * 20 : distance * 40;
  const points = Math.max(-120, 120 - penalty);

  return { points, reason: `${actual}p vs preferred ${prefs.preferredResolution}p (${points >= 0 ? '+' : ''}${points})` };
}

function scoreSource(result: TorrentResult): Contribution {
  const points = SOURCE_SCORES[result.parsed.source] ?? 50;
  return { points, reason: `Source ${result.parsed.source} (+${points})` };
}

function scoreCodec(result: TorrentResult, prefs: SourcePreferences): Contribution {
  const codec = result.parsed.videoCodec;

  if (prefs.preferH264) {
    // Chromium cannot decode HEVC without platform support; when the user has
    // reported playback trouble this preference makes compatibility dominate.
    if (codec === VideoCodec.H264) return { points: 60, reason: 'H.264 — broadest compatibility (+60)' };
    if (codec === VideoCodec.H265) return { points: -70, reason: 'HEVC — may not decode (-70)' };
    if (codec === VideoCodec.AV1) return { points: -50, reason: 'AV1 — may not decode (-50)' };
    return { points: 0, reason: '' };
  }

  if (codec === VideoCodec.H265) return { points: 25, reason: 'HEVC — efficient (+25)' };
  if (codec === VideoCodec.AV1) return { points: 15, reason: 'AV1 — efficient (+15)' };
  if (codec === VideoCodec.H264) return { points: 20, reason: 'H.264 — compatible (+20)' };
  if (codec === VideoCodec.XviD) return { points: -40, reason: 'XviD — legacy (-40)' };
  return { points: 0, reason: '' };
}

function scoreSizeSanity(result: TorrentResult, runtimeMinutes: number): Contribution {
  const band = BYTES_PER_MINUTE[result.parsed.resolution];
  if (!band || band.ideal === 0 || result.sizeBytes === 0 || runtimeMinutes <= 0) {
    return { points: 0, reason: '' };
  }

  const perMinute = result.sizeBytes / runtimeMinutes;

  if (perMinute < band.min) {
    // Strong signal of a fake, an upscale, or a mislabelled low-quality rip.
    return { points: -90, reason: 'Suspiciously small for its claimed resolution (-90)' };
  }
  if (perMinute > band.ideal * 3) {
    return { points: -25, reason: 'Very large — heavy for streaming (-25)' };
  }
  if (perMinute >= band.min * 1.5 && perMinute <= band.ideal * 1.5) {
    return { points: 30, reason: 'Bitrate in the expected band (+30)' };
  }
  return { points: 0, reason: '' };
}

function scoreLanguage(result: TorrentResult, prefs: SourcePreferences): Contribution {
  if (prefs.preferredLanguages.length === 0) return { points: 0, reason: '' };

  const langs = result.parsed.languages;
  // No language tokens usually means an English release; treat as neutral-positive.
  if (langs.length === 0) {
    return prefs.preferredLanguages.includes('en')
      ? { points: 15, reason: 'Untagged — likely English (+15)' }
      : { points: 0, reason: '' };
  }

  const hit = langs.find((l) => prefs.preferredLanguages.includes(l));
  if (hit) return { points: 55, reason: `Preferred language ${hit} (+55)` };
  if (result.parsed.isMultiAudio) return { points: 20, reason: 'Multi-audio (+20)' };
  return { points: -35, reason: `Only ${langs.join(', ')} (-35)` };
}

function scoreExtras(result: TorrentResult, prefs: SourcePreferences): Contribution[] {
  const out: Contribution[] = [];
  const p = result.parsed;

  if (p.isRepack || p.isProper) out.push({ points: 25, reason: 'REPACK/PROPER (+25)' });
  if (p.isRemastered) out.push({ points: 15, reason: 'Remastered (+15)' });
  if (p.hasHardcodedSubs) out.push({ points: -30, reason: 'Hardcoded subtitles (-30)' });
  if (p.is3D) out.push({ points: -60, reason: '3D — not playable flat (-60)' });
  if (p.isDualAudio) out.push({ points: 20, reason: 'Dual audio (+20)' });

  if (prefs.preferHDR && p.hdr.length > 0) {
    out.push({ points: 45, reason: `HDR: ${p.hdr.join(', ')} (+45)` });
  } else if (!prefs.preferHDR && p.hdr.includes('DV') && !p.hdr.includes('HDR10')) {
    // Dolby-Vision-only files often render washed out on SDR displays.
    out.push({ points: -25, reason: 'Dolby Vision only — may look washed out on SDR (-25)' });
  }

  const group = p.releaseGroup?.toLowerCase();
  if (group) {
    if (prefs.preferredGroups.some((g) => g.toLowerCase() === group)) {
      out.push({ points: 70, reason: `Preferred group ${p.releaseGroup} (+70)` });
    }
  }

  if (p.isSeasonPack) {
    out.push({ points: 10, reason: 'Season pack (+10)' });
  }

  return out;
}

/** Reasons a result is rejected outright rather than merely ranked low. */
function hardRejectReason(result: TorrentResult, ctx: RankContext): string | null {
  const prefs = ctx.preferences;
  const p = result.parsed;

  if (result.seeders < prefs.minSeeders) {
    return `Below minimum seeders (${result.seeders} < ${prefs.minSeeders})`;
  }
  if (prefs.excludeLowQualitySources && LOW_QUALITY_SOURCES.includes(p.source)) {
    return `Low-quality source (${p.source})`;
  }
  if (prefs.minResolution > 0 && p.resolution > 0 && p.resolution < prefs.minResolution) {
    return `Below minimum resolution (${p.resolution}p < ${prefs.minResolution}p)`;
  }
  if (prefs.maxSizeBytes && result.sizeBytes > prefs.maxSizeBytes) {
    return 'Exceeds maximum size';
  }

  const haystack = result.title.toLowerCase();
  const blockedWord = prefs.blockedKeywords.find((k) => k && haystack.includes(k.toLowerCase()));
  if (blockedWord) return `Blocked keyword "${blockedWord}"`;

  const group = p.releaseGroup?.toLowerCase();
  if (group && prefs.blockedGroups.some((g) => g.toLowerCase() === group)) {
    return `Blocked group ${p.releaseGroup}`;
  }

  if (!matchesEpisode(p, ctx.season, ctx.episode)) {
    return 'Does not match the requested season/episode';
  }

  if (ctx.expectedTitle) {
    const similarity = titleSimilarity(ctx.expectedTitle, p.cleanTitle || result.title);
    if (similarity < 0.45) return 'Title does not match the selected item';
  }

  return null;
}

export interface RankedResults {
  accepted: TorrentResult[];
  /** Kept so the UI can offer "show N filtered results" rather than hiding them silently. */
  rejected: Array<{ result: TorrentResult; reason: string }>;
}

export function rankResults(results: TorrentResult[], ctx: RankContext): RankedResults {
  const accepted: TorrentResult[] = [];
  const rejected: Array<{ result: TorrentResult; reason: string }> = [];
  const runtime = ctx.runtimeMinutes ?? (ctx.episode !== undefined ? 45 : 110);

  for (const result of results) {
    const reject = hardRejectReason(result, ctx);
    if (reject) {
      rejected.push({ result, reason: reject });
      continue;
    }

    const contributions: Contribution[] = [
      scoreSeeders(result),
      scoreResolution(result, ctx.preferences),
      scoreSource(result),
      scoreCodec(result, ctx.preferences),
      scoreSizeSanity(result, runtime),
      scoreLanguage(result, ctx.preferences),
      ...scoreExtras(result, ctx.preferences),
    ];

    if (ctx.expectedYear && result.parsed.year) {
      contributions.push(
        result.parsed.year === ctx.expectedYear
          ? { points: 40, reason: `Year ${ctx.expectedYear} matches (+40)` }
          : { points: -50, reason: `Year ${result.parsed.year} ≠ ${ctx.expectedYear} (-50)` }
      );
    }

    result.score = contributions.reduce((sum, c) => sum + c.points, 0);
    result.scoreReasons = contributions.filter((c) => c.reason).map((c) => c.reason);
    accepted.push(result);
  }

  accepted.sort((a, b) => b.score - a.score || b.seeders - a.seeders);
  return { accepted, rejected };
}

/**
 * Merges duplicates across indexers, keyed on infohash.
 *
 * The same release is typically listed by several indexers with different
 * seeder counts. Keeping the maximum reported seeders is the right call: it is
 * the best available estimate of real swarm health, and understating it would
 * bury a perfectly good source.
 */
export function dedupeByInfoHash(results: TorrentResult[]): TorrentResult[] {
  const byHash = new Map<string, TorrentResult>();
  const noHash: TorrentResult[] = [];

  for (const result of results) {
    if (!result.infoHash) {
      noHash.push(result);
      continue;
    }

    const existing = byHash.get(result.infoHash);
    if (!existing) {
      byHash.set(result.infoHash, result);
      continue;
    }

    existing.seeders = Math.max(existing.seeders, result.seeders);
    existing.leechers = Math.max(existing.leechers, result.leechers);
    if (!existing.sizeBytes && result.sizeBytes) existing.sizeBytes = result.sizeBytes;
    if (!existing.torrentUrl && result.torrentUrl) existing.torrentUrl = result.torrentUrl;
    if (!existing.indexerName.includes(result.indexerName)) {
      existing.indexerName = `${existing.indexerName}, ${result.indexerName}`;
    }
  }

  return [...byHash.values(), ...noHash];
}
