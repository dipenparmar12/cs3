/**
 * What the UI inspector knows about a piece of the screen — read from React's
 * fiber tree and the development source stamps (`vite-plugins/sourceLocator.ts`).
 *
 * Pure apart from reading the objects it is handed, so it is tested with fake
 * fibers: every wrong answer here sends a developer (or an AI agent) to the
 * wrong file, which is the one thing this tool exists to prevent.
 *
 * ## The fiber fields read, and why each is safe enough
 *
 * React does not publish its fiber shape. These are the fields every React
 * devtool reads and that React 19 still has: `tag`, `type`, `return`, `child`,
 * `sibling`, `memoizedProps`, `memoizedState`, `stateNode`, `_debugOwner`.
 * Anything missing degrades to "unknown" rather than throwing.
 */

export interface Fiber {
  tag: number;
  type: unknown;
  return: Fiber | null;
  child: Fiber | null;
  sibling: Fiber | null;
  memoizedProps?: Record<string, unknown> | null;
  memoizedState?: unknown;
  stateNode?: unknown;
  _debugOwner?: Fiber | null;
}

/** React's work tags — the ones this file distinguishes. */
export const FiberTag = {
  FunctionComponent: 0,
  ClassComponent: 1,
  HostRoot: 3,
  HostComponent: 5,
  HostText: 6,
  Fragment: 7,
  ContextProvider: 10,
  ForwardRef: 11,
  MemoComponent: 14,
  SimpleMemoComponent: 15,
  HostHoistable: 26,
  HostSingleton: 27,
} as const;

const COMPONENT_TAGS = new Set<number>([
  FiberTag.FunctionComponent,
  FiberTag.ClassComponent,
  FiberTag.ForwardRef,
  FiberTag.MemoComponent,
  FiberTag.SimpleMemoComponent,
]);
const HOST_TAGS = new Set<number>([FiberTag.HostComponent, FiberTag.HostHoistable, FiberTag.HostSingleton]);

export type ComponentKind = 'app' | 'library' | 'framework';

export interface ComponentInfo {
  name: string;
  kind: ComponentKind;
  /** Where the component is defined — `src/…/File.tsx:line:col`. */
  definedAt?: string;
  /** Where this instance was rendered from — the parent's JSX. */
  renderedAt?: string;
  props: Record<string, unknown>;
  /** `useState`/`useReducer` values, in hook order. */
  state: unknown[];
  fiber: Fiber;
}

export interface ElementInfo {
  tag: string;
  id?: string;
  classes: string[];
  /** Where this element's JSX is — the most precise location there is. */
  writtenAt?: string;
  attributes: Array<[string, string]>;
  /**
   * Event handlers on the element and the few ancestors around it. A click on
   * a button's label lands on a `<span>` with no handler of its own; the one
   * that runs is on the `<button>` two levels up, and that is the one asked about.
   */
  handlers: HandlerInfo[];
  text?: string;
  size: { width: number; height: number };
}

export interface HandlerInfo {
  name: string;
  /** The element carrying it: `button.play-button-overlay`. */
  on: string;
  /** That element's JSX location, when stamped. */
  at?: string;
  /** Levels above the inspected element (0 = the element itself). */
  depth: number;
}

export interface Inspection {
  element: ElementInfo;
  /** Root first, the nearest component last. */
  hierarchy: ComponentInfo[];
  /** The nearest application component — "the component responsible". */
  responsible?: ComponentInfo;
  /** The component whose render produced the element (its JSX owner). */
  owner?: ComponentInfo;
}

/** Wrappers that are infrastructure, not UI anyone would ask to change. */
const FRAMEWORK_NAMES = new Set([
  'ErrorBoundary',
  'Suspense',
  'StrictMode',
  'Provider',
  'Consumer',
  'Context',
  'Lazy',
  'Root',
]);

