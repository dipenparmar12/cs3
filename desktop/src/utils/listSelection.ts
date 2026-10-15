import { useCallback, useMemo, useState } from 'react';

/**
 * Bulk selection for Library, History and Downloads (PRD §116).
 *
 * One rule carries most of the weight: **a selection only ever contains what is
 * on screen.** The stored set may still hold ids from a category the viewer
 * has switched away from, or rows a refresh removed, but everything that reads
 * it — the count, Select all, Invert, and above all the destructive action —
 * sees the stored set intersected with the current scope. So switching from
 * "Watching" to "Dropped" can never delete a Watching title nobody can see,
 * and a row that vanished on refresh can never be the target of the next press.
 *
 * Ids, never positions: sorting or filtering moves rows, and a selection kept
 * by index would silently point at different items afterwards.
 */

/** The stored selection as the current view sees it. */
export function visibleSelection(selected: ReadonlySet<string>, scope: readonly string[]): Set<string> {
  const visible = new Set<string>();
  for (const id of scope) if (selected.has(id)) visible.add(id);
  return visible;
}

/** Everything in view. Selections outside the view are dropped, not kept. */
export function selectAllIn(scope: readonly string[]): Set<string> {
  return new Set(scope);
}

/** Within the view only: the selected become unselected and the rest selected. */
export function invertIn(selected: ReadonlySet<string>, scope: readonly string[]): Set<string> {
  const inverted = new Set<string>();
  for (const id of scope) if (!selected.has(id)) inverted.add(id);
  return inverted;
}

/**
 * Selects or deselects a group of ids together (a series' episodes, a title's
 * visits): all of them become selected unless all of them already were.
 */
export function toggleGroup(selected: ReadonlySet<string>, ids: readonly string[]): Set<string> {
  const next = new Set(selected);
  const allOn = ids.length > 0 && ids.every((id) => next.has(id));
  for (const id of ids) {
    if (allOn) next.delete(id);
    else next.add(id);
  }
  return next;
}

export type GroupState = 'none' | 'some' | 'all';

export function groupState(selected: ReadonlySet<string>, ids: readonly string[]): GroupState {
  const on = ids.filter((id) => selected.has(id)).length;
  return on === 0 ? 'none' : on === ids.length ? 'all' : 'some';
}

export interface ListSelection {
  active: boolean;
  /** Only ids in the current scope. */
  selected: ReadonlySet<string>;
  count: number;
  total: number;
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  toggleMany: (ids: readonly string[]) => void;
  selectAll: () => void;
  invert: () => void;
  selectNone: () => void;
  /** Leaves selection mode with nothing selected, and the screen as it was. */
  exit: () => void;
  enter: () => void;
  /** After a bulk action: keep only the ids it could not handle, still visible. */
  keepOnly: (ids: readonly string[]) => void;
}

/** Selection state for one screen, scoped to the ids that screen is showing. */
export function useListSelection(scope: readonly string[]): ListSelection {
  const [active, setActive] = useState(false);
  const [stored, setStored] = useState<ReadonlySet<string>>(() => new Set());

  const selected = useMemo(() => visibleSelection(stored, scope), [stored, scope]);

  const toggle = useCallback(
    (id: string) =>
      setStored((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    []
  );
  const toggleMany = useCallback((ids: readonly string[]) => setStored((prev) => toggleGroup(prev, ids)), []);
  const selectAll = useCallback(() => setStored(selectAllIn(scope)), [scope]);
  const invert = useCallback(() => setStored((prev) => invertIn(visibleSelection(prev, scope), scope)), [scope]);
  const selectNone = useCallback(() => setStored(new Set()), []);
  const exit = useCallback(() => {
    setStored(new Set());
    setActive(false);
  }, []);
  const enter = useCallback(() => setActive(true), []);
  const keepOnly = useCallback((ids: readonly string[]) => setStored(new Set(ids)), []);
  const isSelected = useCallback((id: string) => selected.has(id), [selected]);

  return {
    active,
    selected,
    count: selected.size,
    total: scope.length,
    isSelected,
    toggle,
    toggleMany,
    selectAll,
    invert,
    selectNone,
    exit,
    enter,
    keepOnly,
  };
}
