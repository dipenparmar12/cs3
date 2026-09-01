import { parseReleaseName } from './releaseParser.ts';
import { Resolution } from '../../src/types/torrent.ts';
import type { TorrentFileEntry, TorrentFileInfo } from './torrentFile.ts';

/**
 * What is actually *in* a torrent, as something a person can browse.
 *
 * A `.torrent` is a flat list of paths and byte counts. What a viewer wants is
 * "this is season 2, here are ten episodes, the rest is artwork" — and the
 * distance between those two is entirely in this file.
 *
 * Pure and tested, for the same reason `ottPlatforms.ts` and `deadRows.ts` are:
 * every wrong answer here is silent and plausible. Classifying a sample as the
 * feature plays ninety seconds of trailer and stops. Mapping `S02E10` onto
 * episode 1 starts the wrong episode. Neither raises anything, and both are
 * attributed by the viewer to the torrent being bad.
 *
 * ## The rules, and why each is where it is
 *
 * **Extension decides the kind, never the folder.** A file in `Extras/` may be
 * the feature (plenty of packs put everything in one subdirectory) and a `.mkv`
 * in `Sample/` is still video. Folder names are a *hint* used for ordering and
 * for the `extra` flag, never for whether something is playable.
 *
 * **A sample is recognised by size as well as by name.** `sample` in a path is
 * the usual marker, but the more reliable signal is a video under 3% of the
 * largest one — encoders name them inconsistently and the size ratio does not
 * lie. Both are needed: a 40 MB sample beside a 700 MB episode is under the
 * ratio, and a "sample" folder in a 50-file pack may hold a full-length extra.
 *
 * **Nothing is hidden, only sorted.** Samples, extras and non-media are kept in
 * the result and flagged. A file the parser judged uninteresting and *dropped*
 * is a file the viewer cannot reach at all, which is the failure this whole
 * area keeps producing — PRD 43 F-1 in a different costume.
 */

const VIDEO = new Set([
  'mkv', 'mp4', 'avi', 'webm', 'mov', 'm4v', 'ts', 'm2ts', 'mts', 'flv',
  'wmv', 'mpg', 'mpeg', 'ogv', '3gp', 'divx', 'vob', 'rmvb', 'asf',
]);
const SUBTITLE = new Set(['srt', 'ass', 'ssa', 'vtt', 'sub', 'idx', 'smi']);
const AUDIO = new Set(['mp3', 'flac', 'aac', 'ac3', 'dts', 'm4a', 'ogg', 'opus', 'wav', 'mka']);
const IMAGE = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tbn']);

export type TorrentFileKind = 'video' | 'subtitle' | 'audio' | 'image' | 'other';

export interface TorrentContentFile extends TorrentFileEntry {
  /** Just the file name. */
  name: string;
  /** Directory components, without the file name. */
  directory: string[];
  extension: string;
  kind: TorrentFileKind;
  /** A trailer or preview clip rather than the thing you came for. */
  isSample: boolean;
  /** Bonus material: featurettes, deleted scenes, behind the scenes. */
  isExtra: boolean;
  /** Parsed from the file name, then the containing folder as a fallback. */
  season?: number;
  episode?: number;
  /** The release name cleaned into something readable. */
  title: string;
  year?: number;
  /**
   * The parser's own `Resolution` (a height in pixels, 0 for unknown) rather
   * than a string. Keeping the shared type means the ranker, the download
   * identity and this list all compare resolutions the same way — a `'1080p'`
   * here would need converting at every one of those boundaries.
   */
  resolution: Resolution;
}

export interface TorrentSeason {
  season: number;
  episodes: TorrentContentFile[];
}

export type TorrentShape = 'movie' | 'series' | 'collection' | 'mixed' | 'empty';

export interface TorrentContents {
  shape: TorrentShape;
  /** The torrent's own name, cleaned for display. */
  title: string;
  year?: number;
  files: TorrentContentFile[];
  /** Playable video, samples and extras excluded. Ordered for viewing. */
  playable: TorrentContentFile[];
  seasons: TorrentSeason[];
  subtitles: TorrentContentFile[];
  samples: TorrentContentFile[];
  extras: TorrentContentFile[];
  totalSize: number;
  /** Distinct directories, so a page can say "12 files in 3 folders". */
  folderCount: number;
  /**
   * The file a bare "play this torrent" should open.
   *
   * The largest playable video, which is the right answer for a movie and a
   * defensible one for a pack — it is the fullest thing in there. A series
   * shows its episode list instead and never reaches this.
   */
  primary?: TorrentContentFile;
}

