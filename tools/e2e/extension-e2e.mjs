#!/usr/bin/env node
/**
 * Does the ext.to extension actually read ext.to?
 *
 * This exists because of a limitation that has to be stated plainly: the
 * extension and its parser were written in an environment whose egress policy
 * blocks `ext.to` (the proxy answers 403 to CONNECT), so **no selector in
 * `extToParser.ts` has been checked against the live site.** The parser is
 * written to the structure every torrent index shares rather than to that
 * site's class names precisely because of that, and it degrades to "no rows"
 * rather than to a wrong answer — but "degrades safely" is not "verified".
 *
 * Two modes, and the second is the one that matters:
 *
 *   node --experimental-strip-types tools/e2e/extension-e2e.mjs
 *       Requests the search page directly and classifies whatever comes back.
 *       Against a challenged site the expected result is a BOT_CHALLENGE, not
 *       results — and seeing that is itself the confirmation that the detector
 *       is reading the site correctly.
 *
 *   node --experimental-strip-types tools/e2e/extension-e2e.mjs --html page.html
 *       Parses a page saved from a browser that has already been verified.
 *       This is the realistic way to check the selectors, because a plain HTTP
 *       client cannot get a results page out of a site like this by design.
 *       In the app the same page arrives through the verified session; here,
 *       "Save page as" is the equivalent.
 *
 * Options:
 *   --query <text>   Search term (default: dune)
 *   --html <file>    Parse a saved page instead of fetching
 *   --base <url>     Mirror to use (default: https://ext.to)
 *   --show <n>       Rows to print (default: 10)
 *   --raw            Also print the first row's HTML, which is what makes a
 *                    selector mistake visible rather than merely countable.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(path.resolve(HERE, '..', '..'), 'cs3_windows');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

const query = arg('query', 'dune');
const base = arg('base', 'https://ext.to');
const showCount = Number(arg('show', '10'));
const htmlFile = arg('html', null);

const load = (relative) => import(pathToFileURL(path.join(APP, relative)).href);

const { parseSearchResults } = await load('electron/extensions/providers/extToParser.ts');
const { classifyAccess } = await load('electron/access/accessChallenge.ts');

function searchUrl() {
  const params = new URLSearchParams({ q: query, order: 'seeders', sort: 'desc' });
  return `${base}/search/?${params.toString()}`;
}

function report(rows) {
  console.log(`\nParsed ${rows.length} row(s).`);
  for (const row of rows.slice(0, showCount)) {
    const size = row.sizeBytes ? `${(row.sizeBytes / 1e9).toFixed(2)} GB` : 'unknown size';
    const link = row.magnet ? `magnet ${row.infoHash ?? '(no hash)'}` : (row.detailUrl ?? 'no link');
    console.log(`  ${row.seeders.toString().padStart(6)}S ${row.leechers.toString().padStart(5)}L  ${size.padStart(11)}  ${row.title}`);
    console.log(`         ${link}`);
  }

  // The checks that separate "it parsed something" from "it parsed the right
  // thing". Counting rows alone passes happily on a page of navigation links.
  const withHash = rows.filter((r) => r.infoHash || r.magnet).length;
  const withSize = rows.filter((r) => r.sizeBytes > 0).length;
  const withSeeders = rows.filter((r) => r.seeders > 0).length;
  console.log(
    `\n  playable identity: ${withHash}/${rows.length}   size: ${withSize}/${rows.length}   seeders: ${withSeeders}/${rows.length}`
  );

  if (rows.length === 0) return 1;
  if (withHash === 0) {
    console.log('  FAIL — no row yielded a magnet or an infohash. The row selector is matching the wrong elements.');
    return 1;
  }
  if (withSize === 0 || withSeeders === 0) {
    console.log('  PARTIAL — rows were found but the size/seeder columns were not. Check the cell positions.');
    return 2;
  }
  console.log('  PASS');
  return 0;
}

if (htmlFile) {
  const html = fs.readFileSync(htmlFile, 'utf8');
  console.log(`Parsing ${htmlFile} (${(html.length / 1024).toFixed(0)} KB) as ${base}`);
  const rows = parseSearchResults(html, base);
  if (flag('raw') && rows.length === 0) {
    console.log('\nFirst 2 KB of the document, to see what shape it actually is:\n');
    console.log(html.slice(0, 2048));
  }
  process.exit(report(rows));
}

const url = searchUrl();
console.log(`GET ${url}`);

let response;
try {
  response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Upgrade-Insecure-Requests': '1',
    },
    redirect: 'follow',
  });
} catch (error) {
  console.log(`\nThe request did not complete: ${error?.message ?? error}`);
  console.log('If this is an egress policy rather than the site, that is the environment, not the extension.');
  process.exit(1);
}

const body = await response.text();
const headers = {};
response.headers.forEach((value, key) => {
  headers[key] = value;
});

const challenge = classifyAccess({
  url,
  status: response.status,
  headers,
  contentType: response.headers.get('content-type') ?? '',
  body: body.slice(0, 128 * 1024),
});

console.log(`\nHTTP ${response.status}  ${response.headers.get('content-type') ?? ''}`);
console.log(`Classified as: ${challenge.type}${challenge.system ? ` (${challenge.system})` : ''}`);
if (challenge.reason) console.log(`  ${challenge.reason}`);
console.log(
  `  canResume=${challenge.canResume}  requiresUserInteraction=${challenge.requiresUserInteraction}`
);

if (challenge.type !== 'NONE') {
  console.log(
    '\nThis is the expected answer for a challenged site from a plain HTTP client, and it is what\n' +
      'the app turns into a Verify button. To check the parser, open the site in a browser, complete\n' +
      'the check, save the results page, and re-run with --html <file>.'
  );
  process.exit(0);
}

process.exit(report(parseSearchResults(body, base)));
