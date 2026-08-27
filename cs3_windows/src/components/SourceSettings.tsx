import React, { useCallback, useEffect, useState } from 'react';
import { useFlash } from '../utils/useFlash';
import {
  Plus, Trash2, Loader2, CheckCircle2, XCircle, Radio, Save, RotateCcw,
} from 'lucide-react';
import type {
  IndexerConfig, IndexerHealth, SourcePreferences,
} from '../types/torrent';
import { IndexerKind, Resolution } from '../types/torrent';

/**
 * Settings → Sources.
 *
 * Two things live here because they are the two levers that decide whether the
 * app finds anything: *which* indexers are queried, and *how* results are
 * filtered. Both were previously only reachable by editing the datastore by
 * hand, which meant a user whose indexers were blocked had no way to recover.
 */

const RESOLUTION_OPTIONS: Array<{ value: Resolution; label: string }> = [
  { value: Resolution.UHD_4K, label: '4K (2160p)' },
  { value: Resolution.FHD, label: '1080p' },
  { value: Resolution.HD, label: '720p' },
  { value: Resolution.SD, label: '480p' },
  { value: Resolution.Unknown, label: 'No minimum' },
];

interface TestState {
  running: boolean;
  ok?: boolean;
  message?: string;
}

export const SourceSettings: React.FC = () => {
  const [configs, setConfigs] = useState<IndexerConfig[]>([]);
  const [health, setHealth] = useState<IndexerHealth[]>([]);
  const [prefs, setPrefs] = useState<SourcePreferences | null>(null);
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const { message: status, flash: setStatus } = useFlash<string>(3500);

  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('http://127.0.0.1:9117');
  const [newKey, setNewKey] = useState('');

  const [addonName, setAddonName] = useState('');
  const [addonUrl, setAddonUrl] = useState('');

  const refresh = useCallback(async () => {
    if (!window.cloudstream) return;
    const [c, h, p] = await Promise.all([
      window.cloudstream.getIndexerConfigs(),
      window.cloudstream.getIndexerHealth(),
      window.cloudstream.getSourcePreferences(),
    ]);
    setConfigs(c);
    setHealth(h);
    setPrefs(p);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const flash = (message: string) => {
    setStatus(message);
  };

  const toggleIndexer = async (config: IndexerConfig) => {
    if (!window.cloudstream) return;
    const next = await window.cloudstream.saveIndexerConfig({
      ...config,
      enabled: !config.enabled,
    });
    setConfigs(next);
  };

  const testIndexer = async (config: IndexerConfig) => {
    if (!window.cloudstream) return;
    setTests((t) => ({ ...t, [config.id]: { running: true } }));
    const result = await window.cloudstream.testIndexer(config);
    setTests((t) => ({
      ...t,
      [config.id]: { running: false, ok: result.ok, message: result.message },
    }));
    refresh();
  };

  const removeIndexer = async (id: string) => {
    if (!window.cloudstream) return;
    setConfigs(await window.cloudstream.removeIndexerConfig(id));
    flash('Indexer removed.');
  };

  const addTorznab = async () => {
    if (!window.cloudstream || !newUrl.trim()) return;
    const id = `torznab-${Date.now()}`;
    const config: IndexerConfig = {
      id,
      name: newName.trim() || 'Jackett / Prowlarr',
      kind: IndexerKind.Torznab,
      enabled: true,
      baseUrl: newUrl.trim(),
      apiKey: newKey.trim(),
      indexerSlug: 'all',
    };
    setConfigs(await window.cloudstream.saveIndexerConfig(config));
    setNewName('');
    setNewKey('');
    flash('Indexer added. Test it to confirm it responds.');
    testIndexer(config);
  };

  const addStremioAddon = async () => {
    if (!window.cloudstream || !addonUrl.trim()) return;
    const config: IndexerConfig = {
      id: `stremio-${Date.now()}`,
      name: addonName.trim() || 'Stremio addon',
      kind: IndexerKind.Stremio,
      enabled: true,
      // A manifest URL is what addon sites hand out; the adapter trims it.
      baseUrl: addonUrl.trim(),
    };
    setConfigs(await window.cloudstream.saveIndexerConfig(config));
    setAddonName('');
    setAddonUrl('');
    flash('Addon added. Test it to confirm it responds.');
    testIndexer(config);
  };

  /** Built-ins cannot be removed, only disabled; user-added entries can be deleted. */
  const isUserAdded = (config: IndexerConfig) =>
    config.kind === IndexerKind.Torznab || config.kind === IndexerKind.Stremio;

  const updatePrefs = async (patch: Partial<SourcePreferences>) => {
    if (!window.cloudstream || !prefs) return;
    const next = { ...prefs, ...patch };
    setPrefs(next);
    await window.cloudstream.saveSourcePreferences(patch);
  };

  const healthFor = (id: string) => health.find((h) => h.id === id);

  return (
    <div className="settings-section">
      <h3 className="settings-section__title">
        <Radio size={17} /> Sources
      </h3>
      <p className="settings-section__hint">
        Indexers are searched in parallel and their results are merged and deduplicated.
        The ones enabled by default answer on stable hosts and work on most networks;
        per-site indexers (1337x, BitSearch, TheRARBG, YTS, EZTV, Nyaa) rotate domains and
        are blocked by many ISPs, so they ship disabled — enable them if your connection is
        unfiltered. For full control, run <strong>Jackett</strong> or{' '}
        <strong>Prowlarr</strong> locally and add it below.
      </p>

      <ul className="indexer-list">
        {configs.map((config) => {
          const h = healthFor(config.id);
          const test = tests[config.id];
          return (
            <li key={config.id} className="indexer-row">
              <label className="indexer-row__toggle">
                <input
                  type="checkbox"
                  checked={config.enabled}
                  onChange={() => toggleIndexer(config)}
                />
                <span>
                  <strong>{config.name}</strong>
                  {config.kind === IndexerKind.Torznab && (
                    <span className="badge badge--muted">Torznab</span>
                  )}
                  {config.kind === IndexerKind.Stremio && (
                    <span className="badge badge--muted">Stremio addon</span>
                  )}
                </span>
              </label>

              <div className="indexer-row__status">
                {test?.running && <Loader2 className="spin" size={14} />}
                {!test?.running && test?.ok === true && (
                  <span className="health-strong">
                    <CheckCircle2 size={14} /> {test.message}
                  </span>
                )}
                {!test?.running && test?.ok === false && (
                  <span className="error-text">
                    <XCircle size={14} /> {test.message}
                  </span>
                )}
                {!test && h?.isCircuitOpen && (
                  <span className="error-text">Paused after repeated failures</span>
                )}
                {!test && !h?.isCircuitOpen && h?.lastError && (
                  <span className="muted">Last error: {h.lastError}</span>
                )}
                {!test && h?.lastOk && !h.lastError && (
                  <span className="muted">
                    OK · {h.lastResultCount ?? 0} results · {h.lastLatencyMs ?? 0} ms
                  </span>
                )}
              </div>

              <div className="indexer-row__actions">
                <button className="btn btn-sm" onClick={() => testIndexer(config)}>
                  Test
                </button>
                {isUserAdded(config) && (
                  <button
                    className="icon-button"
                    onClick={() => removeIndexer(config.id)}
                    aria-label={`Remove ${config.name}`}
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="indexer-add">
        <h4>Add a Jackett / Prowlarr indexer</h4>
        <p className="muted">
          One entry reaches every indexer that instance is configured with, and inherits its
          proxy and CAPTCHA handling.
        </p>
        <div className="indexer-add__fields">
          <input
            placeholder="Name (optional)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <input
            placeholder="http://127.0.0.1:9117"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
          />
          <input
            placeholder="API key"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
          />
          <button className="btn btn-primary" onClick={addTorznab}>
            <Plus size={15} /> Add
          </button>
        </div>
      </div>

      <div className="indexer-add">
        <h4>Add a Stremio addon</h4>
        <p className="muted">
          Any Stremio stream addon works — Torrentio with your own tracker selection,
          Jackettio, Comet, a self-hosted MediaFusion, or one configured with a debrid
          account. Paste the addon URL (the manifest URL is fine). Addons are looked up by
          IMDb id, so they only answer for titles with catalogue metadata.
        </p>
        <div className="indexer-add__fields">
          <input
            placeholder="Name (optional)"
            value={addonName}
            onChange={(e) => setAddonName(e.target.value)}
          />
          <input
            placeholder="https://torrentio.strem.fun/providers=yts,eztv"
            value={addonUrl}
            onChange={(e) => setAddonUrl(e.target.value)}
          />
          <button className="btn btn-primary" onClick={addStremioAddon}>
            <Plus size={15} /> Add
          </button>
        </div>
      </div>

      {prefs && (
        <>
          <h3 className="settings-section__title" style={{ marginTop: '1.75rem' }}>
            Ranking &amp; filters
          </h3>
          <p className="settings-section__hint">
            These decide which sources survive and in what order. If searches come back
            empty, loosen the minimum seeders or resolution first.
          </p>

          <div className="pref-grid">
            <label>
              <span>Preferred quality</span>
              <select
                value={prefs.preferredResolution}
                onChange={(e) =>
                  updatePrefs({ preferredResolution: Number(e.target.value) as Resolution })
                }
              >
                {RESOLUTION_OPTIONS.filter((o) => o.value > 0).map((o) => (
                  <option key={o.value} value={o.value} style={{ backgroundColor: '#161b26', color: '#f3f4f6' }}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Minimum quality</span>
              <select
                value={prefs.minResolution}
                onChange={(e) =>
                  updatePrefs({ minResolution: Number(e.target.value) as Resolution })
                }
              >
                {RESOLUTION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value} style={{ backgroundColor: '#161b26', color: '#f3f4f6' }}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Minimum seeders</span>
              <input
                type="number"
                min={0}
                value={prefs.minSeeders}
                onChange={(e) => updatePrefs({ minSeeders: Math.max(0, Number(e.target.value)) })}
              />
            </label>

            <label className="pref-grid__check">
              <input
                type="checkbox"
                checked={prefs.excludeLowQualitySources}
                onChange={(e) => updatePrefs({ excludeLowQualitySources: e.target.checked })}
              />
              <span>
                Hide CAM / TS / screener rips
                <small>Recorded in cinemas — usually unwatchable.</small>
              </span>
            </label>

            <label className="pref-grid__check">
              <input
                type="checkbox"
                checked={prefs.preferH264}
                onChange={(e) => updatePrefs({ preferH264: e.target.checked })}
              />
              <span>
                Prefer H.264 for compatibility
                <small>Enable if HEVC/x265 files fail to play.</small>
              </span>
            </label>

            <label className="pref-grid__check">
              <input
                type="checkbox"
                checked={prefs.preferHDR}
                onChange={(e) => updatePrefs({ preferHDR: e.target.checked })}
              />
              <span>
                Prefer HDR
                <small>Only useful on an HDR-capable display.</small>
              </span>
            </label>
          </div>

          <div className="pref-actions">
            <button
              className="btn"
              onClick={async () => {
                await updatePrefs({
                  minSeeders: 0,
                  minResolution: Resolution.Unknown,
                  excludeLowQualitySources: false,
                });
                flash('Filters loosened — search again.');
              }}
              title="Widen filters when searches return nothing"
            >
              <RotateCcw size={15} /> Loosen all filters
            </button>
            <button className="btn" onClick={refresh}>
              <Save size={15} /> Refresh status
            </button>
          </div>
        </>
      )}

      {status && <div className="toast">{status}</div>}
    </div>
  );
};
