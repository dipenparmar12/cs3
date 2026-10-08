import fs from 'node:fs';
import path from 'node:path';

/**
 * Subtitles the viewer chose to keep, on disk, and the index that finds them
 * again.
 *
 * Keyed on the *work* (normalised title + year + season + episode), never on a
 * stream URL: provider links expire within hours and a subtitle downloaded for
 * last night's link must still be offered for tonight's. The language and the
 * origin URL complete the identity, so one episode can hold an English and a
 * Spanish file, and pressing Download twice on the same result is a no-op
 * rather than a second copy.
 *
 * Saved as WebVTT: the bytes have already been charset-detected and converted
 * by `subtitles/convert.ts`, and `.vtt` is the one format both `<track>` and
 * mpv read without a second conversion.
 */

export type SubtitleOrigin = 'stream' | 'provider' | 'opensubtitles' | 'local';

export interface SavedSubtitle {
  id: string;
  title: string;
  year?: number;
  season?: number;
  episode?: number;
  /** ISO 639 code as the source reported it (`eng`, `en`). */
  lang: string;
  langName: string;
  origin: SubtitleOrigin;
  /** Where the bytes came from — identity for "already downloaded". */
  sourceUrl: string;
  filePath: string;
  format: 'vtt';
  savedAt: number;
}

export interface SaveRequest {
  title: string;
  year?: number;
  season?: number;
  episode?: number;
  lang: string;
  langName: string;
  origin: SubtitleOrigin;
  sourceUrl: string;
  vtt: string;
  /** Overwrite an existing copy of the same result. */
  refresh?: boolean;
}

const INDEX_FILE = 'subtitles.index.json';

export function workKey(title: string, year?: number, season?: number, episode?: number): string {
  const name = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return `${name}|${year ?? ''}|${season ?? ''}|${episode ?? ''}`;
}

/** `Dune Part Two (2024).eng.opensubtitles.vtt`, `Severance S01E02.eng.provider.vtt`. */
export function subtitleFileName(req: Pick<SaveRequest, 'title' | 'year' | 'season' | 'episode' | 'lang' | 'origin'>): string {
  const safe = req.title.replace(/[<>:"/\\|?*\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Subtitle';
  let stem = safe;
  if (req.season !== undefined && req.episode !== undefined) {
    stem += ` S${String(req.season).padStart(2, '0')}E${String(req.episode).padStart(2, '0')}`;
  } else if (req.episode !== undefined) {
    stem += ` E${String(req.episode).padStart(2, '0')}`;
  } else if (req.year) {
    stem += ` (${req.year})`;
  }
  const lang = (req.lang || 'und').toLowerCase().replace(/[^a-z-]/g, '') || 'und';
  return `${stem}.${lang}.${req.origin}.vtt`;
}

export class SubtitleLibrary {
  private entries: SavedSubtitle[] | null = null;
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  getDirectory(): string {
    return this.dir;
  }

  private load(): SavedSubtitle[] {
    if (this.entries) return this.entries;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(this.dir, INDEX_FILE), 'utf8'));
      this.entries = Array.isArray(raw) ? raw : [];
    } catch {
      this.entries = [];
    }
    return this.entries;
  }

  private persist(): void {
    fs.mkdirSync(this.dir, { recursive: true });
    const target = path.join(this.dir, INDEX_FILE);
    const temp = `${target}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.entries ?? [], null, 2));
    fs.renameSync(temp, target);
  }

  /**
   * Saved subtitles for one work, with entries whose file has since been
   * deleted dropped — an offered subtitle that fails to load reads as a broken
   * player, not as a missing file.
   */
  list(title: string, year?: number, season?: number, episode?: number): SavedSubtitle[] {
    const key = workKey(title, year, season, episode);
    const all = this.load();
    const live = all.filter((e) => fs.existsSync(e.filePath));
    if (live.length !== all.length) {
      this.entries = live;
      this.persist();
    }
    // Year is advisory: a provider page often omits it, so fall back to the
    // year-less key rather than missing a file saved from a catalogue page.
    const loose = workKey(title, undefined, season, episode);
    return live.filter((e) => {
      const k = workKey(e.title, e.year, e.season, e.episode);
      return k === key || workKey(e.title, undefined, e.season, e.episode) === loose;
    });
  }

  findBySource(sourceUrl: string): SavedSubtitle | undefined {
    return this.load().find((e) => e.sourceUrl === sourceUrl && fs.existsSync(e.filePath));
  }

  save(req: SaveRequest): { entry: SavedSubtitle; reused: boolean } {
    const existing = this.findBySource(req.sourceUrl);
    if (existing && !req.refresh) return { entry: existing, reused: true };

    fs.mkdirSync(this.dir, { recursive: true });
    const name = subtitleFileName(req);
    let filePath = existing?.filePath ?? path.join(this.dir, name);
    // Two different results for one work and language must not overwrite each
    // other; a numbered suffix keeps both.
    if (!existing) {
      let n = 2;
      while (fs.existsSync(filePath)) {
        filePath = path.join(this.dir, name.replace(/\.vtt$/, ` (${n}).vtt`));
        n += 1;
      }
    }
    fs.writeFileSync(filePath, req.vtt, 'utf8');

    const entry: SavedSubtitle = {
      id: existing?.id ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      title: req.title,
      year: req.year,
      season: req.season,
      episode: req.episode,
      lang: req.lang,
      langName: req.langName,
      origin: req.origin,
      sourceUrl: req.sourceUrl,
      filePath,
      format: 'vtt',
      savedAt: Date.now(),
    };
    const all = this.load().filter((e) => e.id !== entry.id);
    all.push(entry);
    this.entries = all;
    this.persist();
    return { entry, reused: false };
  }

  read(id: string): string | null {
    const entry = this.load().find((e) => e.id === id);
    if (!entry) return null;
    try {
      return fs.readFileSync(entry.filePath, 'utf8');
    } catch {
      return null;
    }
  }

  remove(id: string): boolean {
    const all = this.load();
    const entry = all.find((e) => e.id === id);
    if (!entry) return false;
    try {
      fs.unlinkSync(entry.filePath);
    } catch {}
    this.entries = all.filter((e) => e.id !== id);
    this.persist();
    return true;
  }

  count(): number {
    return this.load().length;
  }

  /**
   * Removes every subtitle this library saved, and only those.
   *
   * Driven by the index rather than by listing the folder: the folder sits in
   * the viewer's Downloads and may hold files they put there themselves.
   */
  removeAll(): number {
    const all = this.load();
    for (const entry of all) {
      try {
        fs.unlinkSync(entry.filePath);
      } catch {}
    }
    this.entries = [];
    this.persist();
    return all.length;
  }
}
