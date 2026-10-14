import { getLanguageName } from '../../utils/languageFlag.ts';

/** A stable, human-sized label for the player control bar, never a release name. */
export function controlLanguageLabel(code?: string, label?: string): string {
  const language = getLanguageName(code ?? '', label);
  if (language) return language;

  const plain = (label ?? '')
    .replace(/[[({].*?[\])}]/g, '')
    .replace(/\b(?:web|bluray|blu-ray|webrip|web-dl|srt|vtt|ass)\b/gi, '')
    .replace(/[-_.]+/g, ' ')
    .trim();

  return plain.length > 0 && plain.length <= 18 ? plain : '';
}

/**
 * A link's audio version as words: `['hi']` → "Hindi", `['en', 'hi']` →
 * "English + Hindi", four or more → "English + Hindi +2". An unreadable code is
 * shown as itself rather than dropped, so two versions never share one label.
 */
export function languageSetLabel(codes: readonly string[]): string {
  const names = codes.map((code) => controlLanguageLabel(code) || code.toUpperCase());
  return names.length > 3 ? `${names.slice(0, 2).join(' + ')} +${names.length - 2}` : names.join(' + ');
}

/**
 * One short label per track, in the same order, for a menu or the control bar.
 *
 * An ordinal is added only where two tracks genuinely share a language, and it
 * is the track's *position* among them — two files both named "English" are
 * "English 1" and "English 2", never both "English 1". A track whose language
 * cannot be read is "Track N" rather than its release name, so a scraper's
 * 80-character file name never reaches the bar.
 */
export function languageLabels(tracks: ReadonlyArray<{ code?: string; label?: string }>): string[] {
  const languages = tracks.map((track) => controlLanguageLabel(track.code, track.label));
  const totals = new Map<string, number>();
  for (const language of languages) if (language) totals.set(language, (totals.get(language) ?? 0) + 1);

  const seen = new Map<string, number>();
  return languages.map((language, index) => {
    if (!language) return `Track ${index + 1}`;
    if ((totals.get(language) ?? 0) < 2) return language;
    const ordinal = (seen.get(language) ?? 0) + 1;
    seen.set(language, ordinal);
    return `${language} ${ordinal}`;
  });
}