export function fiberFromNode(node: Node | null): Fiber | null {
  if (!node) return null;
  for (const key of Object.keys(node)) {
    if (key.startsWith('__reactFiber$')) return (node as unknown as Record<string, Fiber>)[key];
  }
  return null;
}

/** The function or class behind a component fiber, unwrapping memo and forwardRef. */
function componentType(fiber: Fiber): Record<string, unknown> | null {
  let type = fiber.type as Record<string, unknown> | null;
  // memo(X) → X; forwardRef(render) → render; memo(forwardRef(render)) → render.
  for (let i = 0; i < 3 && type && typeof type === 'object'; i++) {
    type = ((type.type ?? type.render) as Record<string, unknown> | null) ?? null;
  }
  return type;
}

export function componentName(fiber: Fiber): string {
  const outer = fiber.type as Record<string, unknown> | null;
  const inner = componentType(fiber);
  const named = (value: Record<string, unknown> | null | undefined) =>
    value && (typeof value.displayName === 'string' ? value.displayName : typeof value.name === 'string' ? value.name : '');
  return named(outer) || named(inner) || 'Anonymous';
}

function sourceOf(fiber: Fiber): string | undefined {
  const outer = fiber.type as Record<string, unknown> | null;
  const inner = componentType(fiber);
  const value = (outer && outer.__cs3Source) || (inner && inner.__cs3Source);
  return typeof value === 'string' ? value : undefined;
}

export function isComponentFiber(fiber: Fiber): boolean {
  return COMPONENT_TAGS.has(fiber.tag);
}

export function kindOf(fiber: Fiber): ComponentKind {
  const name = componentName(fiber);
  if (FRAMEWORK_NAMES.has(name) || name === 'Anonymous') return 'framework';
  return sourceOf(fiber) ? 'app' : 'library';
}

/** Props worth showing: no children, no stamps, functions by name only. */
export function visibleProps(props: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props ?? {})) {
    if (key === 'children' || key === 'data-cs3-site' || key === 'data-cs3-loc') continue;
    out[key] = value;
  }
  return out;
}

/**
 * `useState`/`useReducer` values of a function component.
 *
 * A function component's hooks are a linked list on `memoizedState`; a state
 * hook is the one with an update `queue`. Effects, refs and memos carry no
 * queue and say nothing a viewer changed. A class component's state is its
 * `memoizedState` object as a whole.
 */
export function componentState(fiber: Fiber): unknown[] {
  if (fiber.tag === FiberTag.ClassComponent) {
    return fiber.memoizedState === null || fiber.memoizedState === undefined ? [] : [fiber.memoizedState];
  }
  const values: unknown[] = [];
  let hook = fiber.memoizedState as { memoizedState?: unknown; queue?: unknown; next?: unknown } | null;
  for (let i = 0; hook && typeof hook === 'object' && i < 60; i++) {
    if (hook.queue && typeof hook.queue === 'object' && 'dispatch' in (hook.queue as object)) {
      values.push(hook.memoizedState);
    }
    hook = (hook.next as typeof hook) ?? null;
  }
  return values;
}

export function describeComponent(fiber: Fiber): ComponentInfo {
  const props = fiber.memoizedProps ?? {};
  const site = props['data-cs3-site'];
  return {
    name: componentName(fiber),
    kind: kindOf(fiber),
    definedAt: sourceOf(fiber),
    renderedAt: typeof site === 'string' ? site : undefined,
    props: visibleProps(props),
    state: componentState(fiber),
    fiber,
  };
}

/** Every component above a fiber, root first. */
export function componentPath(fiber: Fiber | null): ComponentInfo[] {
  const path: ComponentInfo[] = [];
  for (let current = fiber; current; current = current.return) {
    if (isComponentFiber(current)) path.unshift(describeComponent(current));
  }
  return path;
}

