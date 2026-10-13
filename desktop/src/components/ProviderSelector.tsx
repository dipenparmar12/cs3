import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Search, ChevronDown, ChevronRight, Loader2, Check, Minus,
  Package, Globe, RefreshCw, X,
} from 'lucide-react';
import type { ExtensionProvider } from '../../electron/pluginManager';

/**
 * Hierarchical provider selection with global search.
 *
 * One `.cs3` extension commonly registers several providers — a "mega repo"
 * archive may supply half a dozen independent sites — and until now the app
 * treated an extension as a single on/off unit. That is the wrong granularity:
 * a user who wants one site out of six had to accept all six searching on every
 * query, which is slower and noisier for no benefit.
 *
 * The tree is `extension → provider`, and search filters across both levels at
 * once. Matching an extension keeps all its providers visible; matching a
 * provider keeps its extension visible as a header. Filtering the hierarchy
 * rather than flattening it is what preserves the "select all under here"
 * action while a filter is active.
 */

interface ProviderSelectorProps {
  /** Rendered inline in the extension manager rather than as a dialog. */
  compact?: boolean;
}

type TriState = 'all' | 'none' | 'some';

export const ProviderSelector: React.FC<ProviderSelectorProps> = ({ compact = false }) => {
  const [providers, setProviders] = useState<ExtensionProvider[]>([]);
  const [disabled, setDisabled] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const response = await window.cloudstream?.getExtensionProviders();
    setLoading(false);

    if (!response?.ok) {
      setError(response?.error ?? 'Could not read the installed providers.');
      return;
    }
    setProviders(response.providers);
    setDisabled(new Set(response.disabled));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Groups providers under the extension that registered them. */
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const map = new Map<string, { pluginName: string; providers: ExtensionProvider[] }>();

    for (const provider of providers) {
      // An extension matching by name keeps all of its providers listed —
      // searching "MegaRepo" should show what MegaRepo actually contains.
      const extensionMatches =
        !needle || provider.pluginName.toLowerCase().includes(needle);
      const providerMatches =
        !needle ||
        provider.name.toLowerCase().includes(needle) ||
        (provider.mainUrl ?? '').toLowerCase().includes(needle) ||
        (provider.lang ?? '').toLowerCase().includes(needle) ||
        provider.supportedTypes.some((t) => t.toLowerCase().includes(needle));

      if (!extensionMatches && !providerMatches) continue;

      const group = map.get(provider.pluginInternalName) ?? {
        pluginName: provider.pluginName,
        providers: [],
      };
      group.providers.push(provider);
      map.set(provider.pluginInternalName, group);
    }

    return [...map.entries()].sort((a, b) => a[1].pluginName.localeCompare(b[1].pluginName));
  }, [providers, query]);

  const stateOf = useCallback(
    (list: ExtensionProvider[]): TriState => {
      const on = list.filter((p) => !disabled.has(p.name)).length;
      if (on === 0) return 'none';
      if (on === list.length) return 'all';
      return 'some';
    },
    [disabled]
  );

  const toggleMany = useCallback(async (list: ExtensionProvider[], enabled: boolean) => {
    const names = list.map((p) => p.name);
    const next = await window.cloudstream?.setProvidersEnabled(names, enabled);
    if (next) setDisabled(new Set(next));
  }, []);

  const enabledCount = providers.length - disabled.size;
  const visibleProviders = groups.flatMap(([, group]) => group.providers);

  return (
    <section className={`provider-selector${compact ? ' provider-selector--compact' : ''}`}>
      <header className="provider-selector__head">
        <div>
          <h3>Providers</h3>
          <p className="muted">
            {loading
              ? 'Loading extensions…'
              : `${enabledCount} of ${providers.length} enabled for search`}
          </p>
        </div>
        <button className="btn btn-sm" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="spin" size={14} /> : <RefreshCw size={14} />}
          Reload
        </button>
      </header>

      <div className="provider-selector__search">
        <Search size={15} />
        <input
          type="text"
          placeholder="Search repositories, extensions and providers…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button onClick={() => setQuery('')} aria-label="Clear search">
            <X size={14} />
          </button>
        )}
      </div>

      {/* With a filter active these act on what is visible, which is the point:
          searching "anime" then pressing Enable all is the fast path. */}
      {visibleProviders.length > 0 && (
        <div className="provider-selector__bulk">
          <button className="btn btn-sm" onClick={() => toggleMany(visibleProviders, true)}>
            Enable {query ? 'matching' : 'all'}
          </button>
          <button className="btn btn-sm" onClick={() => toggleMany(visibleProviders, false)}>
            Disable {query ? 'matching' : 'all'}
          </button>
        </div>
      )}

      {error && <p className="provider-selector__error">{error}</p>}

      {!loading && providers.length === 0 && !error && (
        <p className="muted provider-selector__empty">
          No providers are registered yet. Install an extension from a repository,
          then reload — providers are only known once an extension has loaded.
        </p>
      )}

      {!loading && providers.length > 0 && groups.length === 0 && (
        <p className="muted provider-selector__empty">Nothing matches “{query}”.</p>
      )}

      <ul className="provider-tree">
        {groups.map(([internalName, group]) => {
          const state = stateOf(group.providers);
          // A search should reveal what it matched, not hide it behind a chevron.
          const isCollapsed = collapsed.has(internalName) && !query;

          return (
            <li key={internalName} className="provider-tree__group">
              <div className="provider-tree__parent">
                <button
                  className="provider-tree__chevron"
                  onClick={() =>
                    setCollapsed((prev) => {
                      const next = new Set(prev);
                      if (next.has(internalName)) next.delete(internalName);
                      else next.add(internalName);
                      return next;
                    })
                  }
                  aria-label={isCollapsed ? 'Expand' : 'Collapse'}
                  disabled={Boolean(query)}
                >
                  {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                </button>

                <button
                  className={`provider-tree__check provider-tree__check--${state}`}
                  onClick={() => toggleMany(group.providers, state !== 'all')}
                  aria-label={`${state === 'all' ? 'Disable' : 'Enable'} all in ${group.pluginName}`}
                >
                  {state === 'all' && <Check size={12} />}
                  {state === 'some' && <Minus size={12} />}
                </button>

                <Package size={14} className="provider-tree__icon" />
                <span className="provider-tree__name">{group.pluginName}</span>
                <span className="provider-tree__count">
                  {group.providers.filter((p) => !disabled.has(p.name)).length}/
                  {group.providers.length}
                </span>
              </div>

              {!isCollapsed && (
                <ul className="provider-tree__children">
                  {group.providers.map((provider) => {
                    const on = !disabled.has(provider.name);
                    return (
                      <li key={provider.name}>
                        <button
                          className="provider-tree__child"
                          onClick={async () => {
                            const next = await window.cloudstream?.setProviderEnabled(
                              provider.name,
                              !on
                            );
                            if (next) setDisabled(new Set(next));
                          }}
                        >
                          <span
                            className={`provider-tree__check provider-tree__check--${
                              on ? 'all' : 'none'
                            }`}
                          >
                            {on && <Check size={12} />}
                          </span>
                          <Globe size={13} className="provider-tree__icon" />
                          <span className="provider-tree__name">{provider.name}</span>
                          {provider.lang && (
                            <span className="provider-tree__tag">
                              {provider.lang.toUpperCase()}
                            </span>
                          )}
                          {provider.supportedTypes.slice(0, 2).map((type) => (
                            <span key={type} className="provider-tree__tag">
                              {type}
                            </span>
                          ))}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
};
