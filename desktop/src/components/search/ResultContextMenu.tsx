import React, { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BookmarkPlus, EyeOff, Filter, PowerOff } from 'lucide-react';
import type { SearchResponse } from '../../types/api';
import { useDismissable } from '../../utils/useDismissable';
import { isPlaceholderOrigin } from '../../utils/originName';

/**
 * Right-click on a search result: keep it, or deal with the provider it came from.
 *
 * Three provider actions, each wider than the last, because they answer three
 * different complaints: "not in this search" (hide its rows here), "not in my
 * searches" (leave it out of the search sources), and "not at all" (switch the
 * provider off, as the extensions screen does). A catalogue row (Cinemeta and
 * the like) has no provider to act on, so only Save is offered.
 */

export interface ResultMenuActions {
  save(item: SearchResponse): void | Promise<void>;
  hideProvider(provider: string): void;
  excludeProvider(provider: string): void | Promise<void>;
  disableProvider(provider: string): void | Promise<void>;
}

type OpenMenu = (item: SearchResponse, x: number, y: number) => void;

const MenuContext = createContext<OpenMenu | null>(null);

/** For a grid: opens the menu for a card, or nothing outside a search screen. */
export function useOpenResultMenu(): ((item: SearchResponse, event: React.MouseEvent) => void) | undefined {
  const open = useContext(MenuContext);
  if (!open) return undefined;
  return (item, event) => {
    event.preventDefault();
    open(item, event.clientX, event.clientY);
  };
}

export const ResultContextMenuProvider: React.FC<{
  actions: ResultMenuActions;
  children: React.ReactNode;
}> = ({ actions, children }) => {
  const [menu, setMenu] = useState<{ item: SearchResponse; x: number; y: number } | null>(null);
  return (
    <MenuContext.Provider value={(item, x, y) => setMenu({ item, x, y })}>
      {children}
      {menu && <ResultMenu {...menu} actions={actions} onClose={() => setMenu(null)} />}
    </MenuContext.Provider>
  );
};

const ResultMenu: React.FC<{
  item: SearchResponse;
  x: number;
  y: number;
  actions: ResultMenuActions;
  onClose: () => void;
}> = ({ item, x, y, actions, onClose }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  useDismissable(true, ref, onClose);

  // Kept inside the window: a press near the right or bottom edge opened a
  // menu half off screen.
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    setPosition({
      left: Math.max(8, Math.min(x, window.innerWidth - box.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - box.height - 8)),
    });
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [x, y]);

  // Escape closes the menu and nothing else (capture, consumed), or it would
  // also count as Back.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const provider = isPlaceholderOrigin(item.apiName) ? null : item.apiName;
  const run = (action: () => void | Promise<void>) => () => {
    onClose();
    void action();
  };

  return (
    <div
      ref={ref}
      className="ui-menu__list result-menu"
      role="menu"
      aria-label={`Actions for ${item.name}`}
      style={{ position: 'fixed', left: position.left, top: position.top }}
    >
      <MenuItem
        icon={<BookmarkPlus size={14} />}
        label="Save to Plan to watch"
        onClick={run(() => actions.save(item))}
      />
      {provider && (
        <>
          <div className="ui-menu__separator" role="separator" />
          <MenuItem
            icon={<EyeOff size={14} />}
            label={`Hide results from ${provider}`}
            description="This search only"
            onClick={run(() => actions.hideProvider(provider))}
          />
          <MenuItem
            icon={<Filter size={14} />}
            label={`Leave ${provider} out of searches`}
            description="Changes your search sources"
            onClick={run(() => actions.excludeProvider(provider))}
          />
          <MenuItem
            icon={<PowerOff size={14} />}
            label={`Turn off ${provider}`}
            description="Everywhere, as in Extensions"
            danger
            onClick={run(() => actions.disableProvider(provider))}
          />
        </>
      )}
    </div>
  );
};

const MenuItem: React.FC<{
  icon: React.ReactNode;
  label: string;
  description?: string;
  danger?: boolean;
  onClick: () => void;
}> = ({ icon, label, description, danger, onClick }) => (
  <button
    type="button"
    role="menuitem"
    className={`ui-menu__item${danger ? ' ui-menu__item--danger' : ''}`}
    onClick={onClick}
  >
    <span className="ui-menu__icon" aria-hidden>
      {icon}
    </span>
    <span className="ui-menu__text">
      {label}
      {description && <span className="ui-menu__description">{description}</span>}
    </span>
  </button>
);
