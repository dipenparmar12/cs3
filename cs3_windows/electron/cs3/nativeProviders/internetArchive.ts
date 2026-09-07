/**
 * Internet Archive: ~52,000 legally distributable films, documentaries and TV.
 *
 * The first provider on the native lane, chosen because its whole chain was
 * measured before a line of it was written (2026-09-07):
 *
 *   search   advancedsearch.php            HTTP 200, 844 ms
 *   detail   /metadata/<identifier>        HTTP 200
 *   stream   /download/<id>/<file>         HTTP 206, video/mp4, ftypmp42,
 *                                          Content-Range: bytes 0-1048575/3366125
 *
 * It is also the content this repository's provider chain was first proven
 * against — `InternetArchiveProvider` is the extension that verified the sidecar
 * end to end (AGENTS.md §5). So the corpus is known-good and only the lane is
 * new, which is the cheapest possible way to find out whether the lane is right.
 *
 * ## Four rules that came out of measuring, not designing
 *
 * **Search is `title:("<query>")` and never bare free text.** The endpoint ORs
 * bare terms across every field and `sort=downloads desc` then floats whatever
 * is popular rather than whatever matches. Measured on five titles:
 *
 *   | query                      | bare terms                        | title phrase              |
 *   |----------------------------|-----------------------------------|---------------------------|
 *   | apollo 11                  | Experiments in the Revival of…    | APOLLO 11 16MM ONBOARD…   |
 *   | night of the living dead   | Unus Annus (2019)                 | Night of the Living Dead  |
 *   | metropolis                 | Scarlet Street (1945)             | Metropolis at Camera Speed|
 *
 * The bare form is wrong on three of five. This is the same argument
 * `titleEnricher` makes from the other side: a confidently wrong match reads as
 * data corruption, where no match is a small loss.
 *
 * **A sort key is mandatory.** Passing an empty `sort[]` returns *nothing* —
 * not an error, an empty result set, which is indistinguishable from "no such
 * film" and would have shipped as a provider that silently never matches.
 *
 * **`format:(MPEG4)` is a quality gate, not an optimisation.** Ungated, the
 * highest-downloaded item under `subject:documentary` is a 3 MB test clip
 * literally titled *Sample 1*, with 1.25M downloads. Requiring a real video
 * derivative removes it and everything shaped like it.
 *
 * **`is_dark` items are skipped.** They appear in search, resolve to a file
 * list, and 403 on download — a dead row that looks exactly like a live one.
 *
 * ## What it does not do
 *
 * No `imdbId`. Archive items carry no IMDb identity, so rows from here merge
 * with catalogue rows on title and year alone and often will not merge at all.
 * That is honest: a 1968 public-domain print of a film is genuinely a different
 * artifact from the release an indexer would find, and quietly fusing them would
 * put a scan of a 16mm reduction print behind a poster for the 4K restoration.
 */
import { fetchJson } from '../../torrent/http.ts';
import { TvType, type ExtractorLink, type LoadResponse, type SearchResponse } from '../../../src/types/api.ts';
import type {
  NativeCapabilities,
  NativeCatalogRequest,
  NativeCatalogSection,
  NativeProvider,
} from './types.ts';
import { nativeAddress } from './types.ts';

const SEARCH_BASE = 'https://archive.org/advancedsearch.php';
const METADATA_BASE = 'https://archive.org/metadata';
const DOWNLOAD_BASE = 'https://archive.org/download';
const DETAILS_BASE = 'https://archive.org/details';

const TIMEOUT_MS = 15_000;
const SEARCH_ROWS = 40;
const PAGE_ROWS = 30;

/**
 * Only items with a real video derivative.
 *
 * `MPEG4` is Archive's own label for the h.264 MP4 derivative it generates for
 * anything playable, so this is a filter on "has a file a browser could open",
 * not on the container the original was uploaded in.
 */
const QUALITY_GATE = 'mediatype:(movies) AND format:(MPEG4)';

/**
 * Video formats worth offering, best first.
 *
 * `h.264` is the modern derivative and `MPEG4` the older one; `512Kb MPEG4` is
 * the low-bitrate copy Archive keeps for slow connections and is offered last
 * rather than hidden — on a bad line it is the one that plays.
 */
