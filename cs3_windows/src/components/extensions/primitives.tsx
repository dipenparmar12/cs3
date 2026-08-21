import React from 'react';
import {
  CheckSquare,
  Square,
  Minus,
  ToggleLeft,
  ToggleRight,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';

/**
 * The small pieces every row in this screen is built from.
 *
 * They exist as components because the screen they replace inlined each of them
 * dozens of times: the same badge was written as a `style={{…}}` object in
 * fourteen places with three different paddings, and the tri-state checkbox was
 * duplicated per tab. One definition each means the tree, the catalogue and the
 * provider list actually look like the same screen.
 */

export type CheckState = 'checked' | 'unchecked' | 'indeterminate';

export const TriStateCheckbox: React.FC<{
  state: CheckState;
  onChange: () => void;
  size?: number;
  title?: string;
}> = ({ state, onChange, size = 16, title }) => (
  <button
    type="button"
    className={`ext-check${state === 'unchecked' ? '' : ' ext-check--on'}`}
    title={title}
    aria-checked={state === 'indeterminate' ? 'mixed' : state === 'checked'}
    role="checkbox"
    onClick={(event) => {
      event.stopPropagation();
      onChange();
    }}
  >
    {state === 'checked' && <CheckSquare size={size} />}
    {state === 'unchecked' && <Square size={size} />}
    {state === 'indeterminate' && (
      <span className="ext-check__partial" style={{ width: size, height: size }}>
        <Minus size={size - 6} strokeWidth={3} />
      </span>
    )}
  </button>
);

/**
 * On/off switch that can be *on yet powerless*.
 *
 * `suppressedReason` is the case that matters: a provider whose own switch is on
 * while its extension or repository is off. Rendering that as plain "off" would
 * be a lie the user cannot act on — they would click the toggle, see nothing
 * change, and have no way to learn why. The switch keeps showing its real state
 * and the tooltip names the ancestor responsible.
 */
export const Toggle: React.FC<{
  on: boolean;
  onChange: (next: boolean) => void;
  label: string;
  suppressedReason?: string;
  disabled?: boolean;
}> = ({ on, onChange, label, suppressedReason, disabled }) => (
  <button
    type="button"
    className={`ext-toggle${on && !suppressedReason ? ' ext-toggle--on' : ''}`}
    title={suppressedReason ? `${label} — ${suppressedReason}` : label}
    aria-label={label}
    aria-pressed={on}
    disabled={disabled}
    onClick={(event) => {
      event.stopPropagation();
      onChange(!on);
    }}
  >
    {on ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
  </button>
);

export const Disclosure: React.FC<{
  open: boolean;
  onToggle: () => void;
  hidden?: boolean;
  label: string;
}> = ({ open, onToggle, hidden, label }) => (
  <button
    type="button"
    className={`ext-disclosure${hidden ? ' ext-disclosure--placeholder' : ''}`}
    aria-expanded={open}
    aria-label={label}
    tabIndex={hidden ? -1 : 0}
    onClick={(event) => {
      event.stopPropagation();
      if (!hidden) onToggle();
    }}
  >
    {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
  </button>
);

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

export const Badge: React.FC<{
  tone?: BadgeTone;
  title?: string;
  children: React.ReactNode;
}> = ({ tone = 'neutral', title, children }) => (
  <span className={`ext-badge${tone === 'neutral' ? '' : ` ext-badge--${tone}`}`} title={title}>
    {children}
  </span>
);

export const Chip: React.FC<{
  pressed: boolean;
  onClick: () => void;
  count?: number;
  adult?: boolean;
  children: React.ReactNode;
}> = ({ pressed, onClick, count, adult, children }) => (
  <button
    type="button"
    className={`ext-chip${adult ? ' ext-chip--adult' : ''}`}
    aria-pressed={pressed}
    onClick={onClick}
  >
    {children}
    {count !== undefined && <span className="ext-chip__count">{count}</span>}
  </button>
);

export const ProgressBar: React.FC<{ step: string; percent: number; failed?: boolean }> = ({
  step,
  percent,
  failed,
}) => (
  <div className="ext-progress">
    <div className="ext-progress__label" style={failed ? { color: 'var(--status-error)' } : undefined}>
      {step}
    </div>
    <div className="ext-progress__track">
      <div
        className="ext-progress__fill"
        style={{
          width: `${Math.max(0, Math.min(100, percent))}%`,
          background: failed ? 'var(--status-error)' : undefined,
        }}
      />
    </div>
  </div>
);

/**
 * Opens a URL in the system browser.
 *
 * Never an `<a href>`: an in-app navigation would replace the application
 * window with a web page, and `setWindowOpenHandler` only covers window opens.
 */
export const ExternalLink: React.FC<{ url: string; children?: React.ReactNode }> = ({
  url,
  children,
}) => (
  <button
    type="button"
    className="ext-link"
    title={url}
    onClick={(event) => {
      event.stopPropagation();
      void window.cloudstream?.openExternalLink?.(url);
    }}
  >
    {children ?? url}
  </button>
);
