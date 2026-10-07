/**
 * Subtitles saved beside a downloaded file (subtitle PRD §17–19), named so
 * desktop players find them on their own: `Movie Name.en.srt`, one per
 * language, never overwritten by a second copy of the same language.
 */

const LANGUAGE_CODES: Record<string, string> = {
  english: 'en', eng: 'en', hindi: 'hi', hin: 'hi', gujarati: 'gu', tamil: 'ta', telugu: 'te',
  malayalam: 'ml', kannada: 'kn', bengali: 'bn', marathi: 'mr', punjabi: 'pa', urdu: 'ur',
  spanish: 'es', spa: 'es', french: 'fr', fre: 'fr', german: 'de', ger: 'de', italian: 'it',
  portuguese: 'pt', por: 'pt', japanese: 'ja', jpn: 'ja', korean: 'ko', kor: 'ko', chinese: 'zh',
  arabic: 'ar', ara: 'ar', russian: 'ru', rus: 'ru', turkish: 'tr', tur: 'tr', indonesian: 'id',
  dutch: 'nl', polish: 'pl', thai: 'th', vietnamese: 'vi',
};

/** A filename-safe language tag: an ISO 639-1 code where one is known. */
export function languageTag(lang: string | undefined): string {
  const word = (lang ?? '').trim().toLowerCase().split(/[\s(_-]/)[0] ?? '';
  if (/^[a-z]{2}$/.test(word)) return word;
  return LANGUAGE_CODES[word] ?? (word.replace(/[^a-z]/g, '').slice(0, 12) || 'und');
}

/** `/d/Movie.mkv` + `en` → `/d/Movie.en.srt`. */
export function companionPath(mediaPath: string, tag: string): string {
  const dot = mediaPath.lastIndexOf('.');
  const slash = Math.max(mediaPath.lastIndexOf('/'), mediaPath.lastIndexOf('\\'));
  const base = dot > slash ? mediaPath.slice(0, dot) : mediaPath;
  return `${base}.${tag}.srt`;
}

/**
 * WebVTT → SubRip. Everything here arrives as VTT (the converter normalises
 * every format to it), and SubRip is what every desktop player reads.
 */
export function vttToSrt(vtt: string): string {
  const blocks = vtt.replace(/\r\n?/g, '\n').split(/\n{2,}/);
  const out: string[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').filter((line) => line.length > 0);
    const timing = lines.findIndex((line) => line.includes('-->'));
    if (timing < 0) continue;
    const [start, end] = lines[timing]
      .split('-->')
      .map((part) => toSrtTime(part.trim().split(/\s+/)[0] ?? ''));
    const text = lines.slice(timing + 1);
    if (!start || !end || text.length === 0) continue;
    out.push(`${out.length + 1}\n${start} --> ${end}\n${text.join('\n')}`);
  }
  return out.length ? `${out.join('\n\n')}\n` : '';
}

function toSrtTime(stamp: string): string | null {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/.exec(stamp);
  if (!m) return null;
  const pad = (n: string, w: number) => n.padStart(w, '0');
  return `${pad(m[1] ?? '0', 2)}:${pad(m[2], 2)}:${pad(m[3], 2)},${m[4].padEnd(3, '0')}`;
}
