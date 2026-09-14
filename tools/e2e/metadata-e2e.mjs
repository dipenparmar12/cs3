/**
 * The metadata coverage harness: do the keyless catalogues actually answer?
 *
 *   node --experimental-strip-types tools/e2e/metadata-e2e.mjs
 *   node --experimental-strip-types tools/e2e/metadata-e2e.mjs --only wikidata
 *   node --experimental-strip-types tools/e2e/metadata-e2e.mjs --title tt1160419
 *   node --experimental-strip-types tools/e2e/metadata-e2e.mjs --json report.json
 *
 * ## Why this exists rather than a unit test
 *
 * `electron/metadata/` was written in a container whose egress proxy denies
 * every third-party host, so **not one line of it was measured against a live
 * API** — which is the opposite of how every other adapter in this repository
 * was built, and the module headers say so rather than implying otherwise. The
 * parsers are pure and pinned by `bun run test metadata`; what could not be
 * checked is the half that lives on someone else's server: whether the SPARQL
 * parses, whether the properties are the right ones, whether the shape coming
 * back is the shape the parser expects.
 *
 * This is that check, and it is the one that can only be run by a person on an
 * ordinary network.
 *
 * Like `native-engine-matrix.mjs`, it imports the **shipping adapters** rather
 * than reimplementing the requests. A harness with its own copy of the query
 * agrees with the product right up until the moment it matters — and for a
 * query this is most of the risk, since a wrong property name fails silently as
 * an empty result rather than as an error.
 *
 * ## What a pass means
 *
 * Exit 0 requires that at least one source returned **cast with characters** —
 * not merely that a request succeeded. An empty 200 from Wikidata and a
 * correctly-parsed cast list are indistinguishable at the transport layer, and
 * the empty one is exactly what a mistyped property produces.
 *
 * The fixtures are three titles chosen to exercise the three routing paths, not
 * because they are interesting: a film (Wikidata + Cinemeta), a series (TVmaze),
 * and an anime (AniList, with two scripts and voice actors).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { parseCredits, parseFacts, fetchWikidata } from '../../cs3_windows/electron/metadata/wikidata.ts';
import { fetchCredits as fetchTvMaze, lookupByImdb } from '../../cs3_windows/electron/metadata/tvmaze.ts';
import { fetchAniListCredits } from '../../cs3_windows/electron/metadata/anilist.ts';
import { fetchWikipediaNotes } from '../../cs3_windows/electron/metadata/wikipedia.ts';
import { parseCinemetaExtras } from '../../cs3_windows/electron/metadata/cinemetaExtras.ts';
import { mergeCredits, orderCredits } from '../../cs3_windows/electron/metadata/merge.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

/** Three titles, one per routing path. Stable, popular, and well covered. */
const FIXTURES = [
  { label: 'film', imdb: 'tt1160419', anilist: null, name: 'Dune (2021)' },
  { label: 'series', imdb: 'tt0903747', anilist: null, name: 'Breaking Bad' },
  { label: 'anime', imdb: null, anilist: 21, name: 'One Piece' },
];

const SOURCES = ['cinemeta', 'wikidata', 'tvmaze', 'anilist', 'wikipedia'];

function parseArgs(argv) {
  const args = { only: null, title: null, json: null };
  for (let i = 2; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--only') args.only = argv[++i]?.split(',').map((s) => s.trim().toLowerCase());
    else if (flag === '--title') args.title = argv[++i];
    else if (flag === '--json') args.json = argv[++i];
    else if (flag === '--help' || flag === '-h') args.help = true;
  }
  return args;
}

