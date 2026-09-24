/**
 * A provider's file name, tidied into what a person would call the title.
 *
 * Providers name results after the file — `Avengers End Game 720p Hindi
 * Dubbed`, `Avengers.Endgame.2019.1080p.BluRay.x264-GROUP` — and when the
 * catalogue lookup cannot match one confidently the grid showed that string as
 * the title. This is the fallback that keeps it readable, and the query the
 * app asks *other* providers with when it widens a search: thirty sites asked
 * for "Avengers End Game 720p Hindi Dubbed" mostly answer with nothing.
 *
 * ## Strict, because a display title that is wrong reads as corruption
 *
 * `parseReleaseTitle` in `titleEnricher.ts` is written for *matching*, and it
 * cuts at words like "proper", "extended" and "uncut" — right for a search
 * query that is about to be scored, wrong for a label: "A Proper Violence"
 * would read "A". This cuts only at tokens that never occur in a real title —
 * resolutions, codecs, sources, audio formats — so anything it is unsure of is
 * left alone. A release group after a dash goes because it comes after the
 * cut, never on its own: "Spider-Man" is a title, not a group.
 *
 * Pure, and imported by both processes.
 */

/** Tokens that mark the end of a title and the start of file metadata. */
const TECHNICAL =
  /\b(?:2160p|1080p|720p|576p|480p|360p|4k|x264|x265|h\.?264|h\.?265|hevc|10bit|8bit|web-?dl|web-?rip|hdrip|blu-?ray|bdrip|brrip|dvdrip|hdtv|hdcam|camrip|dd\+?5\.?1|ddp5\.?1|aac2?\.?0?|ac3|eac3|dts-hd|truehd|hdr10\+?|esubs?|msubs?|dual[ .-]audio|multi[ .-]audio|hindi[ .-]dubbed|s\d{1,2}(?:e\d{1,3})?|season[ .]\d{1,2})\b/i;

const YEAR = /\b(19\d{2}|20\d{2})\b/g;

export interface TidiedName {
  title: string;
  year?: number;
  /** Whether anything was removed — the caller keeps the original when not. */
  changed: boolean;
}

export function tidyReleaseName(raw: string): TidiedName {
  const original = (raw ?? '').trim();
  if (!original) return { title: original, changed: false };

  // Scene names use dots or underscores for spaces; a real title with spaces
  // in it keeps its punctuation ("Mr. Robot", "No. 1").
  let working = /\s/.test(original) ? original : original.replace(/[._]+/g, ' ');

  // Bracketed groups that describe the file: [Dual Audio], [Org DD5.1], (2019).
  let bracketYear: number | undefined;
  working = working.replace(/[[({]([^\])}]*)[\])}]/g, (group, inner: string) => {
    const year = /^\s*(19\d{2}|20\d{2})\s*$/.exec(inner);
    if (year) {
      bracketYear = Number(year[1]);
      return ' ';
    }
    return TECHNICAL.test(inner) || /\b(?:org|audio|subs?|dubbed)\b/i.test(inner) ? ' ' : group;
  });

  const cut = working.search(TECHNICAL);
  if (cut >= 0) working = working.slice(0, cut);

  // The year is the last plausible one with a title in front of it, so
  // "Blade Runner 2049 2017" keeps its title and "2012" stays a film.
  const nextYear = new Date().getFullYear() + 1;
  let year = bracketYear;
  if (year === undefined) {
    const matches = [...working.matchAll(YEAR)];
    for (let index = matches.length - 1; index >= 0; index--) {
      const match = matches[index];
      const value = Number(match[1]);
      const before = working.slice(0, match.index).trim();
      if (value >= 1900 && value <= nextYear && before.length > 0) {
        year = value;
        working = `${before} ${working.slice((match.index ?? 0) + match[0].length)}`;
        break;
      }
    }
  }

  const title = working
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s\-–:,.]+$/g, '')
    .trim();

  if (title.length < 2) return { title: original, changed: false };
  return { title, year, changed: title !== original };
}
