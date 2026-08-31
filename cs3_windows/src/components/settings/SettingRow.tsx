import React from 'react';
import { InfoHint } from './InfoHint';
import { shouldShow, useSettingsLevel } from './SettingsLevel';

/**
 * One setting: what it is on the left, what you do about it on the right.
 *
 * Every row is the same shape, which is the point. The old screen gave each
 * setting its own card, its own heading weight and its own paragraph, so six
 * settings read as six unrelated features rather than one list you can scan.
 *
 * `hint` carries the long explanation. `note` is for the short piece of state
 * that has to stay visible — a file path, "engines ready" — which is different
 * from prose about what the setting means.
 */
export const SettingRow: React.FC<{
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
}> = ({ label, hint, note, children, stacked = false, level = 'basic' }) => {
  if (!shouldShow(useSettingsLevel(), level)) return null;
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
}> = ({ title, icon, children, level = 'basic' }) => {
  const settingsLevel = useSettingsLevel();
  if (!shouldShow(settingsLevel, level)) return null;

  /**
   * A group whose every row hid itself hides too.
   *
   * Without this, Simple mode is a page of headings with nothing under them,
   * which reads as the settings having failed to load rather than as them being
   * filtered. Detected from the rendered children rather than tracked by the
   * rows, because a row that returns `null` is exactly what React gives us and
   * anything else would need the rows to report upwards through a second
   * channel that could disagree with what is on screen.
   */
  // `toArray` already drops null, undefined and booleans, so what is left is
  // either an element to inspect or literal content that always counts.
  const rendered = React.Children.toArray(children).filter((child) => {
    if (!React.isValidElement(child)) return true;
    const childLevel = (child.props as { level?: 'basic' | 'advanced' }).level;
    return shouldShow(settingsLevel, childLevel);
  });
  if (rendered.length === 0) return null;

  return (
    <section className="setting-group">
      <h3>
        {icon}
        {title}
      </h3>
      <div className="setting-group__body">{children}</div>
    </section>
  );
};
