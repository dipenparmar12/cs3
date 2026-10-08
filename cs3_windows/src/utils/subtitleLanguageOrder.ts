/**
 * Which subtitle languages come first in the picker.
 *
 * The viewer already told the app where they watch from (the region picker,
 * PRD-54); a viewer in India most likely wants Hindi or Tamil after English,
 * one in Latin America Spanish or Portuguese. So: English, then the languages
 * of the selected regions in the order the regions list them, then everything
 * else by how many results it has. Nothing is hidden — a preference orders,
 * it never filters.
 *
 * Regions speak ISO 639-1 (`hi`); subtitle catalogues speak 639-2 (`hin`), and
 * some rows carry only a name. All three are accepted.
 */

/** ISO 639-1 → 639-2/B, for the languages regions list and catalogues use. */
const ISO1_TO_ISO2: Record<string, string> = {
  en: 'eng', hi: 'hin', ta: 'tam', te: 'tel', ml: 'mal', kn: 'kan', bn: 'ben', gu: 'guj', mr: 'mar',
  pa: 'pan', ur: 'urd', or: 'ori', as: 'asm', id: 'ind', ms: 'may', th: 'tha', vi: 'vie', tl: 'tgl',
  fil: 'fil', my: 'bur', km: 'khm', zh: 'chi', ja: 'jpn', ko: 'kor', de: 'ger', fr: 'fre', it: 'ita',
  es: 'spa', pt: 'por', nl: 'dut', pl: 'pol', ru: 'rus', uk: 'ukr', sv: 'swe', no: 'nor', da: 'dan',
  fi: 'fin', cs: 'cze', el: 'gre', ro: 'rum', hu: 'hun', ar: 'ara', tr: 'tur', fa: 'per', he: 'heb',
  ku: 'kur', sw: 'swa', am: 'amh', ha: 'hau', yo: 'yor', zu: 'zul', af: 'afr',
};

/** Names a catalogue might use for a language, keyed by 639-2. */
const NAMES: Record<string, string> = {
  eng: 'english', hin: 'hindi', tam: 'tamil', tel: 'telugu', mal: 'malayalam', kan: 'kannada',
  ben: 'bengali', guj: 'gujarati', mar: 'marathi', pan: 'punjabi', urd: 'urdu', ind: 'indonesian',
  may: 'malay', tha: 'thai', vie: 'vietnamese', tgl: 'tagalog', fil: 'filipino', bur: 'burmese',
  khm: 'khmer', chi: 'chinese', jpn: 'japanese', kor: 'korean', ger: 'german', fre: 'french',
  ita: 'italian', spa: 'spanish', por: 'portuguese', dut: 'dutch', pol: 'polish', rus: 'russian',
  ukr: 'ukrainian', swe: 'swedish', nor: 'norwegian', dan: 'danish', fin: 'finnish', cze: 'czech',
  gre: 'greek', rum: 'romanian', hun: 'hungarian', ara: 'arabic', tur: 'turkish', per: 'persian',
  heb: 'hebrew', swa: 'swahili',
};

/** Alternative 639-2 spellings (terminology vs bibliographic). */
const ALIASES: Record<string, string> = { deu: 'ger', fra: 'fre', zho: 'chi', nld: 'dut', ces: 'cze', ell: 'gre', ron: 'rum', fas: 'per', msa: 'may', mya: 'bur' };

/** A language as one comparable 639-2 key, from a code or a name. */
export function languageKey(codeOrName: string | undefined): string {
  const value = (codeOrName ?? '').trim().toLowerCase();
  if (!value) return '';
  if (ISO1_TO_ISO2[value]) return ISO1_TO_ISO2[value];
  if (ALIASES[value]) return ALIASES[value];
  if (NAMES[value]) return value;
  const byName = Object.entries(NAMES).find(([, name]) => value === name || value.startsWith(`${name} `) || value.startsWith(`${name}(`));
  return byName ? byName[0] : value;
}

/** The preferred keys from region languages (639-1), English first and de-duplicated. */
export function preferredLanguageKeys(regionLanguages: string[]): string[] {
  const keys = ['eng', ...regionLanguages.map(languageKey)];
  return [...new Set(keys.filter(Boolean))];
}

export interface LanguageChip {
  code: string;
  name: string;
  count: number;
}

/** English, then region languages in their order, then the rest by count and name. */
export function orderLanguageChips<T extends LanguageChip>(chips: T[], preferred: string[]): T[] {
  const rank = (chip: T) => {
    const key = languageKey(chip.code) || languageKey(chip.name);
    const index = preferred.indexOf(key);
    return index < 0 ? Number.POSITIVE_INFINITY : index;
  };
  return [...chips].sort(
    (a, b) => rank(a) - rank(b) || b.count - a.count || a.name.localeCompare(b.name)
  );
}
