import React, { useCallback, useEffect, useState } from 'react';
import { Eye, EyeOff, ShieldAlert } from 'lucide-react';

type AdultMode = 'off' | 'ask' | 'on';

const MODES: Array<{ value: AdultMode; label: string; detail: string }> = [
  {
    value: 'off',
    label: 'Off',
    detail:
      'Adult providers are not installed, not searched and not listed anywhere — even inside a repository you have for its other providers.',
  },
  {
    value: 'ask',
    label: 'Ask before showing',
    detail:
      'They stay installed and configured but hidden. Revealing them lasts until you close the app, and every launch starts hidden again.',
  },
  {
    value: 'on',
    label: 'Enabled',
    detail: 'Adult providers appear in search, in the extensions list and in the catalogue.',
  },
];

/**
 * The adult-content gate, in three states.
 *
 * Two could not express the useful middle one. Someone on a shared machine
 * wants these providers installed and working and *not on screen by default* —
 * "off" throws away the configuration and "on" leaves it in front of whoever
 * opens the app next. `ask` keeps the setup and starts every launch hidden.
 *
 * The unlock is deliberately session-only and lives in memory in
 * `BootstrapService`, never in the datastore. A middle setting that quietly
 * remembered its unlock would be "on" with extra steps, which is the exact
 * opposite of what it is chosen for.
 *
 * Two steps on the way up, one click on the way down — unchanged, and for the
 * unchanged reason: enabling shows material a household member may not expect
 * and is worth a confirmation; disabling is the safe direction and must never
 * be made awkward. `PluginManager.enabledProviderNames` re-reads the gate on
 * every call, so both directions take effect immediately rather than at next
 * launch.
 */
export const AdultContentSetting: React.FC = () => {
  const [mode, setMode] = useState<AdultMode>('off');
  /** Whether adult providers are being offered *right now*. Differs from `mode` under `ask`. */
  const [allowed, setAllowed] = useState(false);
  const [confirming, setConfirming] = useState<AdultMode | null>(null);
  const [busy, setBusy] = useState(false);

  const read = useCallback(() => {
    void window.cloudstream?.getAdultMode?.().then((response) => {
      if (!response?.ok) return;
      setMode(response.mode);
      setAllowed(response.allowed);
    });
  }, []);

  useEffect(read, [read]);

  const apply = async (next: AdultMode) => {
    setBusy(true);
    const response = await window.cloudstream?.setAdultMode?.(next);
    if (response?.ok) {
      setMode(response.mode);
      setAllowed(response.allowed ?? false);
    }
    setConfirming(null);
    setBusy(false);
  };

  const choose = (next: AdultMode) => {
    if (next === mode) return;
    // Only the direction that reveals something needs confirming.
    if (next === 'off' || mode === 'on') void apply(next);
    else setConfirming(next);
  };

  const reveal = async (unlock: boolean) => {
    setBusy(true);
    const response = unlock
      ? await window.cloudstream?.unlockAdultForSession?.()
      : await window.cloudstream?.lockAdultForSession?.();
    if (response?.ok) setAllowed(response.allowed);
    setBusy(false);
  };

  const current = MODES.find((entry) => entry.value === mode) ?? MODES[0];

  return (
    <section className="adult-setting">
      <header>
        {allowed ? <ShieldAlert size={16} /> : <EyeOff size={16} />}
        <h3>Adult content</h3>
        <span className={`adult-setting__state${allowed ? ' adult-setting__state--on' : ''}`}>
          {allowed ? 'Shown' : 'Hidden'}
        </span>
      </header>

      <p>
        Some CloudStream extensions publish providers marked <code>NSFW</code>. This setting
        decides whether they are offered in search, source discovery, downloads and the
        extensions list — all of which read it fresh, so a change applies at once.
      </p>

      <div className="adult-setting__modes" role="radiogroup" aria-label="Adult content">
        {MODES.map((entry) => (
          <button
            key={entry.value}
            role="radio"
            aria-checked={mode === entry.value}
            className={`adult-setting__mode${mode === entry.value ? ' adult-setting__mode--on' : ''}`}
            onClick={() => choose(entry.value)}
            disabled={busy}
          >
            <strong>{entry.label}</strong>
            <em>{entry.detail}</em>
          </button>
        ))}
      </div>

      {confirming && (
        <div className="adult-setting__confirm">
          <span>
            {confirming === 'on'
              ? 'Show adult providers in search and the extensions list?'
              : 'Keep adult providers installed, hidden until you ask for them each time?'}
          </span>
          <button className="btn btn-primary" onClick={() => apply(confirming)} disabled={busy}>
            Yes, I am over 18
          </button>
          <button className="btn btn-secondary" onClick={() => setConfirming(null)} disabled={busy}>
            Cancel
          </button>
        </div>
      )}

      {/*
        The reveal, which exists only under `ask`.

        Kept beside the setting rather than offered from the search panel: the
        thing being decided is the same one the radio above decides, and a
        second entry point in a different screen is how a viewer ends up unsure
        which of the two is in force.
      */}
      {mode === 'ask' && !confirming && (
        <div className="adult-setting__session">
          {allowed ? (
            <>
              <span>Adult providers are showing until you close the app.</span>
              <button className="btn btn-secondary btn-sm" onClick={() => reveal(false)} disabled={busy}>
                <EyeOff size={13} /> Hide them again
              </button>
            </>
          ) : (
            <>
              <span>Adult providers are hidden. This launch, and every launch.</span>
              <button className="btn btn-secondary btn-sm" onClick={() => reveal(true)} disabled={busy}>
                <Eye size={13} /> Show for now
              </button>
            </>
          )}
        </div>
      )}

      <p className="adult-setting__current muted">{current.detail}</p>
    </section>
  );
};
