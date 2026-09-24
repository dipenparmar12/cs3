import type { SitePlugin } from '../../src/types/plugin';

/**
 * Which extensions a new install starts with, from each bundled repository.
 *
 * The first launch used to install the first twelve entries of each bundled
 * repository in whatever order its index listed them — which in the large
 * mixed repositories meant Hindi, Tamil, Indonesian and Turkish scrapers
 * ahead of English ones, and a new viewer's first search drawing on sites in
 * languages they do not watch. The Android app starts with nothing installed;
 * starting with extensions at all is this app's choice, so they should be the
 * ones a viewer would have picked.
 *
 * So the viewer's own language and English come first, "multi" and
 * undeclared after, and nothing else at all; within those, what the
 * maintainer calls working before beta before slow, and never anything they
 * have marked down. The rest of each repository is one click away in the
 * extensions screen.
 *
 * Pure, so the rule can be tested without a network or an Electron app.
 */

/** Declared by providers that serve several languages, or declared by nobody. */
const UNIVERSAL = new Set(['', 'multi', 'mul', 'all', 'global', 'xx']);

/** Upstream's status codes, ranked by what a first search should draw on. */
const STATUS_RANK: Record<number, number> = { 1: 0, 3: 1, 2: 2 };

export interface StarterPreferences {
  /** Language codes wanted, most wanted first. */
  languages: string[];
  allowAdult: boolean;
  limit: number;
}

/** The viewer's own language first, then English: `en-IN` → `['en']`, `de-DE` → `['de', 'en']`. */
export function preferredLanguages(locale: string | undefined): string[] {
  const own = (locale ?? '').toLowerCase().split(/[-_]/)[0];
  return [...new Set([own, 'en'].filter(Boolean))];
}

/**
 * Whether a repository's declared language is one the viewer uses.
 *
 * The catalogue writes it as free text — "English", "German (DE)", "Hindi /
 * English", "Multilingual" — so it is read the way a person would read it: a
 * repository that names any wanted language, or serves several, qualifies.
 */
export function repositorySpeaks(declared: string | undefined, languages: string[]): boolean {
  const text = String(declared ?? '').toLowerCase();
  if (!text || /multi|global/.test(text)) return true;
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames(['en'], { type: 'language' });
  } catch {
    names = null;
  }
  return languages.some((code) => {
    if (!/^[a-z]{2,3}$/.test(code)) return false;
    const name = (names?.of(code) ?? '').toLowerCase();
    return (name !== '' && text.includes(name)) || new RegExp(`\\b${code}\\b`).test(text);
  });
}

export function isAdultPlugin(plugin: SitePlugin): boolean {
  return (plugin.tvTypes ?? []).some((type) => String(type).toUpperCase() === 'NSFW');
}

function languageOf(plugin: SitePlugin): string {
  return String(plugin.language ?? '').trim().toLowerCase();
}

export function pickStarterPlugins(plugins: SitePlugin[], preferences: StarterPreferences): SitePlugin[] {
  const wanted = preferences.languages.map((code) => code.toLowerCase());
  const languageRank = (plugin: SitePlugin): number => {
    const language = languageOf(plugin);
    const index = wanted.indexOf(language);
    if (index >= 0) return index;
    return UNIVERSAL.has(language) ? wanted.length : -1;
  };

  return plugins
    .map((plugin, order) => ({ plugin, order, language: languageRank(plugin) }))
    .filter(({ plugin, language }) => {
      if (!plugin?.url || !plugin?.internalName) return false;
      // The maintainer's own word that it is down: installing it would spend
      // the viewer's first minute on an empty result.
      if (Number(plugin.status) === 0) return false;
      if (!preferences.allowAdult && isAdultPlugin(plugin)) return false;
      return language >= 0;
    })
    .sort(
      (a, b) =>
        a.language - b.language ||
        (STATUS_RANK[Number(a.plugin.status)] ?? 1) - (STATUS_RANK[Number(b.plugin.status)] ?? 1) ||
        a.order - b.order
    )
    .slice(0, preferences.limit)
    .map(({ plugin }) => plugin);
}