const VIDEO_FORMATS = ['h.264', 'MPEG4', 'HiRes MPEG4', '512Kb MPEG4', 'MPEG2', 'Ogg Video'];
const VIDEO_EXTENSIONS = /\.(mp4|m4v|mkv|webm|ogv|avi|mpg|mpeg)$/i;

/**
 * Subjects that put an item behind the adult gate.
 *
 * `porn\w*` rather than `porn` so the whole family matches — a trailing `\b`
 * after a fixed stem cannot match inside `pornography`, which is the commonest
 * spelling of the tag in this corpus and would have let it straight through.
 *
 * `adult` is deliberately matched only in `adult film`: on its own it is far too
 * loose, and `adult education` is a large and entirely ordinary part of the
 * Prelinger collection.
 */
const ADULT_SUBJECTS = /(\bporn\w*|\berotica?\b|\bxxx\b|\badult film)/i;

interface SearchDoc {
  identifier?: string;
  title?: string | string[];
  year?: string | number;
  description?: string | string[];
  subject?: string | string[];
  downloads?: number;
  mediatype?: string;
  collection?: string | string[];
}

interface SearchEnvelope {
  response?: { numFound?: number; docs?: SearchDoc[] };
}

interface MetadataFile {
  name?: string;
  format?: string;
  size?: string;
  length?: string;
  height?: string;
  width?: string;
  source?: string;
}

interface MetadataEnvelope {
  is_dark?: boolean;
  metadata?: {
    identifier?: string;
    title?: string | string[];
    description?: string | string[];
    year?: string | number;
    date?: string;
    subject?: string | string[];
    creator?: string | string[];
    collection?: string | string[];
    runtime?: string;
  };
  files?: MetadataFile[];
}

/** Archive returns single-valued fields as either a string or a one-element array. */
function one(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value.find((v) => typeof v === 'string' && v.length > 0);
  return value || undefined;
}

function many(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  return value ? [value] : [];
}

function yearOf(doc: { year?: string | number; date?: string }): number | undefined {
  const raw = doc.year ?? doc.date;
  if (raw == null) return undefined;
  const match = String(raw).match(/\d{4}/);
  if (!match) return undefined;
  const n = Number(match[0]);
  return n >= 1870 && n <= new Date().getFullYear() + 1 ? n : undefined;
}

/**
 * Escapes a user's query for a Lucene phrase.
 *
 * Only quotes and backslashes matter inside a quoted phrase — every other
 * metacharacter is literal there, which is most of the reason to use one.
 */
