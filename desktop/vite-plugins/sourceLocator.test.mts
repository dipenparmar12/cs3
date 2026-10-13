/**
 * The development-only source stamps the UI inspector reads.
 *
 *   node --experimental-strip-types vite-plugins/sourceLocator.test.mts
 *
 * A wrong insertion breaks the module it touches, and a missing one makes the
 * inspector answer "unknown source" — so both directions are pinned here.
 */
import assert from 'node:assert/strict';
import { annotateSource } from './sourceLocator.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

const FILE = 'src/components/Card.tsx';

test('intrinsic elements get their JSX location', () => {
  const out = annotateSource('const x = <div className="a">\n  <span/>\n</div>;', FILE)!;
  assert.match(out, /<div data-cs3-loc="src\/components\/Card\.tsx:1:11" className="a">/);
  assert.match(out, /<span data-cs3-loc="src\/components\/Card\.tsx:2:3"\/>/);
});

test('component elements get the site they were used at', () => {
  const out = annotateSource('const x = <PosterCard item={i} />;', FILE)!;
  assert.match(out, /<PosterCard data-cs3-site="src\/components\/Card\.tsx:1:11" item=\{i\} \/>/);
});

test('React built-ins and member tags are left alone', () => {
  const code = 'const x = <Suspense fallback={null}><Fragment><Ctx.Provider value={1}><>a</></Ctx.Provider></Fragment></Suspense>;';
  assert.equal(annotateSource(code, FILE), null);
});

test('generic components keep their type arguments intact', () => {
  const out = annotateSource('const x = <Select<string> value="a" />;', FILE)!;
  assert.match(out, /<Select<string> data-cs3-site="[^"]+" value="a" \/>/);
});

test('angle brackets that are not JSX are untouched', () => {
  const code = 'const f = <T,>(a: T) => a;\nconst b = 1 < 2;\nconst s = "<div>";';
  assert.equal(annotateSource(code, FILE), null);
});

test('component definitions are stamped; hooks and helpers are not', () => {
  const code = [
    'export const PosterCard: React.FC = () => <div />;',
    'export function Grid() { return null; }',
    'const Memoed = React.memo(() => null);',
    'export function useThing() {}',
    'const helper = () => 1;',
  ].join('\n');
  const out = annotateSource(code, FILE)!;
  assert.match(out, /Object\.defineProperty\(PosterCard,'__cs3Source',\{value:"src\/components\/Card\.tsx:1:14"/);
  assert.match(out, /Object\.defineProperty\(Grid,'__cs3Source',\{value:"src\/components\/Card\.tsx:2:1"/);
  assert.match(out, /Object\.defineProperty\(Memoed,'__cs3Source'/);
  assert.doesNotMatch(out, /useThing,'__cs3Source'/);
  assert.doesNotMatch(out, /helper,'__cs3Source'/);
});

test('no newlines are added inside the module, so line numbers stay exact', () => {
  const code = 'const a = 1;\nconst x = <div>\n<b/>\n</div>;\nconst z = 2;';
  const out = annotateSource(code, FILE)!;
  assert.equal(out.split('\n').length, code.split('\n').length);
  assert.match(out.split('\n')[2], /^<b data-cs3-loc="[^"]+:3:1"\/>$/);
});

test('an element already carrying a stamp is not stamped twice', () => {
  assert.equal(annotateSource('const x = <div data-cs3-loc="kept" />;', FILE), null);
});

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
