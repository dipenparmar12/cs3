import React, { useEffect, useState } from 'react';
import { Globe2 } from 'lucide-react';
import type { RegionState } from '../../../electron/cs3/bootstrap';
import type { RegionId } from '../../../electron/cs3/regions';
import { describeError } from '../../utils/errors';
import { setAdultMode, useAdultState } from '../../utils/useAdultMode';
import { CrossRegionOption, RegionPicker } from './RegionPicker';

/**
 * Asked once, before anything is installed (PRD-54 §6): where the viewer's
 * content comes from. Pre-ticked from the system locale, so pressing Continue
 * without reading is still a sensible answer, and Skip stores that suggestion
 * so the question never becomes a wall.
 *
 * Adult content sits under "Optional content", collapsed and off: it is
 * findable by anyone who looks, and asked of nobody who does not.
 */
export const RegionOnboarding: React.FC = () => {
  const [state, setState] = useState<RegionState | null>(null);
  const [selected, setSelected] = useState<RegionId[]>([]);
  const adultState = useAdultState();
  // Untouched until the viewer ticks the box, so an existing `ask` or `on` survives Skip.
  const [adultChoice, setAdultChoice] = useState<boolean | null>(null);
  const adult = adultChoice ?? adultState.mode === 'on';
  const [crossRegion, setCrossRegion] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const api = window.cloudstream;
    const load = () =>
      api?.getRegions?.().then((next) => {
        setState(next);
        setSelected(next.selected);
        setCrossRegion(next.crossRegion);
      });
    load();
    return api?.onBootstrapProgress?.((progress) => {
      if (progress.phase === 'needs-regions') load();
    });
  }, []);

  if (!state?.needsSelection) return null;

  const save = async (choice: RegionId[]) => {
    const api = window.cloudstream;
    if (!api) return;
    setBusy(true);
    setError(null);
    try {
      // Adult first, so the run the regions start already knows the answer.
      if (adultChoice !== null && adultChoice !== (adultState.mode === 'on')) {
        await setAdultMode(adultChoice ? 'on' : 'off');
      }
      const result = await api.setRegions(choice, { crossRegion });
      if (!result.ok) throw new Error(result.error);
      setState(result.state);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal region-onboarding" role="dialog" aria-modal="true" aria-labelledby="region-onboarding-title">
        <header className="modal__head">
          <h3 id="region-onboarding-title">
            <Globe2 size={17} /> Where is your content from?
          </h3>
        </header>

        <p className="region-onboarding__lead">
          Pick one or more regions. CloudStream sets up the repositories, extensions and providers for
          them — in their languages — and leaves the rest of the world one click away in Extensions. You
          can change this any time in Settings.
        </p>

        <RegionPicker regions={state.regions} selected={selected} onChange={setSelected} disabled={busy} />

        <CrossRegionOption
          regions={state.regions}
          selected={selected}
          checked={crossRegion}
          onChange={setCrossRegion}
          disabled={busy}
        />

        <details className="region-onboarding__optional">
          <summary>Optional content</summary>
          <label>
            <input type="checkbox" checked={adult} disabled={busy} onChange={(e) => setAdultChoice(e.target.checked)} />
            Include adult / 18+ content
          </label>
        </details>

        <p className="region-onboarding__next">
          Nothing else to set up: after Continue, CloudStream installs and switches everything on in the
          background — search and press Play. Settings → Regions and the Extensions screen change any of it.
        </p>

        {error && <p className="region-onboarding__error">{error}</p>}

        <footer className="modal__foot">
          <button className="btn btn-secondary" disabled={busy} onClick={() => save(state.suggested)}>
            Skip
          </button>
          <button className="btn btn-primary" disabled={busy || selected.length === 0} onClick={() => save(selected)}>
            {busy ? 'Saving…' : 'Continue'}
          </button>
        </footer>
      </div>
    </div>
  );
};
