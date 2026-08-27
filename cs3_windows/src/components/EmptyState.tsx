import React from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * What a list looks like when there is nothing in it.
 *
 * Every list route rendered a single sentence of body text — `<p>No results.</p>`
 * was the whole of it in `SearchView`. For a first-time user that means **every
 * screen except Home is a blank page**: an empty library, an empty history, an
 * empty download queue and a search that found nothing all look identical, and
 * all four look like the app failed rather than like there is nothing there yet.
 *
 * The action is the reason this component exists rather than a CSS class. An
 * empty state that only reports emptiness leaves the user where they were; one
 * that names the next step is the cheapest onboarding in the product, and it is
 * exactly where a new user is most likely to be stuck.
 */
interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  /** One or two sentences. Say what would put something here, not "no data". */
  description?: React.ReactNode;
  action?: { label: string; onClick: () => void };
  /** A quieter alternative — "learn more", "open settings". */
  secondary?: { label: string; onClick: () => void };
  /** For an empty region inside a page rather than a whole view. */
  compact?: boolean;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon,
  title,
  description,
  action,
  secondary,
  compact = false,
}) => (
  <div className={`empty-state${compact ? ' empty-state--compact' : ''}`}>
    {Icon && (
      <span className="empty-state__icon" aria-hidden="true">
        <Icon size={compact ? 20 : 28} />
      </span>
    )}
    <h3 className="empty-state__title">{title}</h3>
    {description && <p className="empty-state__body">{description}</p>}
    {(action || secondary) && (
      <div className="empty-state__actions">
        {action && (
          <button type="button" className="btn btn-primary" onClick={action.onClick}>
            {action.label}
          </button>
        )}
        {secondary && (
          <button type="button" className="btn btn-secondary" onClick={secondary.onClick}>
            {secondary.label}
          </button>
        )}
      </div>
    )}
  </div>
);
