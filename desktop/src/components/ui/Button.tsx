/**
 * The app's button, as a component over the `.btn` classes everything already uses.
 *
 * Variants are emphasis, not new buttons:
 *
 * | variant       | for                                              | class         |
 * |---------------|--------------------------------------------------|---------------|
 * | `default`     | most actions — Refresh, Export, Cancel            | `btn-secondary` |
 * | `prominent`   | the one main action in a view or dialog          | `btn-primary`   |
 * | `ambient`     | blends into its surroundings — toolbars, Clear    | `btn-ghost`     |
 * | `destructive` | uninstall, delete, remove                        | `btn-danger`    |
 *
 * `size="compact"` (`btn-sm`) is for dense toolbars and rows. `loading` shows a
 * spinner, keeps the width, sets `aria-busy` and disables the button so it
 * cannot be pressed twice. An `iconOnly` button must say what it does through
 * `aria-label`, which TypeScript requires.
 */
import React from 'react';
import { Loader2, type LucideIcon } from 'lucide-react';

export type ButtonVariant = 'default' | 'prominent' | 'ambient' | 'destructive';
export type ButtonSize = 'default' | 'compact';

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  default: 'btn-secondary',
  prominent: 'btn-primary',
  ambient: 'btn-ghost',
  destructive: 'btn-danger',
};

/** Icon sizes per button size — one table, so icons line up across the app. */
export const BUTTON_ICON_SIZE: Record<ButtonSize, number> = { default: 15, compact: 13 };

type Base = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** A lucide icon component, drawn at the size's icon size before the label. */
  icon?: LucideIcon;
  loading?: boolean;
  /** Extra data attributes are allowed (e.g. `data-autofocus`). */
  [data: `data-${string}`]: string | undefined;
};

type ButtonProps =
  | (Base & { iconOnly?: false; children: React.ReactNode })
  | (Base & { iconOnly: true; 'aria-label': string; children?: never });

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size = 'default', icon: Icon, loading = false, iconOnly, className, children, disabled, type, ...rest },
  ref
) {
  const iconSize = BUTTON_ICON_SIZE[size];
  const classes = [
    'btn',
    VARIANT_CLASS[variant],
    size === 'compact' ? 'btn-sm' : '',
    iconOnly ? 'btn-icon' : '',
    loading ? 'btn--loading' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Loader2 size={iconSize} className="spin" aria-hidden /> : Icon ? <Icon size={iconSize} aria-hidden /> : null}
      {iconOnly ? null : children}
    </button>
  );
});
