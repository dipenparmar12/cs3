/**
 * Every description of a title the catalogues already sent, as alternatives.
 *
 * The provider's own synopsis is often the weakest text on the page — a site
 * blurb, a release note, or a paragraph in another language — while Cinemeta's
 * `description` and TVmaze's `summary` sit in replies the app has already paid
 * for and used to drop. They are offered beside the provider's text, never in
 * place of it: the provider's page is about the release the viewer is about to
 * play, and a regional cut can differ from the catalogue's work.
 *
 * Matching is inherited, not attempted here: each text arrives from a record
 * the enrichment service resolved by id (IMDb, TVmaze, AniList), so a plot is
 * only as right as the match that fetched it, and nothing here searches by name.
 *
 * Pure, so the rules below are tested rather than eyeballed.
 */

import type { MetadataSource, TitlePlot } from '../../src/types/metadata.ts';

/** Below this a "plot" is a tagline or a placeholder ("N/A", "Coming soon"). */
const MIN_PLOT_LENGTH = 40;

/**
 * HTML to plain prose. TVmaze sends `<p><b>Breaking Bad</b> follows…</p>`;
 * AniList sends `<br>` and `<i>`. Paragraph breaks are kept as a blank line.
 */
export function cleanPlot(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const text = raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text || undefined;
}

/** Letters and digits only, lower-cased — what two copies of one text share. */
function fingerprint(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * The distinct plots, in the order given (which is precedence).
 *
 * A text that is a copy of one already kept — the same words with different
 * punctuation, or a truncation of it ("…" cut at 200 characters, as several
 * catalogues do) — is the same plot and is dropped, keeping the **longer** text
 * (with its own source) in the earlier one's place. Two genuinely different descriptions both stay;
 * choosing between them is the viewer's call, not this function's.
 */
export function collectPlots(
  candidates: Array<{ source: MetadataSource; text: string | null | undefined }>
): TitlePlot[] {
  const kept: Array<TitlePlot & { print: string }> = [];
  for (const candidate of candidates) {
    const text = cleanPlot(candidate.text);
    if (!text || text.length < MIN_PLOT_LENGTH) continue;
    const print = fingerprint(text.replace(/(\.\.\.|…)$/, ''));
    if (!print) continue;
    const same = kept.find((entry) => entry.print.startsWith(print) || print.startsWith(entry.print));
    if (same) {
      if (print.length > same.print.length) {
        // The text moves, so its attribution moves with it.
        same.source = candidate.source;
        same.text = text;
        same.print = print;
      }
      continue;
    }
    kept.push({ source: candidate.source, text, print });
  }
  return kept.map(({ source, text }) => ({ source, text }));
}
