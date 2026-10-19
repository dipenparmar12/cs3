#!/usr/bin/env node
/**
 * Checks a release directory holds the whole release before anything is
 * published: every artifact of every target, by its release name, non-empty,
 * plus the SBOM and one signing record per target.
 *
 *   node tools/package/verify-release.mjs <dir> <version>
 *
 * The publish job downloads what the build jobs uploaded and runs this first.
 * `needs:` already stops the job when a build failed; this catches the build
 * that succeeded and uploaded less than it should have — a renamed artifact,
 * a target electron-builder skipped — which would otherwise become a release
 * missing one platform's download with nothing saying so.
 */
import fs from 'node:fs';
import path from 'node:path';
import { OS_LABEL, RELEASE_TARGETS, expectedArtifacts } from './package-layout.mjs';

const [dir, version] = process.argv.slice(2);
if (!dir || !version) {
  console.error('usage: verify-release.mjs <dir> <version>');
  process.exit(2);
}

const present = new Set(fs.existsSync(dir) ? fs.readdirSync(dir) : []);
const expected = [
  ...RELEASE_TARGETS.flatMap(([platform, arch]) => expectedArtifacts(version, platform, arch)),
  'CS3-sbom.cdx.json',
  ...RELEASE_TARGETS.map(([platform, arch]) => `SIGNING-${OS_LABEL[platform]}-${arch}.txt`),
];

const missing = expected.filter((name) => !present.has(name) || fs.statSync(path.join(dir, name)).size === 0);
// Anything named like a release file but not expected is a naming drift: the
// expected one is then usually what is missing.
const unexpected = [...present].filter((name) => name.startsWith('CS3-') && !expected.includes(name));

if (missing.length > 0) {
  console.error(`The release for ${version} is incomplete; nothing will be published. Missing or empty:`);
  for (const name of missing) console.error(`  - ${name}`);
  if (unexpected.length > 0) console.error(`Present but not expected (a renamed artifact?): ${unexpected.join(', ')}`);
  process.exit(1);
}
if (unexpected.length > 0) console.warn(`Also present, not expected: ${unexpected.join(', ')}`);
console.log(`OK — ${expected.length} files for ${RELEASE_TARGETS.length} targets.`);
