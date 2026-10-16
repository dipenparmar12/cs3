import React, { useState } from 'react';
import { EyeOff, ShieldAlert } from 'lucide-react';
import { InfoHint } from './settings/InfoHint';
import { Button, RadioGroup, Switch } from './ui';
import {
  setAdultAvailability,
  setAdultDoNotAskAgain,
  setAdultVisualBlurred,
  useAdultState,
} from '../utils/useAdultMode';

type StartupChoice = 'ask' | 'skip';

/**
 * Adult content & visual privacy controls (§129.2, §129.7). Shared by Settings
 * and the Extensions screen, so it draws only from the shared adult state.
 */
export const AdultContentSetting: React.FC = () => {
  const { allowed, doNotAskAgain, blurred } = useAdultState();
  const [confirmingEnable, setConfirmingEnable] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    await action();
    setBusy(false);
  };

  const handleSetAvailability = (enable: boolean) => {
    setConfirmingEnable(false);
    return run(() => setAdultAvailability(enable));
  };

  return (
    <section className="adult-setting">
      <header className="adult-setting__head">
        <div className="adult-setting__title-wrap">
          {allowed ? <ShieldAlert size={16} /> : <EyeOff size={16} />}
          <h3>Adult Content &amp; Visual Privacy</h3>
          <InfoHint label="About adult content & visual privacy">
            Controls 18+/NSFW content permissions, visual blurring of posters and artwork, and
            startup confirmation. Sensitive artwork resets to Blurred on every restart.
          </InfoHint>
          <div className="adult-setting__badges">
            <span className={`adult-setting__state${allowed ? ' adult-setting__state--on' : ''}`}>
              {allowed ? (blurred ? 'Enabled · Blurred' : 'Enabled · Visible') : 'Disabled'}
            </span>
            <span className="adult-setting__state">
              {doNotAskAgain ? 'Prompt Off' : 'Ask on Launch'}
            </span>
          </div>
        </div>
      </header>

      <div className="adult-setting__rows">
        <div className="adult-setting__row">
          <div className="adult-setting__row-info">
            <strong>Availability</strong>
            <p>
              Permit 18+/NSFW titles, catalogues, and extensions. Sensitive artwork starts blurred.
            </p>
          </div>
          <div className="adult-setting__row-control">
            <Switch
              checked={allowed}
              disabled={busy}
              label="Adult content availability"
              stateLabel={allowed ? 'Enabled' : 'Disabled'}
              onChange={(next) => {
                if (next) setConfirmingEnable(true);
                else void handleSetAvailability(false);
              }}
            />
          </div>
        </div>

        {confirmingEnable && !allowed && (
          <div className="adult-setting__confirm">
            <span className="adult-setting__confirm-text">
              Enable adult content for this session? Posters and artwork will remain blurred until unblurred.
            </span>
            <div className="adult-setting__confirm-actions">
              <Button size="compact" onClick={() => setConfirmingEnable(false)} disabled={busy}>
                Cancel
              </Button>
              <Button
                size="compact"
                variant="prominent"
                onClick={() => void handleSetAvailability(true)}
                disabled={busy}
              >
                Enable
              </Button>
            </div>
          </div>
        )}

        <div className="adult-setting__row">
          <div className="adult-setting__row-info">
            <strong>Visual Protection</strong>
            <p>
              {allowed
                ? 'Blur sensitive posters, banners, and backdrops. Resets to Blurred on launch.'
                : 'Always active while adult content is disabled.'}
            </p>
          </div>
          <div className="adult-setting__row-control">
            <Switch
              checked={blurred}
              disabled={busy || !allowed}
              label="Visual protection"
              stateLabel={blurred ? 'Blurred' : 'Unblurred'}
              onChange={(next) => void run(() => setAdultVisualBlurred(next))}
            />
          </div>
        </div>

        <div className="adult-setting__row">
          <div className="adult-setting__row-info">
            <strong>Startup Prompt</strong>
            <p>Ask to confirm adult content access each time the application launches.</p>
          </div>
          <div className="adult-setting__row-control">
            <RadioGroup<StartupChoice>
              legend={<span className="sr-only">Startup prompt</span>}
              inline
              disabled={busy}
              value={doNotAskAgain ? 'skip' : 'ask'}
              options={[
                { value: 'ask', label: 'Ask' },
                { value: 'skip', label: "Don't Ask" },
              ]}
              onChange={(choice) => void run(() => setAdultDoNotAskAgain(choice === 'skip'))}
            />
          </div>
        </div>
      </div>
    </section>
  );
};
