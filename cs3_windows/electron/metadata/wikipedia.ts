/**
 * Wikipedia — the "behind the scenes" and trivia the brief asked for.
 *
 * No structured database publishes this. Production history, casting stories,
 * what was shot where and what was changed in post are *prose*, written once by
 * somebody who cared, and for film and television that prose is on Wikipedia.
 * So this source is different in kind from the other three: they answer with
 * facts, this one answers with somebody else's writing.
 *
 * ## The article is never searched for
 *
 * This is the rule that makes the module safe to have. A search for
 * "Dune production" returns an article, and whether it is about the 2021 film,
 * the 1984 film, the novel, or the planet is a *guess* — and a guess that
 * attaches the wrong film's production history to a detail page is data
 * corruption of the worst kind, because every sentence of it is well written
 * and plausible. `cs3/titleEnricher.ts` is deliberately conservative for
 * exactly this reason, and this is the same argument one step further: there is
 * no similarity bar high enough to make searching safe here.
 *
 * So the article arrives as a **Wikidata sitelink** (`schema:about`, in
 * `wikidata.ts`'s facts query) — Wikidata asserting that this article is about
 * this exact entity, which is about this exact IMDb id. No sitelink, no prose.
 * That costs coverage on obscure titles and is the right trade.
 *
 * ## Attribution is structural, not a convention
 *
 * Wikipedia text is CC BY-SA. Reproducing an extract requires crediting the
 * source and naming the licence, and this repository already carries a `LICENSE`
 * and a `THIRD-PARTY-NOTICES.md` because getting this wrong is expensive for a
 * GPL project redistributing community work. An attribution the UI can forget
 * to render is one it will eventually forget to render, so `ProductionNote`
 * makes it a required field and nothing here can construct a note without one.
 *
 * ## Bounded, because an article is not small
 *
 * A featured film article runs to 150 KB of prose. All of it would cross the
 * IPC boundary, sit in the cache, and be rendered into a page nobody scrolls.
 * Each section is cut to {@link MAX_NOTE_CHARS} at a sentence boundary and the
 * note links to the section it came from — which is also what makes the
 * attribution useful rather than decorative.
 */

import { fetchJson } from '../torrent/http.ts';
import { MetadataSource, type ProductionNote } from '../../src/types/metadata.ts';

const TIMEOUT_MS = 12_000;

/** Roughly two paragraphs — enough to be worth reading, short enough to read. */
const MAX_NOTE_CHARS = 1200;

/** Total sections kept, so one enormous article cannot dominate the record. */
const MAX_NOTES = 6;

const LICENCE = 'CC BY-SA 4.0';

/**
 * Headings whose content is about the making of the title.
 *
 * Matched against the heading text, case-insensitively, as a whole word. The
 * list is deliberately about *process* rather than *judgement*: "Reception" and
 * "Box office" are absent because they are opinions and figures that the
 * ratings and facts already carry properly, and reproducing a paragraph of
 * review quotes under "Behind the scenes" would be both wrong and long.
 */
const PRODUCTION_HEADINGS =
  /^(production|development|pre-?production|post-?production|casting|filming|writing|screenplay|music|soundtrack|visual effects|special effects|design|cinematography|editing|animation|behind the scenes|making of)$/i;

/** Headings that are context rather than process — the "trivia" half. */
const TRIVIA_HEADINGS =
  /^(themes?|legacy|trivia|cultural impact|influences?|analysis|interpretations?|accolades|historical accuracy|differences from the (?:book|novel|source))$/i;

interface ExtractPage {
  pageid?: number;
  title?: string;
  extract?: string;
  missing?: boolean;
}

interface ExtractResponse {
  query?: { pages?: ExtractPage[] };
}

export interface WikipediaSection {
  heading: string;
  level: number;
  text: string;
}

/**
 * `https://en.wikipedia.org/wiki/Dune_(2021_film)` → `Dune (2021 film)`.
 *
 * Returns null rather than guessing for anything that is not an article URL on
 * the language edition asked for. The sitelink is trusted; a URL that does not
 * look like one is not.
 */
export function articleTitleFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  const match = url.match(/^https?:\/\/([a-z-]+)\.wikipedia\.org\/wiki\/(.+)$/i);
  if (!match) return null;
  try {
    const title = decodeURIComponent(match[2]).replace(/_/g, ' ').trim();
    return title || null;
  } catch {
    // A malformed percent-escape. Better no prose than prose from a mangled
    // title that happens to resolve to a different article.
    return null;
  }
}

/**
 * A plaintext extract into its sections.
 *
 * `exsectionformat=wiki` keeps the `== Heading ==` markers, which is the only
 * thing in a plaintext extract that marks structure at all — the `plain` format
 * emits bare lines that are indistinguishable from a sentence.
 *
 * The lead paragraphs, before any heading, are returned under the empty
 * heading: they are the summary, and the caller decides whether the page
 * already has a better one from the provider.
 */
