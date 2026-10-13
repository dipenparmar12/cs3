import React, { useCallback, useState } from 'react';
import { ChevronDown, Maximize2 } from 'lucide-react';

/**
 * One section of the detail page below the hero: a heading that collapses it,
 * and quiet actions that appear only when the section is pointed at.
 *
 * Every section — episodes, trailers, reviews, cast, about, the franchise,
 * behind the scenes, more like this — had its own header markup and only one
 * of them could be collapsed. A page for a long series was a wall to scroll
 * past before reaching the cast. Now each one folds, the same way, and the
 * choice is remembered *per kind of section* across titles and restarts: a
 * viewer who never reads production notes closes them once, not on every film.
 *
 * Actions ("Find more", "Clear", "View all") stay out of the way: shown on
 * hover or keyboard focus, and never while the section is folded. A control
 * nobody asked for should not compete with the content it acts on.
 */

const STORAGE_KEY = 'cs3.detailSections.collapsed';

function readCollapsed(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

/** Shared by every section on screen, so "collapse all" and each header agree. */
const listeners = new Set<() => void>();
let collapsedState = readCollapsed();

function writeCollapsed(next: Record<string, boolean>) {
  collapsedState = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {}
  for (const listener of listeners) listener();
}

export function useSectionCollapsed(id: string, defaultCollapsed = false): [boolean, (next: boolean) => void] {
  const [, rerender] = useState(0);
  React.useEffect(() => {
    const listener = () => rerender((value) => value + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  const collapsed = collapsedState[id] ?? defaultCollapsed;
  const set = useCallback((next: boolean) => writeCollapsed({ ...collapsedState, [id]: next }), [id]);
  return [collapsed, set];
}

/** Folds or unfolds every section id given, at once. */
export function setSectionsCollapsed(ids: string[], collapsed: boolean): void {
  const next = { ...collapsedState };
  for (const id of ids) next[id] = collapsed;
  writeCollapsed(next);
}

export const DetailSection: React.FC<{
  /** Stable kind of section ("cast", "trailers"); the collapse memory key. */
  id: string;
  title: React.ReactNode;
  icon?: React.ReactNode;
  count?: number;
  /** Quiet actions, shown on hover/focus while open. */
  actions?: React.ReactNode;
  /** Opens the whole collection in a larger view. */
  onViewAll?: () => void;
  defaultCollapsed?: boolean;
  className?: string;
  children: React.ReactNode;
}> = ({ id, title, icon, count, actions, onViewAll, defaultCollapsed = false, className, children }) => {
  const [collapsed, setCollapsed] = useSectionCollapsed(id, defaultCollapsed);
  const bodyId = `detail-section-${id}`;
  return (
    <section
      id={`section-${id}`}
      className={`detail-section${collapsed ? ' detail-section--collapsed' : ''}${className ? ` ${className}` : ''}`}
      data-section={id}
    >
      <div className="detail-section__head">
        <button
          type="button"
          className="detail-section__toggle"
          onClick={() => setCollapsed(!collapsed)}
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          title={collapsed ? 'Show this section' : 'Hide this section'}
        >
          {icon && <span className="detail-section__icon" aria-hidden>{icon}</span>}
          <h2 className="detail-section__title">{title}</h2>
          {count !== undefined && count > 0 && <span className="detail-section__count">{count}</span>}
          <ChevronDown size={16} className="detail-section__chevron" aria-hidden />
        </button>
        {!collapsed && (actions || onViewAll) && (
          <div className="detail-section__actions">
            {actions}
            {onViewAll && (
              <button type="button" className="detail-section__action" onClick={onViewAll} title="See everything in a larger view">
                <Maximize2 size={13} aria-hidden />
                <span>View all</span>
              </button>
            )}
          </div>
        )}
      </div>
      {!collapsed && (
        <div className="detail-section__body" id={bodyId}>
          {children}
        </div>
      )}
    </section>
  );
};

/** A quiet section action: icon and a short label, styled like its siblings. */
export const SectionAction: React.FC<{
  icon: React.ReactNode;
  label: string;
  title?: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'default' | 'danger';
}> = ({ icon, label, title, onClick, disabled, tone = 'default' }) => (
  <button
    type="button"
    className={`detail-section__action${tone === 'danger' ? ' detail-section__action--danger' : ''}`}
    onClick={onClick}
    disabled={disabled}
    title={title ?? label}
  >
    {icon}
    <span>{label}</span>
  </button>
);
