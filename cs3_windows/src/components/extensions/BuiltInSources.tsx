import React, { useCallback, useEffect, useState } from 'react';
import { Library, Loader2, Plus, Trash2 } from 'lucide-react';
import { Badge, Toggle } from './primitives';
import type { NativeProviderSummary } from '../../types/plugin';

/**
 * The providers compiled into the app, and the one control each of them has.
 *
 * Deliberately its own block above the repository tree rather than a branch
 * inside it. `SourceTree` renders exactly three levels — repository, extension,
 * provider — because that is the CloudStream model, and a built-in provider has
 * none of the first two: nothing downloaded it, nothing can update it, and it
 * has no compatibility tier because it was never translated. Inventing a
 * synthetic "Built-in" repository to give it a place in that tree would put a
 * row in front of the user with an uninstall button that cannot work and a
 * provenance chain that is a fiction.
 *
 * What it does share with that tree is the thing that matters: these providers
 * pass through the same enable cascade and the same adult gate, so switching
 * one off here withdraws it from search, scope, discovery and playback exactly
 * as switching off an extension provider does.
 *
 * `unavailableReason` is rendered rather than folded into the toggle for the
 * reason the tree separates `enabled` from `effectivelyEnabled`: a provider
 * greyed out by the adult gate must not look like one the user turned off, or
 * its switch appears to do nothing.
 */
export const BuiltInSources: React.FC = () => {
  const [providers, setProviders] = useState<NativeProviderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addonUrl, setAddonUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await window.cloudstream!.listNativeProviders();
      if (response.ok) {
        setProviders(response.providers);
        setError(null);
      } else {
        setError(response.error ?? 'The built-in provider list could not be read.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = useCallback(async (id: string, next: boolean) => {
    setBusy(id);
    try {
      const response = await window.cloudstream!.setNativeProviderEnabled(id, next);
      // The whole roster comes back from main, so a write that failed shows up
      // as the switch springing back rather than as a lie on screen.
      if (response.ok) setProviders(response.providers);
      else setError(response.error ?? 'That change could not be saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, []);

  const addAddon = useCallback(async () => {
    const url = addonUrl.trim();
    if (!url) return;
    setAdding(true);
    setError(null);
    setAdded(null);
    try {
      const response = await window.cloudstream!.addStremioAddon(url);
      setProviders(response.providers);
      if (response.ok) {
        setAddonUrl('');
        setAdded('Added. It will be searched alongside everything else.');
      } else {
        // The reason, verbatim — "that address is not an addon" and "already
        // added" need different actions from the person who typed it.
        setError(response.error ?? 'That addon could not be added.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(false);
    }
  }, [addonUrl]);

  const removeAddon = useCallback(async (id: string) => {
    setBusy(id);
    try {
      const response = await window.cloudstream!.removeStremioAddon(id);
      if (response.ok) setProviders(response.providers);
      else setError(response.error ?? 'That addon could not be removed.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, []);

  if (loading) {
    return (
      <section className="ext-builtin">
        <Loader2 size={14} className="spin" /> Loading built-in sources…
      </section>
    );
  }
  if (providers.length === 0 && !error) return null;

  return (
    <section className="ext-builtin">
      <header className="ext-builtin__head">
        <Library size={15} />
        <h3>Built-in sources</h3>
        <span className="ext-builtin__note">
          Ship with the app — nothing to install, and they cannot break on an update.
        </span>
      </header>

      {error ? <p className="ext-builtin__error">{error}</p> : null}

      <ul className="ext-builtin__list">
        {providers.map((provider) => (
          <li key={provider.id} className="ext-builtin__row">
            <div className="ext-builtin__main">
              <div className="ext-builtin__title">
                <strong>{provider.name}</strong>
                {provider.types.slice(0, 3).map((type) => (
                  <Badge key={type} tone="neutral">
                    {type}
                  </Badge>
                ))}
                {provider.adult ? <Badge tone="warning">Adult</Badge> : null}
              </div>
              <p className="ext-builtin__desc">{provider.description}</p>
              {provider.unavailableReason ? (
                <p className="ext-builtin__reason">{provider.unavailableReason}</p>
              ) : null}
            </div>
            <div className="ext-builtin__actions">
              <Toggle
                on={provider.enabled}
                label={`${provider.name} — ${provider.enabled ? 'on' : 'off'}`}
                suppressedReason={provider.unavailableReason}
                disabled={busy === provider.id}
                onChange={(next) => void toggle(provider.id, next)}
              />
              {/* Only an addon can be removed. A built-in has nowhere to go —
                  offering Remove on one would be a button that cannot work. */}
              {provider.id.startsWith('addon:') ? (
                <button
                  type="button"
                  className="ext-builtin__remove"
                  title={`Remove ${provider.name}`}
                  aria-label={`Remove ${provider.name}`}
                  disabled={busy === provider.id}
                  onClick={() => void removeAddon(provider.id)}
                >
                  <Trash2 size={15} />
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      {/*
        Adding an addon is supporting a protocol, not blessing a host: nothing
        is bundled and no default is added, exactly as with a Torznab URL. It is
        also how somebody's existing debrid configuration reaches this app —
        they paste the URL they already have.
      */}
      <div className="ext-builtin__add">
        <label htmlFor="stremio-addon-url">Add a Stremio addon</label>
        <div className="ext-builtin__addrow">
          <input
            id="stremio-addon-url"
            type="url"
            placeholder="https://…/manifest.json"
            value={addonUrl}
            spellCheck={false}
            onChange={(event) => setAddonUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void addAddon();
            }}
          />
          <button type="button" disabled={adding || !addonUrl.trim()} onClick={() => void addAddon()}>
            {adding ? <Loader2 size={14} className="spin" /> : <Plus size={14} />}
            {adding ? 'Checking…' : 'Add'}
          </button>
        </div>
        <p className="ext-builtin__hint">
          The manifest is read and checked before it is saved. Catalogue, metadata, stream and
          subtitle addons all work.
        </p>
        {added ? <p className="ext-builtin__ok">{added}</p> : null}
      </div>
    </section>
  );
};
