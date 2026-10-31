/**
 * Whether an extension's declared language is one the viewer's regions cover
 * (the ranking's "Matches your languages" criterion). Pure.
 *
 * An extension that declares nothing, or "many", is neither raised nor lowered
 * (\`null\`, excluded from the score), so an undeclared provider is never ranked
 * down for what its maintainer did not write.
 */

const UNCOMMITTED = new Set(['multi', 'mul', 'multilingual', 'all', 'global', '']);

export interface LanguageScore {
  score: number | null;
  samples: number;
  detail: string;
}

export function languageScore(declared: string | undefined, wanted: readonly string[] | null | undefined): LanguageScore {
  if (!wanted || wanted.length === 0) return { score: null, samples: 0, detail: 'Every language is wanted.' };
  const language = declared?.trim().toLowerCase();
  if (language === undefined || UNCOMMITTED.has(language)) {
    return { score: null, samples: 0, detail: 'The extension declares no single language.' };
  }
  return wanted.some((l) => l.toLowerCase() === language)
    ? { score: 1, samples: 1, detail: `Declares ${language}, one of your languages.` }
    : { score: 0.2, samples: 1, detail: `Declares ${language}, not one of your languages.` };
}
