import React from 'react';
import { RefreshCw } from 'lucide-react';
import { Button, Select, Switch } from '../ui';
import { SettingRow } from './SettingRow';
import { useAppUpdate } from '../../utils/useAppUpdate';

/**
 * Settings → App updates (App Update PRD §7.2): the version and the last
 * check's result, Check now, channel, automatic checking, a skipped version.
 */
function describeResult(state: NonNullable<ReturnType<typeof useAppUpdate>>): string {
  if (!state.enabled) return 'This build does not check for updates (a development or test build).';
  if (state.checking) return 'Checking…';
  const when = state.lastCheckedAt ? ` Checked ${new Date(state.lastCheckedAt).toLocaleString()}.` : '';
  const result = state.lastResult;
  if (!result) return `Not checked yet.${when}`;
  if (result.kind === 'up-to-date') return `Up to date.${when}`;
  if (result.kind === 'available') return `Version ${result.version} is available.${when}`;
  return `Could not check: ${result.message}${when}`;
}

export const AppUpdateSettings: React.FC = () => {
  const state = useAppUpdate();
  if (!state) return null;
  return (
    <>
      <SettingRow label={`Version ${state.current}`} note={describeResult(state)} keywords="update version new release">
        {state.available && (
          <Button variant="prominent" onClick={() => void window.cloudstream?.openAppUpdateDownload?.()}>
            Download {state.available.version}
          </Button>
        )}
        <Button
          icon={RefreshCw}
          loading={state.checking}
          disabled={!state.enabled}
          onClick={() => void window.cloudstream?.checkAppUpdate?.()}
        >
          Check for updates
        </Button>
      </SettingRow>

      <SettingRow
        label="Update channel"
        hint="Stable is tested releases. Beta is builds of the next release, for trying fixes early; it can be rough. Switching back to Stable never installs an older version: it waits for the next stable one."
        keywords="beta stable preview channel"
      >
        <Select
          size="compact"
          aria-label="Update channel"
          value={state.channel}
          onChange={(e) =>
            void window.cloudstream?.setAppUpdateSettings?.({ channel: e.target.value === 'beta' ? 'beta' : 'stable' })
          }
          options={[
            { value: 'stable', label: 'Stable' },
            { value: 'beta', label: 'Beta' },
          ]}
        />
      </SettingRow>

      <SettingRow
        label="Check for updates automatically"
        hint="Once a day, from the project's GitHub releases. Nothing about you is sent; off means the app never contacts GitHub for this."
      >
        <Switch
          label="Check for updates automatically"
          checked={state.autoCheck}
          onChange={(autoCheck) => void window.cloudstream?.setAppUpdateSettings?.({ autoCheck })}
        />
      </SettingRow>

      {state.skipped && (
        <SettingRow label="Skipped version" note={`${state.skipped} is not offered; a newer one will be.`}>
          <Button size="compact" variant="ambient" onClick={() => void window.cloudstream?.unskipAppUpdate?.()}>
            Offer it again
          </Button>
        </SettingRow>
      )}
    </>
  );
};