/** The first DOM element a component renders, for highlighting it. */
export function firstHostNode(fiber: Fiber | null): Element | null {
  const stack: Fiber[] = fiber ? [fiber] : [];
  // Depth-first, children before siblings, bounded so a huge tree cannot hang the UI.
  for (let steps = 0; stack.length > 0 && steps < 5000; steps++) {
    const current = stack.pop()!;
    if (HOST_TAGS.has(current.tag) && current.stateNode instanceof Element) return current.stateNode;
    if (current.sibling && current !== fiber) stack.push(current.sibling);
    if (current.child) stack.push(current.child);
  }
  return null;
}

const SKIPPED_ATTRIBUTES = new Set(['class', 'style', 'data-cs3-loc', 'data-cs3-site']);

function reactProps(element: Element): Record<string, unknown> {
  for (const key of Object.keys(element)) {
    if (key.startsWith('__reactProps$')) return (element as unknown as Record<string, Record<string, unknown>>)[key];
  }
  return {};
}

const HANDLER_DEPTH = 5;

function handlersAround(element: Element): HandlerInfo[] {
  const found: HandlerInfo[] = [];
  let current: Element | null = element;
  for (let depth = 0; current && depth <= HANDLER_DEPTH && current !== document.body; depth++) {
    const props = reactProps(current);
    const names = Object.keys(props).filter((key) => /^on[A-Z]/.test(key) && typeof props[key] === 'function');
    if (names.length > 0) {
      const tag = current.tagName.toLowerCase();
      const cls = current.classList[0] ? `.${current.classList[0]}` : '';
      for (const name of names) {
        found.push({ name, on: `${tag}${cls}`, at: current.getAttribute('data-cs3-loc') ?? undefined, depth });
      }
    }
    current = current.parentElement;
  }
  return found;
}

export function describeElement(element: Element): ElementInfo {
  const rect = element.getBoundingClientRect();
  const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
  return {
    tag: element.tagName.toLowerCase(),
    id: element.id || undefined,
    classes: [...element.classList],
    writtenAt: element.getAttribute('data-cs3-loc') ?? undefined,
    attributes: [...element.attributes]
      .filter((attribute) => !SKIPPED_ATTRIBUTES.has(attribute.name))
      .map((attribute) => [attribute.name, attribute.value] as [string, string]),
    handlers: handlersAround(element),
    text: text ? text.slice(0, 120) : undefined,
    size: { width: Math.round(rect.width), height: Math.round(rect.height) },
  };
}

export function inspect(element: Element): Inspection {
  const fiber = fiberFromNode(element);
  const hierarchy = componentPath(fiber);
  const responsible = [...hierarchy].reverse().find((entry) => entry.kind === 'app');
  const ownerFiber = fiber?._debugOwner && isComponentFiber(fiber._debugOwner) ? fiber._debugOwner : null;
  return {
    element: describeElement(element),
    hierarchy,
    responsible,
    owner: ownerFiber ? describeComponent(ownerFiber) : undefined,
  };
}

// --- presentation --------------------------------------------------------

