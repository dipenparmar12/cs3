import React from 'react';
import { EyeOff } from 'lucide-react';
import { SettingGroup, SettingRow } from './SettingRow';
import { usePrivacy } from '../../utils/usePrivacy';
import type { IncognitoSettings } from '../../../electron/cs3/privacyMode';

/**
 * Incognito (PRD-52 §14). Every row writes through `privacy:updateSettings`,
 * which answers with the whole state; the shared hook redraws from the push.
 * The copy deliberately promises only what the app does: it stops *saving*
 * activity on this computer, and nothing about the network.
 */
export const PrivacySettings: React.FC = () => {
  const { active, state, setActive } = usePrivacy();
  const settings = state?.settings;
  const update = (partial: Partial<IncognitoSettings>) =>
    void window.cloudstream?.updatePrivacySettings(partial);

  const toggle = (key: keyof IncognitoSettings, disabled = false) => (
    <label className="toggle">
      <input
        type="checkbox"
        checked={settings?.[key] ?? false}
        disabled={!settings || disabled}
        onChange={(event) => update({ [key]: event.target.checked })}
      />
      <span>{settings?.[key] ? 'On' : 'Off'}</span>
    </label>
  );

  return (
    <SettingGroup
      title="Privacy"
      icon={<EyeOff size={15} />}
      keywords="privacy incognito private history progress search saved"
    >
      <SettingRow
        label="Incognito"
        hint="While on, watch history, progress, searches and visited titles are not saved. Bookmarks and downloads you choose are still kept. It does not hide your activity from your network or the sites you watch from. Ctrl+Shift+N switches it anywhere."
      >
        <label className="toggle">
          <input type="checkbox" checked={active} disabled={!state} onChange={(e) => setActive(e.target.checked)} />
          <span>{active ? 'On' : 'Off'}</span>
        </label>
      </SettingRow>
      <SettingRow label="Allow downloads in Incognito" hint="Downloaded files are kept after Incognito ends.">
        {toggle('allowDownloads')}
      </SettingRow>
      <SettingRow label="Allow saving pages in Incognito" hint="A page you save on purpose is kept; pages you only open are not.">
        {toggle('allowExplicitSaves')}
      </SettingRow>
      <SettingRow label="Start in Incognito if I left it on" hint="Off means every launch starts in normal mode.">
        {toggle('rememberPreference')}
      </SettingRow>
    </SettingGroup>
  );
};
