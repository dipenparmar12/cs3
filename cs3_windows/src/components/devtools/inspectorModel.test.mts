/**
 * The UI inspector's reading of React's fiber tree, and the report it copies.
 *
 *   node --experimental-strip-types src/components/devtools/inspectorModel.test.mts
 *
 * Fake fibers, because every wrong answer here sends someone to the wrong
 * file: the nearest *application* component must win over library wrappers,
 * memo/forwardRef must unwrap to their real name and source, and the copied
 * report must lead with the component and its location.
 */
import assert from 'node:assert/strict';
import {
  FiberTag,
  componentPath,
  componentState,
  formatForAgent,
  parseLocation,
  preview,
  shortLocation,
  type Fiber,
  type Inspection,
} from './inspectorModel.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

function fn(name: string, source?: string): unknown {
  const f = function () {};
  Object.defineProperty(f, 'name', { value: name });
  if (source) Object.defineProperty(f, '__cs3Source', { value: source });
  return f;
}

function fiber(tag: number, type: unknown, props: Record<string, unknown> = {}, parent: Fiber | null = null): Fiber {
  return { tag, type, return: parent, child: null, sibling: null, memoizedProps: props, memoizedState: null };
}

test('the path runs root first and keeps only component fibers', () => {
  const app = fiber(FiberTag.FunctionComponent, fn('App', 'src/App.tsx:10:1'));
  const host = fiber(FiberTag.HostComponent, 'div', {}, app);
  const card = fiber(FiberTag.FunctionComponent, fn('PosterCard', 'src/components/PosterCard.tsx:65:14'), { 'data-cs3-site': 'src/views/SearchView.tsx:564:11', title: 'Mean Girls' }, host);
  const button = fiber(FiberTag.HostComponent, 'button', {}, card);
  const path = componentPath(button);
  assert.deepEqual(path.map((entry) => entry.name), ['App', 'PosterCard']);
  assert.equal(path[1].renderedAt, 'src/views/SearchView.tsx:564:11');
  assert.equal(path[1].definedAt, 'src/components/PosterCard.tsx:65:14');
  assert.deepEqual(path[1].props, { title: 'Mean Girls' }, 'stamps and children are not props worth showing');
});

test('memo and forwardRef unwrap to the real component and its source', () => {
  const inner = fn('ProgressBar', 'src/components/ProgressBar.tsx:4:1');
  const memoed = { $$typeof: Symbol.for('react.memo'), type: { $$typeof: Symbol.for('react.forward_ref'), render: inner } };
  const path = componentPath(fiber(FiberTag.MemoComponent, memoed));
  assert.equal(path[0].name, 'ProgressBar');
  assert.equal(path[0].definedAt, 'src/components/ProgressBar.tsx:4:1');
  assert.equal(path[0].kind, 'app');
});

test('components without a source stamp are library code; wrappers are framework', () => {
  const path = componentPath(
    fiber(FiberTag.FunctionComponent, fn('LucideIcon'), {}, fiber(FiberTag.ClassComponent, fn('ErrorBoundary', 'src/components/ErrorBoundary.tsx:1:1')))
  );
  assert.deepEqual(path.map((entry) => entry.kind), ['framework', 'library']);
});

test('state reads useState hooks only, in order', () => {
  const component = fiber(FiberTag.FunctionComponent, fn('X'));
  component.memoizedState = {
    memoizedState: 42,
    queue: { dispatch() {} },
    next: { memoizedState: { current: null }, queue: null, next: { memoizedState: 'open', queue: { dispatch() {} }, next: null } },
  };
  assert.deepEqual(componentState(component), [42, 'open']);
});

test('values preview as one short line', () => {
  assert.equal(preview('Mean Girls'), '"Mean Girls"');
  assert.equal(preview(42), '42');
  assert.equal(preview(function onPlay() {}), 'ƒ onPlay()');
  assert.equal(preview([1, 2, 3, 4, 5]), '[1, 2, 3, … 2 more]');
  assert.equal(preview({ a: 1, b: { c: 2 } }), '{ a: 1, b: {…1} }');
});

test('locations parse and shorten', () => {
  assert.deepEqual(parseLocation('src/views/X.tsx:12:5'), { file: 'src/views/X.tsx', line: 12, column: 5 });
  assert.equal(shortLocation('src/views/X.tsx:12:5'), 'src/views/X.tsx:12');
  assert.equal(parseLocation(undefined), null);
});

test('the copied report leads with the component, its source and its nesting', () => {
  const home = fiber(FiberTag.FunctionComponent, fn('Home', 'src/views/HomeView.tsx:80:1'));
  const card = fiber(FiberTag.FunctionComponent, fn('PosterCard', 'src/components/PosterCard.tsx:65:14'), { title: 'Mean Girls', onPlayDirectly: function handleQuickPlay() {}, 'data-cs3-site': 'src/views/HomeView.tsx:533:15' }, home);
  const hierarchy = componentPath(card);
  const inspection: Inspection = {
    element: {
      tag: 'button',
      classes: ['play-button-overlay'],
      writtenAt: 'src/components/PosterCard.tsx:209:11',
      attributes: [['aria-label', 'Play Mean Girls']],
      handlers: [{ name: 'onClick', on: 'button.play-button-overlay', at: 'src/components/PosterCard.tsx:209:11', depth: 0 }],
      size: { width: 34, height: 34 },
    },
    hierarchy,
    responsible: hierarchy[1],
  };
  const text = formatForAgent(inspection, undefined);
  const lines = text.split('\n');
  assert.equal(lines[0], 'UI Component:');
  assert.equal(lines[1], '  PosterCard');
  assert.match(text, /defined {3}src\/components\/PosterCard\.tsx:65:14/);
  assert.match(text, /rendered {2}src\/views\/HomeView\.tsx:533:15/);
  assert.match(text, /element {3}src\/components\/PosterCard\.tsx:209:11/);
  assert.match(text, /\n {2}Home {2}\(src\/views\/HomeView\.tsx:80\)\n {4}PosterCard {2}\(src\/components\/PosterCard\.tsx:65\) {2}← selected/);
  assert.match(text, /title: "Mean Girls"/);
  assert.match(text, /onClick on <button\.play-button-overlay>/);
  assert.match(text, /onPlayDirectly \(prop of PosterCard\)/);
});

test('without stamps the report says how to get them instead of inventing a location', () => {
  const inspection: Inspection = {
    element: { tag: 'div', classes: [], attributes: [], handlers: [], size: { width: 1, height: 1 } },
    hierarchy: [],
  };
  assert.match(formatForAgent(inspection, undefined), /no source location — run the app with `bun run dev`/);
});

let failed = 0;
for (const [name, run] of tests) {
  try {
    run();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL ${name}`);
    console.log(`       ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(failed === 0 ? `\n${tests.length} passed` : `\n${failed} of ${tests.length} FAILED`);
process.exit(failed === 0 ? 0 : 1);