export function parseSections(extract: string | undefined): WikipediaSection[] {
  if (!extract) return [];

  const sections: WikipediaSection[] = [];
  // Matches `== Production ==` through `====== Detail ======`, anchored to its
  // own line so a sentence containing `==` cannot open a section.
  const pattern = /^(={2,6})\s*(.+?)\s*\1\s*$/gm;

  let lastIndex = 0;
  let lastHeading = '';
  let lastLevel = 0;
  let match: RegExpExecArray | null;

  const push = (heading: string, level: number, body: string) => {
    const text = body.trim();
    if (!text) return;
    sections.push({ heading, level, text });
  };

  while ((match = pattern.exec(extract)) !== null) {
    push(lastHeading, lastLevel, extract.slice(lastIndex, match.index));
    lastHeading = match[2];
    lastLevel = match[1].length;
    lastIndex = match.index + match[0].length;
  }
  push(lastHeading, lastLevel, extract.slice(lastIndex));

  return sections;
}

/**
 * Cut to a length, at a sentence boundary where one is close enough.
 *
 * Truncating mid-word reads as a corrupted download; truncating mid-sentence
 * reads as a bug. Looking back a quarter of the budget for a full stop costs
 * nothing and is almost always found in prose of this kind. The ellipsis is
 * what tells the reader the "read the rest" link is worth following.
 */
export function truncateAtSentence(text: string, limit = MAX_NOTE_CHARS): string {
  if (text.length <= limit) return text;

  const window = text.slice(0, limit);
  const boundary = Math.max(
    window.lastIndexOf('. '),
    window.lastIndexOf('.\n'),
    window.lastIndexOf('! '),
    window.lastIndexOf('? ')
  );

  if (boundary > limit * 0.75) return `${window.slice(0, boundary + 1)} …`;
  const space = window.lastIndexOf(' ');
  return `${(space > 0 ? window.slice(0, space) : window).trimEnd()} …`;
}

/** A section heading to the anchor Wikipedia gives it. */
function sectionAnchor(heading: string): string {
  return encodeURIComponent(heading.replace(/\s+/g, '_'));
}

export interface WikipediaNotes {
  production: ProductionNote[];
  trivia: ProductionNote[];
  /** The article itself, so the page can offer to open the whole thing. */
  articleUrl: string;
}

/**
 * Sections to attributed notes.
 *
 * Sub-headings are folded into the note for the heading above them by taking
 * the deepest heading's own text: an article with `== Production ==` holding
 * `=== Development ===` and `=== Filming ===` has nothing directly under the
 * parent, so keeping only the parent would produce an empty note for the one
 * section a reader most wants.
 */
export function buildNotes(
  sections: WikipediaSection[],
  articleUrl: string
): WikipediaNotes {
  const production: ProductionNote[] = [];
  const trivia: ProductionNote[] = [];

  for (const section of sections) {
    if (!section.heading) continue;
    const isProduction = PRODUCTION_HEADINGS.test(section.heading);
    const isTrivia = !isProduction && TRIVIA_HEADINGS.test(section.heading);
    if (!isProduction && !isTrivia) continue;
    if (production.length + trivia.length >= MAX_NOTES) break;

    const note: ProductionNote = {
      heading: section.heading,
      text: truncateAtSentence(section.text),
      attribution: {
        source: MetadataSource.Wikipedia,
        url: `${articleUrl}#${sectionAnchor(section.heading)}`,
        licence: LICENCE,
      },
    };

    (isProduction ? production : trivia).push(note);
  }

  return { production, trivia, articleUrl };
}

/**
 * The production and trivia prose for one Wikipedia article.
 *
 * `articleUrl` must come from a Wikidata sitelink. Nothing here searches, and
 * nothing here should be given a URL that was guessed at — see the header.
 */
export async function fetchWikipediaNotes(
  articleUrl: string,
  signal?: AbortSignal
): Promise<WikipediaNotes | null> {
  const title = articleTitleFromUrl(articleUrl);
  if (!title) return null;

  const origin = new URL(articleUrl).origin;
  const url =
    `${origin}/w/api.php?action=query&format=json&formatversion=2` +
    `&prop=extracts&explaintext=1&exsectionformat=wiki&exlimit=1&redirects=1` +
    `&titles=${encodeURIComponent(title)}`;

  const response = await fetchJson<ExtractResponse>(url, {
    signal,
    timeoutMs: TIMEOUT_MS,
    retries: 0,
    // Wikimedia asks automated clients to identify themselves; an unmarked
    // generic browser string is the traffic their operators rate-limit first.
    headers: {
      'User-Agent':
        'CloudStreamDesktop/1.0 (https://github.com/recloudstream/cloudstream; metadata enrichment)',
      'Api-User-Agent':
        'CloudStreamDesktop/1.0 (https://github.com/recloudstream/cloudstream)',
    },
  });

  const page = response.query?.pages?.[0];
  if (!page || page.missing || !page.extract) return null;

  return buildNotes(parseSections(page.extract), articleUrl);
}
