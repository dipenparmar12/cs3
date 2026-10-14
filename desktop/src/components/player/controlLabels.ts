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

/** Adds an ordinal only where two tracks genuinely share the same language. */
export function numberedLanguageLabel(
  code: string | undefined,
  label: string | undefined,
  siblings: Array<{ code?: string; label?: string }>,
): string {
  const language = controlLanguageLabel(code, label);
  if (!language) return 'Subtitles';

  const matching = siblings.filter((item) => controlLanguageLabel(item.code, item.label) === language);
  if (matching.length < 2) return language;

  const position = matching.findIndex((item) => item.code === code && item.label === label);
  return `${language} ${Math.max(0, position) + 1}`;
}
