import React, { useEffect, useState } from 'react';
import type { RegionAffectedRepository, RegionState } from '../../../electron/cs3/bootstrap';
import type { RegionId } from '../../../electron/cs3/regions';
import { describeError } from '../../utils/errors';
import { useFlash } from '../../utils/useFlash';
import { RegionPicker } from './RegionPicker';

/**
 * Changing regions after the first run (PRD-54 §7).
 *
 * Adding a region sets up what it newly calls for, in the background. Removing
 * one deletes and disables nothing by itself: what it leaves behind is listed,
 * and turning those repositories off is the viewer's press — reversible, with
 * no archive deleted.
 */
export const RegionSettings: React.FC = () => {
  const [state, setState] = useState<RegionState | null>(null);
  const [selected, setSelected] = useState<RegionId[]>([]);
  const [affected, setAffected] = useState<RegionAffectedRepository[]>([]);
  const [busy, setBusy] = useState(false);
  const { message, flash } = useFlash();

  useEffect(() => {
    window.cloudstream?.getRegions?.().then((next) => {
      setState(next);
      setSelected(next.selected);
    });
  }, []);

  if (!state) return null;
  const changed = [...selected].sort().join() !== [...state.selected].sort().join();

  const save = async () => {
    const api = window.cloudstream;
    if (!api) return;
    setBusy(true);
    try {
      const result = await api.setRegions(selected);
      if (!result.ok) throw new Error(result.error);
      setState(result.state);
      setSelected(result.state.selected);
      setAffected(result.affected);
      flash('Saved. Anything new is being set up in the background.', 4000);
    } catch (cause) {
      flash(describeError(cause), 5000);
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    const api = window.cloudstream;
    if (!api) return;
    setBusy(true);
    try {
      await api.setRepositoriesEnabled(
        affected.map((repo) => repo.url),
        false
      );
      flash(`Turned off ${affected.length} repositor${affected.length === 1 ? 'y' : 'ies'}.`, 4000);
      setAffected([]);
    } catch (cause) {
      flash(describeError(cause), 5000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="region-settings">
      <p className="region-settings__note">
        Which regions' repositories, extensions and providers are set up for you. Adding a region sets up
        what it calls for; removing one never deletes anything. Repositories and extensions you switched
        on or off yourself keep your choice.
      </p>

      <RegionPicker regions={state.regions} selected={selected} onChange={setSelected} disabled={busy} />

      <div className="region-settings__actions">
        <button className="btn btn-primary btn-sm" disabled={busy || !changed || selected.length === 0} onClick={save}>
          Save regions
        </button>
        {message && <span className="region-settings__note">{message}</span>}
      </div>

      {affected.length > 0 && (
        <div className="region-settings__review">
          <strong>Set up for regions you removed</strong>
          <ul>
            {affected.map((repo) => (
              <li key={repo.url}>{repo.name}</li>
            ))}
          </ul>
          <div className="region-settings__actions">
            <button className="btn btn-secondary btn-sm" disabled={busy} onClick={turnOff}>
              Turn these off
            </button>
            <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setAffected([])}>
              Keep them
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