const c = process.stdout.isTTY
  ? { dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', bold: '\x1b[1m', reset: '\x1b[0m' }
  : { dim: '', red: '', green: '', yellow: '', bold: '', reset: '' };

const ok = (s) => `${c.green}${s}${c.reset}`;
const warn = (s) => `${c.yellow}${s}${c.reset}`;
const bad = (s) => `${c.red}${s}${c.reset}`;

/** Runs one source, timed, and never throws — a failure is a row, not an exit. */
async function attempt(name, run) {
  const startedAt = Date.now();
  try {
    const value = await run();
    return { source: name, status: 'ok', ms: Date.now() - startedAt, value };
  } catch (error) {
    return {
      source: name,
      status: 'failed',
      ms: Date.now() - startedAt,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/** The numbers that actually say whether a source did its job. */
function describeCredits(credits) {
  const cast = credits.filter((p) => p.role === 'cast' || p.role === 'voice');
  return {
    total: credits.length,
    cast: cast.length,
    withCharacter: cast.filter((p) => p.character).length,
    withImage: credits.filter((p) => p.imageUrl).length,
    withNativeName: credits.filter((p) => p.originalName).length,
    crew: credits.filter((p) => p.role === 'crew').length,
  };
}

async function runFixture(fixture, only) {
  const wanted = (name) => !only || only.includes(name);
  const results = {};
  const allCredits = [];

  console.log(`\n${c.bold}${fixture.name}${c.reset} ${c.dim}(${fixture.label}, ${fixture.imdb ?? `anilist:${fixture.anilist}`})${c.reset}`);

  if (fixture.imdb && wanted('cinemeta')) {
    const r = await attempt('cinemeta', async () => {
      const type = fixture.label === 'series' ? 'series' : 'movie';
      const res = await fetch(`https://v3-cinemeta.strem.io/meta/${type}/${fixture.imdb}.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      return parseCinemetaExtras(body?.meta);
    });
    results.cinemeta = r;
    if (r.value) allCredits.push(r.value.people);
    report('cinemeta', r, r.value && describeCredits(r.value.people), r.value && {
      released: r.value.releaseDate,
      ratings: r.value.ratings.length,
      awards: r.value.awards.length,
    });
  }

  let wikipediaUrl = null;
  if (fixture.imdb && wanted('wikidata')) {
    const r = await attempt('wikidata', () => fetchWikidata(fixture.imdb));
    results.wikidata = r;
    if (r.value) {
      allCredits.push(r.value.credits);
      wikipediaUrl = r.value.facts?.wikipediaUrl ?? null;
    }
    report('wikidata', r, r.value && describeCredits(r.value.credits), r.value && {
      entity: r.value.facts?.entity,
      released: r.value.facts?.releaseDate,
      revenue: r.value.facts?.revenue,
      article: wikipediaUrl ? 'yes' : 'no',
    });
  }

  if (fixture.imdb && wanted('tvmaze')) {
    const r = await attempt('tvmaze', async () => {
      // A null here now means a real 404 and nothing else — `lookupByImdb` used
      // to swallow every error into one, which is what made this harness report
      // Breaking Bad as "not a TVmaze title" while the host was answering 403.
      const id = await lookupByImdb(fixture.imdb);
      if (!id) return { notInCatalogue: true, credits: [] };
      return { id, credits: await fetchTvMaze(id) };
    });
    results.tvmaze = r;
    if (r.value?.credits) allCredits.push(r.value.credits);
    report(
      'tvmaze',
      r,
      r.value?.credits && describeCredits(r.value.credits),
      r.value?.notInCatalogue ? { note: 'not in the TVmaze catalogue (expected for a film)' } : { id: r.value?.id }
    );
  }

  if (fixture.anilist && wanted('anilist')) {
    const r = await attempt('anilist', () => fetchAniListCredits(fixture.anilist));
    results.anilist = r;
    if (r.value) allCredits.push(r.value.people);
    report('anilist', r, r.value && describeCredits(r.value.people), r.value && {
      studios: r.value.studios.length,
      keywords: r.value.keywords.length,
      released: r.value.releaseDate,
    });
  }

  if (wikipediaUrl && wanted('wikipedia')) {
    const r = await attempt('wikipedia', () => fetchWikipediaNotes(wikipediaUrl));
    results.wikipedia = r;
    report('wikipedia', r, null, r.value && {
      production: r.value.production.length,
      trivia: r.value.trivia.length,
      firstHeading: r.value.production[0]?.heading ?? r.value.trivia[0]?.heading ?? '—',
    });
  }

  // The merge is the product's own, so a duplicate here is a duplicate on
  // screen — which is the failure this harness is best placed to catch, since
  // it is the only place several real sources meet.
  const merged = orderCredits(mergeCredits(allCredits));
  const stats = describeCredits(merged);
  console.log(
    `  ${c.dim}merged${c.reset}     ${stats.total} credits · ${stats.cast} cast ` +
      `(${stats.withCharacter} with a character, ${stats.withImage} with a photo, ` +
      `${stats.withNativeName} with a native name) · ${stats.crew} crew`
  );

  const sample = merged.filter((p) => p.role !== 'crew').slice(0, 5);
  for (const person of sample) {
    const native = person.originalName ? ` ${c.dim}(${person.originalName})${c.reset}` : '';
    const role = person.character ? ` as ${person.character}` : '';
    const photo = person.imageUrl ? '' : ` ${c.dim}[no photo]${c.reset}`;
    console.log(`    · ${person.name}${native}${role}${photo}`);
  }

  return { fixture, results, merged: stats };
}

function report(name, result, credits, extra) {
  const label = name.padEnd(10);
  if (result.status === 'failed') {
    console.log(`  ${label} ${bad('FAIL')} ${result.ms}ms ${c.dim}${result.reason}${c.reset}`);
    return;
  }
  const counts = credits
    ? `${credits.total} credits, ${credits.withCharacter} characters, ${credits.withImage} photos`
    : '';
  const tail = extra
    ? Object.entries(extra)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ')
    : '';
  const empty = credits && credits.total === 0 && !tail;
  const status = empty ? warn('EMPTY') : ok('OK');
  console.log(`  ${label} ${status} ${String(result.ms).padStart(5)}ms  ${counts} ${c.dim}${tail}${c.reset}`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
    return 0;
  }

  const fixtures = args.title
    ? [{ label: 'custom', imdb: args.title.startsWith('tt') ? args.title : null, anilist: args.title.startsWith('tt') ? null : Number(args.title), name: args.title }]
    : FIXTURES;

  console.log(`${c.bold}Extended metadata — live coverage${c.reset}`);
  console.log(`${c.dim}Keyless sources: ${SOURCES.join(', ')}${c.reset}`);

  const runs = [];
  for (const fixture of fixtures) {
    runs.push(await runFixture(fixture, args.only));
  }

  // The gate: a request that succeeded proves nothing, because a mistyped
  // SPARQL property returns a clean, empty 200.
  const withCharacters = runs.filter((run) => run.merged.withCharacter > 0);
  const anyFailed = runs.some((run) =>
    Object.values(run.results).some((r) => r.status === 'failed')
  );

  console.log('');
  if (withCharacters.length === 0) {
    console.log(bad('FAIL — no source returned a cast list with characters.'));
    console.log(
      `${c.dim}That is what a wrong SPARQL property or a changed response shape looks like: a clean 200 with nothing in it.${c.reset}`
    );
    return 1;
  }

  console.log(
    ok(`PASS — ${withCharacters.length}/${runs.length} titles resolved a cast list with characters.`)
  );
  if (anyFailed) {
    console.log(warn('Some sources failed; see the rows above. A single failing host is not fatal by design.'));
  }

  if (args.json) {
    const out = path.resolve(repoRoot, args.json);
    fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), runs }, null, 2));
    console.log(`${c.dim}Report written to ${out}${c.reset}`);
  }

  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(bad('Harness error:'), error);
    process.exit(2);
  });
