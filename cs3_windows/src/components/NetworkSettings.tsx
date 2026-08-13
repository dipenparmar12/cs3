import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, Check, CheckCircle2, Globe, Loader2, RotateCcw, XCircle,
} from 'lucide-react';

/**
 * DNS settings, written for someone who does not know what DNS is.
 *
 * This exists because of one specific, very common failure: an ISP that blocks
 * torrent-site lookups makes every indexer fail at once, and the app has no way
 * to tell that apart from being offline. The test button is the important half
 * — it names which hosts are unreachable, which is what turns "nothing works"
 * into a diagnosis someone can act on.
 *
 * The technical framing stays out of the primary copy. "Private DNS" and a list
 * of provider names is what a viewer can decide about; DoH URI templates are in
 * the details line for the people who want them.
 */

type DnsMode = 'system' | 'automatic' | 'secure';

interface DnsPreset {
  id: string;
  name: string;
  description: string;
  servers: string[];
}

interface Settings {
  dnsMode: DnsMode;
  dnsServers: string[];
}

interface TestResult {
  name: string;
  ok: boolean;
  status?: number;
  latencyMs: number;
  error?: string;
}

export const NetworkSettings: React.FC = () => {
  const [settings, setSettings] = useState<Settings>({ dnsMode: 'system', dnsServers: [] });
  const [presets, setPresets] = useState<DnsPreset[]>([]);
  const [testing, setTesting] = useState(false);
  const [results, setResults] = useState<TestResult[] | null>(null);
  const [custom, setCustom] = useState('');

  useEffect(() => {
    window.cloudstream?.getNetworkSettings?.().then((response) => {
      setSettings(response.settings);
      setPresets(response.presets);
      // Only shown as "custom" when it is not one of the named presets.
      const known = response.presets.some(
        (preset) => preset.servers[0] === response.settings.dnsServers[0]
      );
      if (!known && response.settings.dnsServers[0]) setCustom(response.settings.dnsServers[0]);
    });
  }, []);

  const save = useCallback(async (next: Partial<Settings>) => {
    const applied = await window.cloudstream?.setNetworkSettings?.(next);
    if (applied) setSettings(applied);
    // The previous verdict describes the old resolver, so it stops being true
    // the moment the resolver changes.
    setResults(null);
  }, []);

  const runTest = async () => {
    setTesting(true);
    try {
      const response = await window.cloudstream?.testNetwork?.();
      setResults(response?.results ?? []);
    } finally {
      setTesting(false);
    }
  };

  const activeServer = settings.dnsServers[0] ?? '';
  const usingPrivate = settings.dnsMode !== 'system';
  const blocked = results?.filter((r) => !r.ok) ?? [];

  return (
    <section className="netset">
      <header className="netset__head">
        <div>
          <h3>
            <Globe size={16} /> Connection
          </h3>
          <p>
            If searches keep finding nothing, your internet provider may be
            blocking the sites this app looks in. Changing who resolves those
            addresses usually fixes it.
          </p>
        </div>
        <button className="btn btn-secondary" onClick={runTest} disabled={testing}>
          {testing ? <Loader2 size={14} className="spin" /> : <CheckCircle2 size={14} />}
          <span>{testing ? 'Testing…' : 'Test connection'}</span>
        </button>
      </header>

      {results && (
        <div className={`netset__verdict${blocked.length > 0 ? ' netset__verdict--bad' : ''}`}>
          {blocked.length === 0 ? (
            <p>
              <CheckCircle2 size={14} /> All {results.length} sites reachable. DNS is not your
              problem.
            </p>
          ) : (
            <p>
              <AlertTriangle size={14} /> {blocked.length} of {results.length} sites could not be
              reached
              {!usingPrivate && ' — try turning on private DNS below'}.
            </p>
          )}

          <ul className="netset__results">
            {results.map((result) => (
              <li key={result.name}>
                {result.ok ? (
                  <CheckCircle2 size={12} className="netset__ok" />
                ) : (
                  <XCircle size={12} className="netset__bad" />
                )}
                <span className="netset__host">{result.name}</span>
                <span className="netset__detail">
                  {result.ok ? `${result.status} · ${result.latencyMs} ms` : result.error}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="netset__choices">
        <button
          className={`netset__choice${!usingPrivate ? ' netset__choice--on' : ''}`}
          onClick={() => save({ dnsMode: 'system' })}
        >
          <span className="netset__radio">{!usingPrivate && <Check size={11} strokeWidth={3} />}</span>
          <span>
            <strong>Use my system settings</strong>
            <em>Whatever Windows is already configured to use. The default.</em>
          </span>
        </button>

        {presets.map((preset) => {
          const on = usingPrivate && activeServer === preset.servers[0];
          return (
            <button
              key={preset.id}
              className={`netset__choice${on ? ' netset__choice--on' : ''}`}
              onClick={() => save({ dnsMode: 'automatic', dnsServers: preset.servers })}
            >
              <span className="netset__radio">{on && <Check size={11} strokeWidth={3} />}</span>
              <span>
                <strong>{preset.name}</strong>
                <em>{preset.description}</em>
              </span>
            </button>
          );
        })}
      </div>

      <details className="netset__advanced">
        <summary>Advanced</summary>

        <p className="netset__note">
          These options use <strong>DNS over HTTPS</strong>. The resolver is
          addressed by a URI template, and Chromium&apos;s network stack does the
          resolving — so this covers searching, metadata and provider scraping.
          Torrent peer connections still use the system resolver.
        </p>

        <label className="netset__field">
          <span>Custom DoH server</span>
          <div className="netset__row">
            <input
              type="text"
              value={custom}
              placeholder="https://example.com/dns-query"
              onChange={(event) => setCustom(event.target.value)}
            />
            <button
              className="btn btn-secondary"
              disabled={!custom.trim().startsWith('https://')}
              onClick={() => save({ dnsMode: 'automatic', dnsServers: [custom.trim()] })}
            >
              Use
            </button>
          </div>
        </label>

        <label className="netset__toggle">
          <input
            type="checkbox"
            checked={settings.dnsMode === 'secure'}
            disabled={settings.dnsServers.length === 0}
            onChange={(event) =>
              save({ dnsMode: event.target.checked ? 'secure' : 'automatic' })
            }
          />
          <span>
            <strong>Never fall back to plain DNS</strong>
            <em>
              Strict mode. This is the only setting that actually defeats a
              provider-level block — and the only one that can leave the app
              unable to reach anything if the server above is unavailable.
            </em>
          </span>
        </label>

        <button
          className="btn btn-secondary netset__reset"
          onClick={() => {
            setCustom('');
            void save({ dnsMode: 'system', dnsServers: [] });
          }}
        >
          <RotateCcw size={13} />
          <span>Restore system default</span>
        </button>
      </details>
    </section>
  );
};
