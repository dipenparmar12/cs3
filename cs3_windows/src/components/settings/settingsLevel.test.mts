/**
 * The settings-level rule, and the over-marking it is easy to fall into.
 *
 *   bun run test:settings-level
 *   node --experimental-strip-types src/components/settings/settingsLevel.test.mts
 *
 * Two different failures, and the second is the one that actually happens.
 *
 * The rule itself is three lines and its only interesting property is the
 * *default*: a row nobody has classified is basic. Getting that backwards would
 * make Simple mode quietly lose every setting added from now on, and nothing
 * would report it — the screen would just be a little shorter each release.
 *
 * The second is over-marking. Marking rows `advanced` is satisfying and there
 * is no feedback when it goes too far: a tab whose every row is advanced
 * renders as a heading with nothing under it, or as nothing at all, and reads
 * as the settings having failed to load. So each settings source is required to
 * keep more basic rows than advanced ones — a blunt rule, deliberately, because
 * the precise one ("is this tab still useful?") is a judgement no test can make
 * and a ratio at least fails loudly when someone marks the lot.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shouldShow } from './settingsLevel.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, '..', '..');

// --- the rule ---------------------------------------------------------------

test('Everything shows everything', () => {
  assert.equal(shouldShow('everything', 'basic'), true);
  assert.equal(shouldShow('everything', 'advanced'), true);
  assert.equal(shouldShow('everything'), true);
});

test('Simple hides advanced and nothing else', () => {
  assert.equal(shouldShow('simple', 'basic'), true);
  assert.equal(shouldShow('simple', 'advanced'), false);
});

test('an unclassified row is basic', () => {
  /**
   * The load-bearing default. Backwards, Simple mode silently loses every
   * setting added from here on and the screen just gets shorter each release
   * with nothing reporting it.
   */
  assert.equal(shouldShow('simple'), true);
  assert.equal(shouldShow('simple', undefined), true);
});

// --- over-marking -----------------------------------------------------------

/** Every file that renders setting rows. */
const SETTINGS_SOURCES = [
  'views/SettingsView.tsx',
  'components/PlayerSettings.tsx',
  'components/settings/HomeSettings.tsx',
  'components/settings/SubtitleSettings.tsx',
];

test('no settings screen is entirely advanced', () => {
  for (const relative of SETTINGS_SOURCES) {
    const source = fs.readFileSync(path.join(srcRoot, relative), 'utf8');
    const rows = [...source.matchAll(/<SettingRow\b/g)].length;
    const advanced = [...source.matchAll(/level="advanced"/g)].length;
    if (rows === 0) continue;
    assert.ok(
      advanced < rows,
      `${relative}: ${advanced} of ${rows} rows are advanced, so Simple mode has nothing to show.`
    );
  }
});

/**
 * Attribute regions of every `<SettingRow>` / `<SettingGroup>` opening tag.
 *
 * A real scanner rather than "the nearest `<` before the match", which the
 * first version of this test used and which was wrong the moment an attribute
 * followed a JSX expression: in
 * `<SettingGroup icon={<RefreshCw />} level="advanced">` the nearest preceding
 * `<` is the icon. Tracking brace depth and stopping at the first `>` outside
 * braces is only a few lines and is actually correct.
 */
function settingTagRegions(source: string): Array<{ tag: string; start: number; end: number }> {
  const regions: Array<{ tag: string; start: number; end: number }> = [];
  for (const match of source.matchAll(/<(SettingRow|SettingGroup)\b/g)) {
    const start = match.index ?? 0;
    let depth = 0;
    let i = start + match[0].length;
    for (; i < source.length; i++) {
      const ch = source[i];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      else if (ch === '>' && depth === 0) break;
    }
    regions.push({ tag: match[1], start, end: i });
  }
  return regions;
}

test('the majority of rows stay basic', () => {
  // The blunt version of "is this still useful in Simple?". A test cannot make
  // that judgement, but it can refuse the case where somebody marked the lot.
  //
  // Counted per element kind: a marked *group* is not a marked row, and mixing
  // them made the first version of this test report seven advanced rows in a
  // file that has five.
  for (const relative of SETTINGS_SOURCES) {
    const source = fs.readFileSync(path.join(srcRoot, relative), 'utf8');
    const regions = settingTagRegions(source);
    const rows = regions.filter((r) => r.tag === 'SettingRow');
    if (rows.length === 0) continue;
    const advancedRows = rows.filter((r) =>
      source.slice(r.start, r.end).includes('level="advanced"')
    ).length;
    assert.ok(
      advancedRows <= rows.length / 2,
      `${relative}: ${advancedRows} of ${rows.length} rows are advanced — over half, which makes ` +
        'Simple mode a worse screen than no filter at all.'
    );
  }
});

test('every advanced marking sits on a row or a group', () => {
  // A stray `level="advanced"` on some other element does nothing at all and
  // would look, in a diff, exactly like a working one.
  for (const relative of SETTINGS_SOURCES) {
    const source = fs.readFileSync(path.join(srcRoot, relative), 'utf8');
    const regions = settingTagRegions(source);
    for (const match of source.matchAll(/level="advanced"/g)) {
      const at = match.index ?? 0;
      assert.ok(
        regions.some((region) => at > region.start && at < region.end),
        `${relative}: level="advanced" at offset ${at} is not inside a ` +
          '<SettingRow> or <SettingGroup> opening tag, so it does nothing.'
      );
    }
  }
});

// --- runner ----------------------------------------------------------------

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL ${name}`);
    console.log(`       ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(failed === 0 ? `\n${tests.length} passed` : `\n${failed} of ${tests.length} FAILED`);
process.exit(failed === 0 ? 0 : 1);
