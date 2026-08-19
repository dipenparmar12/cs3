import React, { useEffect, useState } from 'react';
import { EyeOff, ShieldAlert } from 'lucide-react';

/**
 * The adult-content opt-in.
 *
 * Off unless the user turns it on, and off again the moment they turn it back —
 * `PluginManager.enabledProviderNames` re-reads the setting on every call, so an
 * NSFW provider stops being offered to search, source discovery and downloads
 * immediately rather than at next launch.
 *
 * Two-step on the way on, one click on the way off. Deliberate: enabling shows
 * material a household member may not expect and is worth a confirmation;
 * disabling is the safe direction and should never be made awkward.
 */
export const AdultContentSetting: React.FC = () => {
  const [enabled, setEnabled] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    window.cloudstream?.getAdultAllowed?.().then((value) => setEnabled(Boolean(value)));
  }, []);

  const apply = async (next: boolean) => {
    setBusy(true);
    const response = await window.cloudstream?.setAdultAllowed?.(next);
    setEnabled(response?.enabled ?? next);
    setConfirming(false);
    setBusy(false);
  };

  return (
    <section className="adult-setting">
      <header>
        {enabled ? <ShieldAlert size={16} /> : <EyeOff size={16} />}
        <h3>Adult content</h3>
        <span className={`adult-setting__state${enabled ? ' adult-setting__state--on' : ''}`}>
          {enabled ? 'Shown' : 'Hidden'}
        </span>
      </header>

      <p>
        Some CloudStream extensions publish providers marked <code>NSFW</code>. While this is
        off they are not installed, not searched, and not listed anywhere in the app — even
        if the repository that carries them is installed for its other providers.
      </p>

      {enabled ? (
        <button className="btn btn-secondary" onClick={() => apply(false)} disabled={busy}>
          Hide adult content
        </button>
      ) : confirming ? (
        <div className="adult-setting__confirm">
          <span>Show adult providers in search and the extensions list?</span>
          <button className="btn btn-primary" onClick={() => apply(true)} disabled={busy}>
            Yes, I am over 18
          </button>
          <button className="btn btn-secondary" onClick={() => setConfirming(false)} disabled={busy}>
            Cancel
          </button>
        </div>
      ) : (
        <button className="btn btn-secondary" onClick={() => setConfirming(true)}>
          Show adult content
        </button>
      )}
    </section>
  );
};
