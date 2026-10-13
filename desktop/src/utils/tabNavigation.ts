/**
 * Where the viewer is in each sidebar screen, kept while they are elsewhere.
 *
 * The app had one `selectedMedia` for all of them, and every sidebar click
 * cleared it: open *The Matrix* from Search, glance at History, come back to
 * Search — and the page you were reading was gone, replaced by the result grid
 * at the top, with nothing to say which result you had opened. Every other
 * screen lost its place the same way.
 *
 * So each screen ("tab") keeps its own stack of opened pages, like a browser
 * tab keeps its history, and a scroll position for each level of it:
 *
 *  - opening a title pushes onto the current screen's stack;
 *  - Back pops it and restores the scroll that level had;
 *  - switching screens changes nothing on either screen;
 *  - pressing the screen you are already on goes to its root, the way tapping
 *    the current tab does in every mobile app;
 *  - a new search empties Search's stack, because it is a new question.
 *
 * Pure, so the rules are tested rather than remembered.
 */
export interface TabNavigationState<T> {
  /** Opened pages per screen, oldest first. Absent means at the screen's root. */
  stacks: Record<string, T[]>;
}

export function emptyNavigation<T>(): TabNavigationState<T> {
  return { stacks: {} };
}

export function topOf<T>(state: TabNavigationState<T>, tab: string): T | null {
  const stack = state.stacks[tab];
  return stack && stack.length > 0 ? stack[stack.length - 1] : null;
}

export function depthOf<T>(state: TabNavigationState<T>, tab: string): number {
  return state.stacks[tab]?.length ?? 0;
}

export function push<T>(state: TabNavigationState<T>, tab: string, item: T, limit = 30): TabNavigationState<T> {
  const stack = [...(state.stacks[tab] ?? []), item];
  // A bounded history: a long session of related-title hopping must not grow
  // without end. The oldest pages go first, as in a browser.
  return { stacks: { ...state.stacks, [tab]: stack.slice(-limit) } };
}

export function pop<T>(state: TabNavigationState<T>, tab: string): TabNavigationState<T> {
  const stack = state.stacks[tab];
  if (!stack || stack.length === 0) return state;
  return { stacks: { ...state.stacks, [tab]: stack.slice(0, -1) } };
}

export function reset<T>(state: TabNavigationState<T>, tab: string): TabNavigationState<T> {
  if (!state.stacks[tab]?.length) return state;
  const stacks = { ...state.stacks };
  delete stacks[tab];
  return { stacks };
}

/** Scroll positions per screen and depth: `search:0` is the grid, `search:1` the first page opened. */
export function scrollKey(tab: string, depth: number): string {
  return `${tab}:${depth}`;
}
