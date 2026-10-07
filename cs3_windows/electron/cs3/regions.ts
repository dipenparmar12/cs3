/**
 * Which repositories and extensions a viewer's regions call for — PRD-54.
 *
 * The first run used to choose from the hand-set `bundled` flag and the system
 * locale, so an Indian viewer on an `en-US` install got none of the Indian OTT
 * repositories and an Indonesian one got none of the Indonesian ones. Here the
 * repositories declare where their content is from and the viewer says where
 * theirs is from; the plan is the intersection. Nothing in this file names a
 * repository.
 *
 * Pure, so the rule can be tested without a network or an Electron app.
 */

export type RegionId =
  | 'GLOBAL'
  | 'IN'
  | 'SEA'
  | 'CN'
  | 'JP'
  | 'KR'
  | 'EU'
  | 'NA'
  | 'LATAM'
  | 'ME'
  | 'AF'
  | 'ALL';

export interface Region {
  id: RegionId;
  label: string;
  /** ISO 639-1 codes the region's content is in. */
  languages: string[];
}

export const REGIONS: Region[] = [
  { id: 'GLOBAL', label: 'Global (English & multilingual)', languages: ['en'] },
  { id: 'IN', label: 'India', languages: ['hi', 'ta', 'te', 'ml', 'kn', 'bn', 'gu', 'mr', 'pa', 'ur', 'or', 'as'] },
  { id: 'SEA', label: 'Southeast Asia', languages: ['id', 'ms', 'th', 'vi', 'tl', 'fil', 'my', 'km'] },
  { id: 'CN', label: 'China & Chinese-speaking', languages: ['zh'] },
  { id: 'JP', label: 'Japan', languages: ['ja'] },
  { id: 'KR', label: 'Korea', languages: ['ko'] },
  {
    id: 'EU',
    label: 'Europe',
    languages: ['de', 'fr', 'it', 'es', 'pt', 'nl', 'pl', 'ru', 'uk', 'sv', 'no', 'da', 'fi', 'cs', 'el', 'ro', 'hu'],
  },
  { id: 'NA', label: 'North America', languages: ['en', 'es', 'fr'] },
  { id: 'LATAM', label: 'Latin & South America', languages: ['es', 'pt'] },
  { id: 'ME', label: 'Middle East & Turkey', languages: ['ar', 'tr', 'fa', 'he', 'ku'] },
  { id: 'AF', label: 'Africa', languages: ['sw', 'am', 'ha', 'yo', 'zu', 'af', 'ar', 'fr'] },
  { id: 'ALL', label: 'All regions', languages: [] },
];

const REGION_IDS = new Set<string>(REGIONS.map((region) => region.id));

/** A repository with no single home: English or multilingual content. */
export const GLOBAL_MARK = '*';

/** What `regions.ts` needs to know about a catalogue entry. */
export interface RegionalRepository {
  rawRepoUrl: string;
  name: string;
  language: string;
  regions?: string[];
  bundled?: boolean;
  adult?: boolean;
  verified?: boolean;
}

export function normaliseSelection(selection: readonly string[]): RegionId[] {
  return [...new Set(selection.map((id) => String(id).toUpperCase()))].filter((id): id is RegionId =>
    REGION_IDS.has(id)
  );
}

/**
 * The languages a selection watches. `null` means every language — `ALL` is a
 * mode, not a long list, so a language nobody has tabled yet is not dropped.
 */
export function wantedLanguages(selection: readonly RegionId[]): string[] | null {
  if (selection.includes('ALL')) return null;
  const languages = REGIONS.filter((region) => selection.includes(region.id)).flatMap((r) => r.languages);
  return [...new Set(languages)];
}

/**
 * The regions a repository serves: its declaration, else derived from the
 * free-text `language` the catalogue (and every custom repository) carries.
 * "Multilingual", "Global" and plain English read as global; a named language
 * maps to every region that owns it.
 */
export function repositoryRegions(repo: Pick<RegionalRepository, 'regions' | 'language'>): string[] {
  if (repo.regions && repo.regions.length > 0) return repo.regions;
  const text = String(repo.language ?? '').toLowerCase();
  if (!text || /multi|global/.test(text) || /^\s*english\s*$/.test(text)) return [GLOBAL_MARK];

  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames(['en'], { type: 'language' });
  } catch {
    names = null;
  }
  const found = new Set<string>();
  for (const region of REGIONS) {
    if (region.id === 'GLOBAL' || region.id === 'NA') continue;
    for (const code of region.languages) {
      const name = (names?.of(code) ?? '').toLowerCase();
      // Whole words: "Malayalam" must not read as Malay.
      const named = name !== '' && new RegExp(`\\b${name}\\b`).test(text);
      if (named || new RegExp(`\\(${code}\\)`).test(text)) found.add(region.id);
    }
  }
  return found.size > 0 ? [...found] : [GLOBAL_MARK];
}

/**
 * How a repository matched: through a named region the viewer chose, or only
 * through being global. The difference decides whether its extensions are
 * filtered by language — see {@link planRegionalSetup}.
 */
export type RepositoryMatch = 'regional' | 'global' | null;