/** A value as one short line: strings quoted, functions named, objects summarised. */
export function preview(value: unknown, depth = 0): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return JSON.stringify(value.length > 80 ? `${value.slice(0, 77)}…` : value);
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (typeof value === 'function') return `ƒ ${(value as { name?: string }).name || 'anonymous'}()`;
  if (typeof value === 'symbol') return value.toString();
  if (typeof Element !== 'undefined' && value instanceof Element) return `<${value.tagName.toLowerCase()}>`;
  if (Array.isArray(value)) {
    if (depth > 0) return `Array(${value.length})`;
    const head = value.slice(0, 3).map((item) => preview(item, depth + 1));
    return `[${head.join(', ')}${value.length > 3 ? `, … ${value.length - 3} more` : ''}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if ('$$typeof' in record) return '<React element>';
    if ('current' in record && Object.keys(record).length === 1) return `ref(${preview(record.current, depth + 1)})`;
    const keys = Object.keys(record);
    if (depth > 0) return `{…${keys.length}}`;
    const head = keys.slice(0, 4).map((key) => `${key}: ${preview(record[key], depth + 1)}`);
    return `{ ${head.join(', ')}${keys.length > 4 ? `, … ${keys.length - 4} more` : ''} }`;
  }
  return String(value);
}

/** `src/views/X.tsx:12:5` → `src/views/X.tsx:12` for display; the column stays in copies. */
export function shortLocation(location: string | undefined): string | undefined {
  return location?.replace(/:(\d+):\d+$/, ':$1');
}

/**
 * The inspection as text an AI coding agent can act on without a screenshot.
 *
 * Ordered by what resolves ambiguity fastest: which component, which file and
 * line, how it is nested, then the specifics of this instance.
 */
export function formatForAgent(inspection: Inspection, selected: ComponentInfo | undefined): string {
  const focus = selected ?? inspection.responsible ?? inspection.owner;
  const lines: string[] = [];
  lines.push('UI Component:', `  ${focus?.name ?? 'unknown'}`, '');
  lines.push('Source:');
  if (focus?.definedAt) lines.push(`  defined   ${focus.definedAt}`);
  if (focus?.renderedAt) lines.push(`  rendered  ${focus.renderedAt}`);
  if (inspection.element.writtenAt) lines.push(`  element   ${inspection.element.writtenAt}`);
  if (!focus?.definedAt && !inspection.element.writtenAt) {
    lines.push('  (no source location — run the app with `bun run dev` for source stamps)');
  }
  lines.push('');

  const tree = inspection.hierarchy.filter((entry) => entry.kind === 'app');
  if (tree.length > 0) {
    lines.push('Hierarchy (application components, outermost first):');
    tree.forEach((entry, index) => {
      const marker = entry.fiber === focus?.fiber ? '  ← selected' : '';
      lines.push(`${'  '.repeat(index + 1)}${entry.name}${entry.definedAt ? `  (${shortLocation(entry.definedAt)})` : ''}${marker}`);
    });
    lines.push('');
  }

  const element = inspection.element;
  lines.push('Element:');
  lines.push(`  <${element.tag}${element.id ? `#${element.id}` : ''}>  ${element.size.width}×${element.size.height}`);
  if (element.classes.length) lines.push(`  class: ${element.classes.join(' ')}`);
  if (element.text) lines.push(`  text: ${JSON.stringify(element.text)}`);
  for (const [name, value] of element.attributes.slice(0, 8)) lines.push(`  ${name}: ${JSON.stringify(value)}`);
  lines.push('');

  const props = Object.entries(focus?.props ?? {});
  if (props.length) {
    lines.push(`Props (${focus?.name}):`);
    for (const [key, value] of props.slice(0, 25)) lines.push(`  ${key}: ${preview(value)}`);
    lines.push('');
  }
  if (focus?.state.length) {
    lines.push(`State (${focus.name}, hook order):`);
    focus.state.slice(0, 15).forEach((value, index) => lines.push(`  [${index}] ${preview(value)}`));
    lines.push('');
  }
  const handlers = [
    ...element.handlers.map(
      (handler) => `${handler.name} on <${handler.on}>${handler.at ? `  (${shortLocation(handler.at)})` : ''}`
    ),
    ...Object.entries(focus?.props ?? {})
      .filter(([key, value]) => /^on[A-Z]/.test(key) && typeof value === 'function')
      .map(([key]) => `${key} (prop of ${focus?.name})`),
  ];
  if (handlers.length) {
    lines.push('Interaction:');
    for (const handler of [...new Set(handlers)]) lines.push(`  ${handler}`);
  }
  return lines.join('\n').trimEnd();
}

/** `file:line:col` → its parts, for opening an editor. */
export function parseLocation(location: string | undefined): { file: string; line: number; column: number } | null {
  const match = location?.match(/^(.*?):(\d+)(?::(\d+))?$/);
  if (!match) return null;
  return { file: match[1], line: Number(match[2]), column: Number(match[3] ?? 1) };
}