const SAMPLE_HINT = /(^|[^a-z])sample([^a-z]|$)|\btrailer\b|\bpreview\b/i;
const EXTRA_HINT =
  /\b(extras?|featurettes?|behind[.\s_-]?the[.\s_-]?scenes|deleted[.\s_-]?scenes|bloopers|interviews?|bonus|making[.\s_-]?of)\b/i;
/** A sample is usually a fraction of the feature; 3% is comfortably clear of a short episode. */
const SAMPLE_SIZE_RATIO = 0.03;

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function kindOf(extension: string): TorrentFileKind {
  if (VIDEO.has(extension)) return 'video';
  if (SUBTITLE.has(extension)) return 'subtitle';
  if (AUDIO.has(extension)) return 'audio';
  if (IMAGE.has(extension)) return 'image';
  return 'other';
}

/**
 * A season/episode for a file, from its own name and then its folder.
 *
 * The folder is consulted second and only for the season, because a path like
 * `Season 2/Episode 03.mkv` is common and the file name alone gives no season.
 * The episode is never taken from a folder: a directory numbered `01` is a
 * season or a disc far more often than an episode.
 */
function episodeOf(
  file: { name: string; directory: string[] }
): { season?: number; episode?: number } {
  const own = parseReleaseName(file.name);
  let season = own.season;
  const episode = own.episode;

  if (season === undefined) {
    for (let i = file.directory.length - 1; i >= 0; i--) {
      const folder = file.directory[i];
      const explicit = /\b(?:season|series|s)[.\s_-]?(\d{1,2})\b/i.exec(folder);
      if (explicit) {
        season = Number(explicit[1]);
        break;
      }
      const bare = /^(\d{1,2})$/.exec(folder.trim());
      if (bare) {
        season = Number(bare[1]);
        break;
      }
    }
  }

  /*
   * An episode with no season at all is season 1. Anime packs and plenty of
   * single-season rips number episodes without ever saying which season, and
   * leaving those unassigned would scatter a complete series across a
   * "no season" bucket that reads as broken parsing.
   */
  if (episode !== undefined && season === undefined) season = 1;
  return { season, episode };
}

/** One flat, classified view of every file the torrent declares. */
export function classifyFiles(info: TorrentFileInfo): TorrentContentFile[] {
  const largestVideo = info.files.reduce((max, file) => {
    const extension = extensionOf(file.path[file.path.length - 1] ?? '');
    return VIDEO.has(extension) ? Math.max(max, file.length) : max;
  }, 0);

  return info.files.map((file) => {
    const name = file.path[file.path.length - 1] ?? '';
    const directory = file.path.slice(0, -1);
    const extension = extensionOf(name);
    const kind = kindOf(extension);
    const whole = file.path.join('/');
    const parsed = parseReleaseName(name);

    const isSample =
      kind === 'video' &&
      (SAMPLE_HINT.test(whole) ||
        (largestVideo > 0 && file.length < largestVideo * SAMPLE_SIZE_RATIO));

    return {
      ...file,
      name,
      directory,
      extension,
      kind,
      isSample,
      // A sample is not also an extra: it is the same file counted twice, and
      // the two lists are shown separately.
      isExtra: kind === 'video' && !isSample && EXTRA_HINT.test(whole),
      ...episodeOf({ name, directory }),
      title: parsed.cleanTitle || name.replace(/\.[^.]+$/, ''),
      year: parsed.year,
      resolution: parsed.resolution,
    };
  });
}

/**
 * The whole browsable picture.
 *
 * Shape is decided from what the episode parser found rather than from the
 * torrent's name, because names lie in both directions: a "Complete Series"
 * pack that turns out to hold one file is a movie, and a film titled
 * `Episode.I.The.Phantom.Menace` is not a series.
 */