export function matchRepository(
  repo: Pick<RegionalRepository, 'regions' | 'language'>,
  selection: readonly RegionId[]
): RepositoryMatch {
  const regions = repositoryRegions(repo);
  if (selection.includes('ALL')) return regions.some((r) => r !== GLOBAL_MARK) ? 'regional' : 'global';
  if (regions.some((r) => r !== GLOBAL_MARK && selection.includes(r as RegionId))) return 'regional';
  if (regions.includes(GLOBAL_MARK) && selection.includes('GLOBAL')) return 'global';
  return null;
}

export interface RegionalPlanEntry<R extends RegionalRepository> {
  repo: R;
  /**
   * Why it is in the plan. `language`: another region's repository, kept only
   * for the extensions in the viewer's languages — German Providers carrying
   * an English scraper. Kept only if one is found, never merely added.
   */
  reason: 'regional' | 'global' | 'language';
  /** Install starter extensions from it, not only add it. */
  install: boolean;
  /** Languages its starter extensions must be in; `null` = any. */
  languages: string[] | null;
}

/**
 * Selection → what to add and what to install from (PRD-54 §5).
 *
 * - Every matching repository is **added**: cheap, reversible, and it puts the
 *   whole catalogue one click away.
 * - Starter extensions are **installed** from a repository matched through a
 *   named region — in any language, because NetMirror tags its Netflix provider
 *   `en` and is still the Indian viewer's repository — and from a bundled
 *   global one, filtered to the selection's languages.
 * - An unbundled global repository is added only: `bundled` is the claim the
 *   end-to-end harness drove it, and auto-installing twenty unverified packs is
 *   the first run this app exists not to have.
 * - Adult repositories are added only when adult content is allowed, and never
 *   installed from. Unverified (known-dead) repositories never match.
 * - With `crossRegion`, every other repository is searched for extensions in
 *   the selection's languages: a regional repository's language is a summary
 *   of most of it, not all of it, and an English scraper inside a German pack
 *   is one a Global viewer would want and would never think to look for.
 */
export function planRegionalSetup<R extends RegionalRepository>(
  catalogue: readonly R[],
  selection: readonly RegionId[],
  options: { adultAllowed: boolean; crossRegion?: boolean; skip?: ReadonlySet<string> }
): RegionalPlanEntry<R>[] {
  const languages = wantedLanguages(selection);
  const plan: RegionalPlanEntry<R>[] = [];
  for (const repo of catalogue) {
    if (repo.verified === false) continue;
    if (repo.adult && !options.adultAllowed) continue;
    if (options.skip?.has(repo.rawRepoUrl)) continue;
    const match = matchRepository(repo, selection);
    if (match) {
      const install = !repo.adult && (match === 'regional' || repo.bundled === true);
      plan.push({ repo, reason: match, install, languages: match === 'regional' ? null : languages });
    } else if (options.crossRegion && !repo.adult && languages && languages.length > 0) {
      plan.push({ repo, reason: 'language', install: true, languages });
    }
  }
  return plan;
}

/**
 * Installed catalogue repositories that matched only through regions the
 * viewer has just removed — offered for review, never acted on here. A
 * repository still covered by what remains is not named, and one the
 * catalogue does not know (a custom repository) never is.
 */
export function affectedByRemoval<R extends RegionalRepository>(
  installed: readonly R[],
  before: readonly RegionId[],
  after: readonly RegionId[]
): R[] {
  return installed.filter((repo) => matchRepository(repo, before) && !matchRepository(repo, after));
}

/**
 * The selection to offer before the viewer has made one, from the system
 * locale: `en-IN` → India + Global, `id-ID` → Southeast Asia + Global. The
 * country decides when it is a region's; otherwise the language does.
 */
export function suggestRegions(locale: string | undefined): RegionId[] {
  const [language = '', country = ''] = String(locale ?? '')
    .toLowerCase()
    .split(/[-_]/);
  const byCountry: Record<string, RegionId> = {
    in: 'IN', pk: 'IN', bd: 'IN', lk: 'IN', np: 'IN',
    id: 'SEA', my: 'SEA', th: 'SEA', vn: 'SEA', ph: 'SEA', sg: 'SEA',
    cn: 'CN', tw: 'CN', hk: 'CN', jp: 'JP', kr: 'KR',
    us: 'NA', ca: 'NA', mx: 'LATAM', br: 'LATAM', ar: 'LATAM', co: 'LATAM', cl: 'LATAM', pe: 'LATAM',
    tr: 'ME', sa: 'ME', ae: 'ME', eg: 'ME', ir: 'ME', il: 'ME', iq: 'ME',
    ng: 'AF', ke: 'AF', za: 'AF', et: 'AF', gh: 'AF',
  };
  let region: RegionId | undefined = byCountry[country];
  if (!region && language && language !== 'en') {
    region = REGIONS.find((r) => r.id !== 'NA' && r.id !== 'GLOBAL' && r.languages.includes(language))?.id;
  }
  // North America's content is the global English catalogue; Global covers it.
  return region && region !== 'NA' ? [region, 'GLOBAL'] : ['GLOBAL'];
}
