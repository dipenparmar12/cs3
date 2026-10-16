import React, { useState } from 'react';
import { Bell, BellOff, EyeOff, ShieldAlert } from 'lucide-react';
import { InfoHint } from './settings/InfoHint';
import { Button, Switch } from './ui';
import {
  setAdultAvailability,
  setAdultDoNotAskAgain,
  setAdultVisualBlurred,
  useAdultState,
} from '../utils/useAdultMode';

/**
 * Redesigned adult content & privacy controls (§129.2, §129.7).
 *
 * Clearly separates three independent concerns:
 * 1. Adult content availability (whether 18+/NSFW content and providers are permitted).
 * 2. Visual privacy state for the current session (Blurred vs Unblurred artwork; never persisted).
 * 3. Startup confirmation preference (Ask on Every Launch vs Do Not Ask Again).
 */
export const AdultContentSetting: React.FC = () => {
  const { allowed, savedEnabled, doNotAskAgain, blurred } = useAdultState();
  const [confirmingEnable, setConfirmingEnable] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleSetAvailability = async (enable: boolean) => {
    setBusy(true);
    await setAdultAvailability(enable);
    setConfirmingEnable(false);
    setBusy(false);
  };

  const handleSetBlurred = async (nextBlurred: boolean) => {
    if (!allowed) return;
    setBusy(true);
    await setAdultVisualBlurred(nextBlurred);
    setBusy(false);
  };

  const handleSetDoNotAskAgain = async (suppress: boolean) => {
    setBusy(true);
    await setAdultDoNotAskAgain(suppress);
    setBusy(false);
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
            <span
              className={`adult-setting__state${
                allowed ? ' adult-setting__state--on' : ''
              }`}
            >
              {allowed ? (blurred ? 'Enabled · Blurred' : 'Enabled · Visible') : 'Disabled'}
            </span>
            <span className="adult-setting__state">
              {doNotAskAgain ? 'Prompt Off' : 'Ask on Launch'}
            </span>
          </div>
        </div>
      </header>

      <div className="adult-setting__rows">
        {/* 1. Adult Content Availability */}
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
              label="Adult Content Availability"
              stateLabel={allowed ? 'Enabled' : 'Disabled'}
              onChange={(next) => {
                if (next) {
                  setConfirmingEnable(true);
                } else {
                  setConfirmingEnable(false);
                  void handleSetAvailability(false);
                }
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
              <Button
                size="compact"
                variant="default"
                onClick={() => setConfirmingEnable(false)}
                disabled={busy}
              >
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

        {/* 2. Visual Privacy / Blur State (Session Only) */}
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
              label="Visual Protection"
              stateLabel={blurred ? 'Blurred' : 'Unblurred'}
              onChange={(next) => void handleSetBlurred(next)}
            />
          </div>
        </div>

        {/* 3. Startup Confirmation Preference */}
        <div className="adult-setting__row">
          <div className="adult-setting__row-info">
            <strong>Startup Prompt</strong>
            <p>
              {doNotAskAgain
                ? `Suppressed. Launches with saved state (${savedEnabled ? 'Enabled, Blurred' : 'Disabled'}).`
                : 'Ask to confirm visual presentation (Blur vs Unblur) each time the application launches.'}
            </p>
          </div>
          <div
            className="adult-setting__seg"
            role="group"
            aria-label="Startup Confirmation Preference"
          >
            <button
              type="button"
              className={`adult-setting__seg-btn${!doNotAskAgain ? ' adult-setting__seg-btn--active' : ''}`}
              onClick={() => void handleSetDoNotAskAgain(false)}
              disabled={busy}
            >
              <Bell size={13} />
              Ask
            </button>
            <button
              type="button"
              className={`adult-setting__seg-btn${doNotAskAgain ? ' adult-setting__seg-btn--active' : ''}`}
              onClick={() => void handleSetDoNotAskAgain(true)}
              disabled={busy}
            >
              <BellOff size={13} />
              Don't Ask
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};