export function readTorrentContents(info: TorrentFileInfo): TorrentContents {
  const files = classifyFiles(info);
  const videos = files.filter((file) => file.kind === 'video');
  const playable = videos.filter((file) => !file.isSample && !file.isExtra);

  const seasonMap = new Map<number, TorrentContentFile[]>();
  for (const file of playable) {
    if (file.episode === undefined || file.season === undefined) continue;
    const bucket = seasonMap.get(file.season) ?? [];
    bucket.push(file);
    seasonMap.set(file.season, bucket);
  }

  const seasons: TorrentSeason[] = [...seasonMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([season, episodes]) => ({
      season,
      episodes: episodes.sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0)),
    }));

  const episodeCount = seasons.reduce((sum, season) => sum + season.episodes.length, 0);

  let shape: TorrentShape;
  if (playable.length === 0) shape = 'empty';
  else if (episodeCount >= 2) {
    /*
     * A pack with episodes *and* unnumbered features is `mixed` rather than
     * `series`. Calling it a series would render only the episode list, and
     * every film in it would become unreachable — the same "exists and cannot
     * be reached" failure, produced by a classifier this time.
     */
    shape = episodeCount === playable.length ? 'series' : 'mixed';
  } else if (playable.length === 1) shape = 'movie';
  else shape = 'collection';

  const rootParsed = parseReleaseName(info.name);
  const folders = new Set<string>();
  for (const file of files) {
    if (file.directory.length > 0) folders.add(file.directory.join('/'));
  }

  return {
    shape,
    title: rootParsed.cleanTitle || info.name,
    year: rootParsed.year,
    files,
    playable: playable.sort(compareForViewing),
    seasons,
    subtitles: files.filter((file) => file.kind === 'subtitle'),
    samples: videos.filter((file) => file.isSample),
    extras: videos.filter((file) => file.isExtra),
    totalSize: info.totalSize,
    folderCount: folders.size,
    primary:
      playable.length > 0
        ? playable.reduce((best, file) => (file.length > best.length ? file : best))
        : undefined,
  };
}

/** Season then episode, then path — so a list reads the way it is watched. */
function compareForViewing(a: TorrentContentFile, b: TorrentContentFile): number {
  if (a.season !== undefined && b.season !== undefined && a.season !== b.season) {
    return a.season - b.season;
  }
  if (a.episode !== undefined && b.episode !== undefined && a.episode !== b.episode) {
    return a.episode - b.episode;
  }
  // Only one side is numbered: the numbered one comes first, so a pack's
  // episodes stay together above its loose features.
  if ((a.episode === undefined) !== (b.episode === undefined)) {
    return a.episode === undefined ? 1 : -1;
  }
  return a.path.join('/').localeCompare(b.path.join('/'));
}

/**
 * Searching inside a torrent, over metadata this machine already holds.
 *
 * No network and no download: a pack can hold hundreds of files and the whole
 * point is to find the one worth starting *before* committing to any bytes.
 *
 * Every term must match something, and a term may match the file name, any part
 * of its path, the resolution, or an episode code — so `s02 1080p` narrows,
 * where matching any term would widen. `e7` and `episode 7` both find `S02E07`,
 * because a viewer types what they remember rather than the encoder's spelling.
 */
export function searchTorrentFiles(
  files: TorrentContentFile[],
  query: string
): TorrentContentFile[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return files;

  return files.filter((file) => {
    const haystack = [
      file.path.join('/'),
      file.title,
      // Rendered the way a viewer types it: the stored value is a height.
      file.resolution ? `${file.resolution}p ${file.resolution}` : '',
      file.season !== undefined && file.episode !== undefined
        ? `s${String(file.season).padStart(2, '0')}e${String(file.episode).padStart(2, '0')} ` +
          `${file.season}x${String(file.episode).padStart(2, '0')} ` +
          `season ${file.season} episode ${file.episode} ` +
          `e${file.episode} e${String(file.episode).padStart(2, '0')}`
        : '',
    ]
      .join(' ')
      .toLowerCase();

    return terms.every((term) => haystack.includes(term));
  });
}

/**
 * The subtitle files that belong to one video.
 *
 * Matched on the file name without its extension first — the near-universal
 * convention, and exact — then on season/episode, which is what rescues a
 * `Subs/` folder whose names do not match the video's at all. Language is left
 * to the player: the file name is the only hint there is and guessing it here
 * would put a confident wrong label on a track.
 */
export function subtitlesFor(
  video: TorrentContentFile,
  subtitles: TorrentContentFile[]
): TorrentContentFile[] {
  const stem = video.name.replace(/\.[^.]+$/, '').toLowerCase();
  const exact = subtitles.filter((file) => {
    const candidate = file.name.replace(/\.[^.]+$/, '').toLowerCase();
    return candidate === stem || candidate.startsWith(`${stem}.`);
  });
  if (exact.length > 0) return exact;

  if (video.season === undefined || video.episode === undefined) {
    /*
     * A single-video torrent takes every subtitle in it. With one film there is
     * nothing else they could belong to, and offering them beats leaving a
     * viewer with none because the uploader named them `English.srt`.
     */
    return subtitles;
  }
  return subtitles.filter(
    (file) => file.season === video.season && file.episode === video.episode
  );
}
