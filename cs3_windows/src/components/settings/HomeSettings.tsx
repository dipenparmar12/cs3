import React, { useCallback, useEffect, useState } from 'react';
import { useFlash } from '../../utils/useFlash';
import { AlertTriangle, Check, Loader2, RefreshCw } from 'lucide-react';
import { SettingRow } from './SettingRow';

/**
 * Where the home screen's catalogue comes from, and whether it works.
 *
 * The health numbers are on screen rather than behind a diagnostic, for the
 * same reason the provider ranking shows its own: this panel refuses choices —
 * a provider that is not answering cannot be selected — and a control that says
 * no without saying why is one people learn to distrust the first time it is
 * wrong about their connection rather than about the service.
 */

type Health = {
  status: 'healthy' | 'degraded' | 'unavailable' | 'unchecked';
  latencyMs?: number;
  items?: number;
  withArtwork?: number;
  reason?: string;
  needsKey?: boolean;
  checkedAt: number;
};

type Provider = {
  id: string;
  name: string;
  description: string;
  requiresKey: boolean;
  catalogs: string[];
  genres: number;
  selectable: boolean;
  active: boolean;
  health: Health | null;
};

const STATUS_LABEL: Record<Health['status'], string> = {
  healthy: 'Healthy',
  degraded: 'Slow or incomplete',
  unavailable: 'Unavailable',
  unchecked: 'Not checked',
};

const CATALOG_LABEL: Record<string, string> = {
  'popular-movies': 'Popular films',
  'popular-series': 'Popular series',
  'new-movies': 'New releases',
  'new-series': 'New episodes',
  'top-rated': 'Top rated',
  anime: 'Anime',
};