function phrase(query: string): string {
  return query.replace(/[\\"]/g, '\\$&').trim();
}

function isAdult(doc: { subject?: string | string[]; collection?: string | string[] }): boolean {
  const haystack = [...many(doc.subject), ...many(doc.collection)].join(' ');
  return ADULT_SUBJECTS.test(haystack);
}

function buildSearchUrl(query: string, sort: string, rows: number, page: number): string {
  const params = new URLSearchParams();
  params.set('q', query);
  for (const field of ['identifier', 'title', 'year', 'description', 'subject', 'downloads', 'collection']) {
    params.append('fl[]', field);
  }
  // Mandatory: an empty sort returns an empty result set rather than an error.
  params.append('sort[]', sort);
  params.set('rows', String(rows));
  params.set('page', String(Math.max(1, page)));
  params.set('output', 'json');
  return `${SEARCH_BASE}?${params.toString()}`;
}

function toSearchResponse(doc: SearchDoc, providerName: string): SearchResponse | null {
  const id = doc.identifier;
  if (!id) return null;
  const title = one(doc.title) ?? id;
  return {
    name: title,
    url: nativeAddress('internet-archive', id),
    apiName: providerName,
    type: TvType.Movie,
    posterUrl: `https://archive.org/services/img/${encodeURIComponent(id)}`,
    year: yearOf(doc),
  };
}

/**
 * The browseable rows, with the sizes each was measured at on 2026-09-07.
 *
 * Every one is gated (§ QUALITY_GATE) so the counts are of items that actually
 * have a playable derivative, not of catalogue entries.
 */
const SECTIONS: Array<NativeCatalogSection & { query: string }> = [
  {
    id: 'documentaries',
    title: 'Documentaries',
    subtitle: '~15,300 titles',
    query: `${QUALITY_GATE} AND subject:(documentary) AND year:[1900 TO 2030]`,
  },
  {
    id: 'feature-films',
    title: 'Public-domain feature films',
    subtitle: '~12,700 titles',
    query: `${QUALITY_GATE} AND collection:(feature_films) AND year:[1900 TO 2030]`,
  },
  {
    id: 'classic-tv',
    title: 'Classic television',
    subtitle: '~7,600 titles',
    query: `${QUALITY_GATE} AND collection:(classic_tv)`,
  },
  {
    id: 'animation',
    title: 'Animation & cartoons',
    subtitle: '~12,000 titles',
    query: `${QUALITY_GATE} AND collection:(animationandcartoons)`,
  },
  {
    id: 'noir',
    title: 'Film noir',
    subtitle: '~1,400 titles',
    query: `${QUALITY_GATE} AND subject:("film noir")`,
  },
  {
    id: 'silent',
    title: 'Silent film',
    subtitle: '~2,000 titles',
    query: `${QUALITY_GATE} AND subject:("silent film")`,
  },
  {
    id: 'prelinger',
    title: 'Prelinger archival',
    subtitle: '~7,900 ephemeral, educational and industrial films',
    query: `${QUALITY_GATE} AND collection:(prelinger)`,
  },
];

export interface InternetArchiveOptions {
  /** Whether adult-subject items may be returned. Read per call, never cached. */
  adultAllowed: () => boolean;
}

export class InternetArchiveProvider implements NativeProvider {
  readonly id = 'internet-archive';
  readonly name = 'Internet Archive';
  readonly description =
    'Public-domain and openly licensed films, documentaries and classic television, served directly by archive.org. Keyless, legal, and permanent — no scraper and nothing to expire.';
  readonly types = [TvType.Movie, TvType.Documentary, TvType.TvSeries];

  private readonly adultAllowed: () => boolean;

  constructor(options: InternetArchiveOptions) {
    this.adultAllowed = options.adultAllowed;
  }

  capabilities(): NativeCapabilities {
    return { search: true, catalog: true, resolve: true };
  }

  sections(): NativeCatalogSection[] {
    return SECTIONS.map(({ id, title, subtitle }) => ({ id, title, subtitle }));
  }

  async search(query: string, signal: AbortSignal): Promise<SearchResponse[]> {
    const term = phrase(query);
    if (term.length < 2) return [];
    const url = buildSearchUrl(
      `${QUALITY_GATE} AND title:("${term}")`,
      'downloads desc',
      SEARCH_ROWS,
      1
    );
    const envelope = await fetchJson<SearchEnvelope>(url, { timeoutMs: TIMEOUT_MS, signal });
    return this.mapDocs(envelope.response?.docs ?? []);
  }

  async catalog(request: NativeCatalogRequest, signal: AbortSignal): Promise<SearchResponse[]> {
    const section = SECTIONS.find((s) => s.id === request.sectionId);
    if (!section) return [];
    const url = buildSearchUrl(section.query, 'downloads desc', PAGE_ROWS, request.page ?? 1);
    const envelope = await fetchJson<SearchEnvelope>(url, { timeoutMs: TIMEOUT_MS, signal });
    return this.mapDocs(envelope.response?.docs ?? []);
  }

  private mapDocs(docs: SearchDoc[]): SearchResponse[] {
    const allowAdult = this.adultAllowed();
    const out: SearchResponse[] = [];
    for (const doc of docs) {
      if (!allowAdult && isAdult(doc)) continue;
      const row = toSearchResponse(doc, this.name);
      if (row) out.push(row);
    }
    return out;
  }

  async load(handle: string, signal: AbortSignal): Promise<LoadResponse> {
    const meta = await this.metadata(handle, signal);
    const m = meta.metadata ?? {};
    const title = one(m.title) ?? handle;
    const videos = playableFiles(meta.files ?? []);

    /**
     * A multi-file item is a series, not one source.
     *
     * `classic_tv` identifiers routinely hold a whole season. Collapsing that
     * into one row would play whichever file happened to sort first and lose
     * every other episode — which reads as a broken source rather than as a
     * detail page that never offered them.
     */
    const episodes =
      videos.length > 1
        ? videos.map((file, index) => ({
            name: prettyFileName(file.name ?? `Part ${index + 1}`),
            url: nativeAddress(this.id, `${handle}::${file.name}`),
            episode: index + 1,
            season: 1,
          }))
        : undefined;

    return {
      name: title,
      url: nativeAddress(this.id, handle),
      apiName: this.name,
      type: episodes ? TvType.TvSeries : TvType.Movie,
      posterUrl: `https://archive.org/services/img/${encodeURIComponent(handle)}`,
      year: yearOf(m),
      plot: one(m.description)?.replace(/<[^>]+>/g, '').trim(),
      tags: many(m.subject).slice(0, 12),
      duration: m.runtime,
      actors: many(m.creator).slice(0, 8),
      episodes,
    };
  }

  async loadLinks(handle: string, signal: AbortSignal): Promise<ExtractorLink[]> {
    // `<identifier>::<file>` addresses one file of a multi-file item; the bare
    // identifier means "whatever this item's best derivative is".
    const [identifier, wanted] = handle.split('::');
    const meta = await this.metadata(identifier, signal);
    const videos = playableFiles(meta.files ?? []);
    if (videos.length === 0) {
      throw new Error(
        `archive.org item "${identifier}" has no playable video derivative. It may be audio, text, or still being processed.`
      );
    }

    const chosen = wanted ? videos.filter((f) => f.name === wanted) : videos;
    if (chosen.length === 0) {
      throw new Error(`archive.org item "${identifier}" no longer contains the file "${wanted}".`);
    }

    return chosen.map((file) => ({
      source: this.name,
      name: `${formatLabel(file)} · archive.org`,
      url: `${DOWNLOAD_BASE}/${encodeURIComponent(identifier)}/${encodeURIComponent(file.name ?? '')}`,
      referer: `${DETAILS_BASE}/${encodeURIComponent(identifier)}`,
      quality: qualityOf(file),
      linkType: 'VIDEO' as const,
    }));
  }

  private async metadata(identifier: string, signal: AbortSignal): Promise<MetadataEnvelope> {
    const meta = await fetchJson<MetadataEnvelope>(
      `${METADATA_BASE}/${encodeURIComponent(identifier)}`,
      { timeoutMs: TIMEOUT_MS, signal }
    );
    /**
     * A dark item resolves and then 403s on every file.
     *
     * Reported here rather than let through, because a link that fails at the
     * player is attributed to the player — and this one is knowable up front.
     */
    if (meta.is_dark) {
      throw new Error(
        `archive.org item "${identifier}" is restricted (is_dark) and cannot be streamed.`
      );
    }
    return meta;
  }
}

/** Video derivatives, best first. */
function playableFiles(files: MetadataFile[]): MetadataFile[] {
  const videos = files.filter(
    (f) =>
      f.name &&
      (VIDEO_FORMATS.includes(f.format ?? '') || VIDEO_EXTENSIONS.test(f.name)) &&
      // Archive stores thumbnails and derivative spritesheets alongside; those
      // carry a video-ish format and are not watchable.
      !/\.(gif|jpg|jpeg|png|thumbs?)$/i.test(f.name)
  );
  const rank = (f: MetadataFile) => {
    const i = VIDEO_FORMATS.indexOf(f.format ?? '');
    return i === -1 ? VIDEO_FORMATS.length : i;
  };
  return videos.sort((a, b) => rank(a) - rank(b) || (a.name ?? '').localeCompare(b.name ?? ''));
}

function qualityOf(file: MetadataFile): number {
  const height = Number(file.height);
  if (Number.isFinite(height) && height > 0) return height;
  // The low-bitrate derivative is the one case where the label says more than
  // the (absent) dimensions do.
  if ((file.format ?? '').startsWith('512Kb')) return 360;
  return 0;
}

function formatLabel(file: MetadataFile): string {
  const height = Number(file.height);
  if (Number.isFinite(height) && height > 0) return `${height}p`;
  return file.format || 'video';
}

function prettyFileName(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/[._]+/g, ' ').trim();
}

export { playableFiles, phrase, isAdult, yearOf, buildSearchUrl, SECTIONS, QUALITY_GATE };
