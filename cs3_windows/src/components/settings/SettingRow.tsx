import React from 'react';
import { InfoHint } from './InfoHint';

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
}> = ({ label, hint, note, children, stacked = false }) => (
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

/** A titled group of rows. Sections are what make the screen scannable. */
export const SettingGroup: React.FC<{
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, icon, children }) => (
  <section className="setting-group">
    <h3>
      {icon}
      {title}
    </h3>
    <div className="setting-group__body">{children}</div>
  </section>
);