export const HomeSettings: React.FC = () => {
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [selected, setSelected] = useState('');
  const [checking, setChecking] = useState(false);
  const { message, flash: setMessage } = useFlash<{ text: string; bad?: boolean }>(5000);

  const [tmdbKey, setTmdbKey] = useState('');
  const [tmdbKeySet, setTmdbKeySet] = useState(false);
  const [customUrl, setCustomUrl] = useState('');

  const [continueWatching, setContinueWatching] = useState(true);

  const load = useCallback(async (force = false) => {
    setChecking(force);
    const response = await window.cloudstream?.listHomeProviders?.(force);
    if (response?.ok) {
      setProviders(response.providers as Provider[]);
      setSelected(response.selected);
      setTmdbKeySet(response.tmdbKeySet);
      setCustomUrl(response.customUrl);
    } else {
      setProviders([]);
    }
    setChecking(false);
  }, []);

  useEffect(() => {
    void load(false);
    void window.cloudstream?.getContinueWatchingEnabled?.().then((response) => {
      if (response?.ok) setContinueWatching(response.enabled);
    });
  }, [load]);

  const flash = (text: string, bad = false) => {
    setMessage({ text, bad });
  };

  const choose = async (id: string) => {
    const response = await window.cloudstream?.selectHomeProvider?.(id);
    if (response?.ok) {
      setSelected(response.id);
      flash('The home screen will rebuild from that catalogue.');
      void load(false);
    } else {
      // The refusal names the cause. That is the whole reason selecting is
      // gated on a live probe rather than accepted and discovered later.
      flash(response?.error ?? 'That catalogue could not be selected.', true);
    }
  };

  return (
    <>
      <SettingRow
        label="Show Continue watching"
        note={continueWatching ? 'On' : 'Off'}
        hint={
          <>
            Hides the row on the home screen. Nothing is deleted — every watch position
            is kept, so anything you open still resumes where you left off, and turning
            this back on restores the row exactly as it was.
            <br />
            Off means the rows are never assembled at all, not merely hidden: on a shared
            machine that is the point of the setting.
          </>
        }
      >
        <label className="settings__switch">
          <input
            type="checkbox"
            checked={continueWatching}
            onChange={async (event) => {
              const response = await window.cloudstream?.setContinueWatchingEnabled?.(
                event.target.checked
              );
              if (response?.ok) setContinueWatching(response.enabled);
            }}
          />
          <span>{continueWatching ? 'Shown' : 'Hidden'}</span>
        </label>
      </SettingRow>

      <SettingRow
        label="Home catalogue"
        note={providers?.find((p) => p.id === selected)?.name}
        hint={
          <>
            Which service the home screen's rows are built from. The rows adapt to what
            the chosen service publishes — picking one that only ranks anime gives an
            anime home screen rather than five empty headings.
            <br />
            A service that is not answering cannot be selected. It stays listed with the
            reason, because "unavailable" and "does not exist" are different facts.
          </>
        }
      >
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => void load(true)}
          disabled={checking}
        >
          {checking ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
          {checking ? 'Checking…' : 'Check all'}
        </button>
      </SettingRow>

      {message && (
        <p className={`home-settings__message${message.bad ? ' home-settings__message--bad' : ''}`}>
          {message.bad ? <AlertTriangle size={13} /> : <Check size={13} />} {message.text}
        </p>
      )}

      {providers === null ? (
        <p className="muted">
          <Loader2 size={13} className="spin" /> Checking catalogues…
        </p>
      ) : (
        <div className="home-settings__providers">
          {providers.map((provider) => {
            const health = provider.health;
            const status = health?.status ?? 'unchecked';
            return (
              <label
                key={provider.id}
                className={`home-settings__provider home-settings__provider--${status}${
                  provider.id === selected ? ' home-settings__provider--selected' : ''
                }`}
              >
                <input
                  type="radio"
                  name="home-provider"
                  checked={provider.id === selected}
                  disabled={!provider.selectable}
                  onChange={() => void choose(provider.id)}
                />
                <div className="home-settings__provider-body">
                  <div className="home-settings__provider-head">
                    <strong>{provider.name}</strong>
                    <span className={`home-settings__status home-settings__status--${status}`}>
                      {STATUS_LABEL[status]}
                      {health?.latencyMs !== undefined && status !== 'unavailable'
                        ? ` · ${health.latencyMs} ms`
                        : ''}
                    </span>
                  </div>
                  <p className="muted">{provider.description}</p>
                  {health?.reason && (
                    <p className="home-settings__reason">{health.reason}</p>
                  )}
                  <p className="home-settings__catalogs">
                    {provider.catalogs.map((c) => CATALOG_LABEL[c] ?? c).join(' · ')}
                    {provider.genres > 0 ? ` · ${provider.genres} genres` : ''}
                    {/* Item and artwork counts are what "healthy" actually
                        means here: a 200 with five blank cards is not a working
                        catalogue, and this is where that shows. */}
                    {health?.items !== undefined
                      ? ` · ${health.withArtwork ?? 0}/${health.items} with artwork`
                      : ''}
                  </p>
                </div>
              </label>
            );
          })}
        </div>
      )}

      <SettingRow
        label="TMDB API key"
          level="advanced"
        note={tmdbKeySet ? 'Set' : 'Not set'}
        hint={
          <>
            TMDB is the best catalogue of the lot and it cannot be shipped with a key:
            one embedded in a distributed app violates their terms and gets revoked,
            which would break the home screen for everyone at once with no way for any
            individual to fix it. A key you create belongs to you and cannot do that.
            <br />
            Free, from themoviedb.org — Settings → API in your account.
          </>
        }
      >
        <div className="home-settings__field">
          <input
            type="password"
            value={tmdbKey}
            placeholder={tmdbKeySet ? '••••••••' : 'Paste your key'}
            onChange={(event) => setTmdbKey(event.target.value)}
            aria-label="TMDB API key"
          />
          <button
            type="button"
            className="btn btn-sm"
            onClick={async () => {
              const response = await window.cloudstream?.setTmdbKey?.(tmdbKey);
              setTmdbKey('');
              if (response?.ok) {
                flash('Key saved and checked.');
                void load(false);
              } else {
                flash(response?.error ?? 'That key could not be saved.', true);
              }
            }}
          >
            Save
          </button>
        </div>
      </SettingRow>

      <SettingRow
        label="Custom catalogue addon"
          level="advanced"
        note={customUrl ? 'Configured' : 'None'}
        hint={
          <>
            The base URL of any Stremio catalog addon. The protocol is one documented GET
            shape, so an addon that works elsewhere works here without anyone writing an
            adapter — the same bet the indexer layer makes with Torznab.
            <br />
            Example: <code>https://cinemeta-catalogs.strem.io</code>
          </>
        }
      >
        <div className="home-settings__field">
          <input
            type="url"
            value={customUrl}
            placeholder="https://…"
            onChange={(event) => setCustomUrl(event.target.value)}
            aria-label="Custom catalogue addon URL"
          />
          <button
            type="button"
            className="btn btn-sm"
            onClick={async () => {
              const response = await window.cloudstream?.setCustomCatalogUrl?.(customUrl);
              if (response?.ok) {
                flash(customUrl.trim() ? 'Addon saved and checked.' : 'Addon removed.');
                void load(false);
              } else {
                flash(response?.error ?? 'That addon could not be saved.', true);
              }
            }}
          >
            Save
          </button>
        </div>
      </SettingRow>
    </>
  );
};
