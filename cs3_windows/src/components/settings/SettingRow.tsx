import React, { useContext } from 'react';
import { ChevronDown } from 'lucide-react';
import { InfoHint } from './InfoHint';
import {
  GroupMatchContext,
  shouldShow,
  useSettingsLevel,
  useSettingsQuery,
} from './SettingsLevelContext';
import { matchesSettingQuery } from './settingsSearch';
import { useSettingCollapse } from './useSettingCollapse';

/**
 * One setting: what it is on the left, what you do about it on the right.
 *
 * Every row is the same shape, which is the point. The old screen gave each
 * setting its own card, its own heading weight and its own paragraph, so six
 * settings read as six unrelated features rather than one list you can scan.
 *
 * `hint` carries the long explanation, behind the ⓘ. `note` is for the short
 * piece of state that has to stay visible — a file path, "engines ready" —
 * which is different from prose about what the setting means.
 */
interface SettingRowProps {
  label: string;
  hint?: React.ReactNode;
  note?: React.ReactNode;
  children: React.ReactNode;
  /** Stacks the control under the label, for controls that need the width. */
  stacked?: boolean;
  /**
   * `advanced` hides this row in Simple mode. See `SettingsLevel` for the test
   * — it is about whether the *label* needs knowledge of how the app is built,
   * not about how risky or how rare the setting is.
   */
  level?: 'basic' | 'advanced';
  /** Other words someone might search for this by. */
  keywords?: string;
}

/** Whether a row with these props is left by the current search. */
function rowMatches(query: string, props: Partial<SettingRowProps>): boolean {
  return matchesSettingQuery(query, props.label, props.note, props.hint, props.keywords);
}

export const SettingRow: React.FC<SettingRowProps> = (props) => {
  const { label, hint, note, children, stacked = false, level = 'basic' } = props;
  const query = useSettingsQuery();
  const groupMatched = useContext(GroupMatchContext);
  if (!shouldShow(useSettingsLevel(), level)) return null;
  if (query && !groupMatched && !rowMatches(query, props)) return null;
  return (
    <div className={`setting-row${stacked ? ' setting-row--stacked' : ''}`}>
      <div className="setting-row__label">
        <span>
          {label}
          {hint && <InfoHint label={`About ${label}`}>{hint}</InfoHint>}
        </span>
        {note && <span className="setting-row__note">{note}</span>}
      </div>
      <div className="setting-row__control">{children}</div>
    </div>
  );
};

/** A titled group of rows. Sections are what make the screen scannable. */
export const SettingGroup: React.FC<{
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  /** Hides the whole group in Simple mode, heading included. */
  level?: 'basic' | 'advanced';
  /** An explanation for the whole group, behind the ⓘ beside its title. */
  hint?: React.ReactNode;
  /** Other words someone might search for this group by. */
  keywords?: string;
  storageKey?: string;
  collapsible?: boolean;
}> = ({
  title,
  icon,
  children,
  level = 'basic',
  hint,
  keywords,
  storageKey,
  collapsible = true,
}) => {
  const settingsLevel = useSettingsLevel();
  const query = useSettingsQuery();
  const [isCollapsed, toggleCollapse] = useSettingCollapse(storageKey || title);

  if (!shouldShow(settingsLevel, level)) return null;

  const groupMatched = query !== '' && matchesSettingQuery(query, title, keywords, hint);

  /**
   * A group whose every row hid itself hides too.
   *
   * Without this, Simple mode is a page of headings with nothing under them,
   * which reads as the settings having failed to load rather than as them being
   * filtered. Detected from the rendered children rather than tracked by the
   * rows, because a row that returns `null` is exactly what React gives us and
   * anything else would need the rows to report upwards through a second
   * channel that could disagree with what is on screen.
   *
   * Under a search, a child that is not a row (a whole panel) counts only when
   * the group itself matched — it has no label of its own to match on.
   */
  // `toArray` already drops null, undefined and booleans, so what is left is
  // either an element to inspect or literal content that always counts.
  const rendered = React.Children.toArray(children).filter((child) => {
    if (!React.isValidElement(child)) return !query || groupMatched;
    const props = child.props as Partial<SettingRowProps>;
    if (!shouldShow(settingsLevel, props.level)) return false;
    if (!query || groupMatched) return true;
    if (typeof props.label !== 'string') return true;
    return rowMatches(query, props);
  });
  if (rendered.length === 0) return null;

  const effectiveCollapsed = collapsible && isCollapsed && !query;

  return (
    <section className={`setting-group${effectiveCollapsed ? ' setting-group--collapsed' : ''}`}>
      <h3
        className={`setting-group__head${collapsible ? ' setting-group__head--collapsible' : ''}`}
        onClick={collapsible ? toggleCollapse : undefined}
        role={collapsible ? 'button' : undefined}
        tabIndex={collapsible ? 0 : undefined}
        aria-expanded={collapsible ? !effectiveCollapsed : undefined}
        onKeyDown={
          collapsible
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggleCollapse();
                }
              }
            : undefined
        }
      >
        <div className="setting-group__title-wrap">
          {icon}
          <span>{title}</span>
          {hint ? (
            <span
              onClick={(e) => {
                e.stopPropagation();
              }}
            >
              <InfoHint label={`About ${title}`}>{hint}</InfoHint>
            </span>
          ) : null}
        </div>
        {collapsible && (
          <span
            className={`setting-group__collapse-icon${
              effectiveCollapsed ? ' setting-group__collapse-icon--collapsed' : ''
            }`}
            aria-hidden="true"
          >
            <ChevronDown size={14} />
          </span>
        )}
      </h3>
      {!effectiveCollapsed && (
        <GroupMatchContext.Provider value={groupMatched}>
          <div className="setting-group__body">{children}</div>
        </GroupMatchContext.Provider>
      )}
    </section>
  );
};

/**
 * A whole panel that is not built from rows, shown or hidden by the search.
 *
 * Connection, Sources, Setup and the ranking panel draw their own layouts, so
 * they cannot filter row by row; they declare what they are about instead.
 */
export const SettingsSection: React.FC<{
  keywords: string;
  children: React.ReactNode;
}> = ({ keywords, children }) => {
  const query = useSettingsQuery();
  if (query && !matchesSettingQuery(query, keywords)) return null;
  // `display: contents`, so the wrapper exists for the "nothing matched" check
  // and changes nothing about the layout.
  return <div className="settings-found">{children}</div>;
};
