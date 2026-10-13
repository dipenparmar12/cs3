/**
 * The search screen's view state, which `App` owns and `SearchView` renders.
 *
 * Its own module because of who holds it: the filter, the type tab and which
 * groups are open survive the screen being unmounted — that is the point, a
 * viewer who opens a result and comes back finds the list as they left it — so
 * the state lives in `App` and the component is handed it.
 *
 * Keeping it in `SearchView.tsx` made that impossible to act on. `App` needed
 * the initial value, so it imported it, and a value import pulls the whole
 * module: the search screen could not be split out of the first paint while a
 * three-field object lived inside it.
 */
export interface SearchUiState {
  sourceFilter: string;
  typeTab: string;
  openGroups: Record<string, boolean>;
}

export const EMPTY_SEARCH_UI: SearchUiState = {
  sourceFilter: 'all',
  typeTab: 'all',
  openGroups: {},
};
