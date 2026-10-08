/**
 * An action menu: a trigger and a short list of things to do.
 *
 * Distinct from `FacetMenu`, which *chooses a value* (a listbox with ticks).
 * This *runs a command* (role="menu"/"menuitem"). One behaviour for every
 * such menu: ArrowDown or Enter on the trigger opens it on the first item;
 * Up/Down/Home/End move; Enter/Space runs; Escape closes and returns focus to
 * the trigger; Tab or a click outside closes. Items may carry a second line
 * explaining what they do, an icon, and a destructive tone.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { useDismissable } from '../../utils/useDismissable';

export interface MenuItem {
  label: React.ReactNode;
  description?: React.ReactNode;
  icon?: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
  tone?: 'default' | 'danger';
}

interface TriggerProps {
  'aria-haspopup': 'menu';
  'aria-expanded': boolean;
  onClick: () => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
  ref: React.Ref<HTMLButtonElement>;
}

export const Menu: React.FC<{
  /** Renders the trigger; spread the props onto a `Button` or `<button>`. */
  trigger: (props: TriggerProps) => React.ReactNode;
  items: MenuItem[];
  /** Which edge of the trigger the menu lines up with. */
  align?: 'start' | 'end';
  label: string;
  className?: string;
}> = ({ trigger, items, align = 'end', label, className }) => {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const list = useRef<HTMLDivElement | null>(null);

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);
  const dismiss = useCallback(() => close(false), [close]);
  useDismissable(open, wrapper, dismiss);

  const entries = () => [...(list.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
  const focusAt = (index: number) => {
    const all = entries();
    if (all.length) all[(index + all.length) % all.length].focus();
  };

  useEffect(() => {
    if (open) requestAnimationFrame(() => focusAt(0));
  }, [open]);

  const onTriggerKey = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
    } else if (event.key === 'Escape' && open) {
      event.stopPropagation();
      close(true);
    }
  };

  const onListKey = (event: React.KeyboardEvent) => {
    const all = entries();
    const index = all.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusAt(index + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusAt(index - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusAt(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusAt(all.length - 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'Tab') {
      close(false);
    }
  };

  return (
    <div className={`ui-menu${className ? ` ${className}` : ''}`} ref={wrapper}>
      {trigger({
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        onClick: () => setOpen((value) => !value),
        onKeyDown: onTriggerKey,
        ref: triggerRef,
      })}
      {open && (
        <div
          ref={list}
          className={`ui-menu__list ui-menu__list--${align}`}
          role="menu"
          aria-label={label}
          onKeyDown={onListKey}
        >
          {items.map((item, index) => {
            const Icon = item.icon;
            return (
              <button
                key={index}
                type="button"
                role="menuitem"
                tabIndex={-1}
                disabled={item.disabled}
                className={`ui-menu__item${item.tone === 'danger' ? ' ui-menu__item--danger' : ''}`}
                onClick={() => {
                  close(true);
                  item.onSelect();
                }}
              >
                {Icon ? <Icon size={14} aria-hidden className="ui-menu__icon" /> : null}
                <span className="ui-menu__text">
                  <span>{item.label}</span>
                  {item.description ? <span className="ui-menu__description">{item.description}</span> : null}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
