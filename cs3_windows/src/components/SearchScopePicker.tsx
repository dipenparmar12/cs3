import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Filter, Loader2, Minus, Package, Radio } from 'lucide-react';

/**
 * "Search only these providers."
 *
 * This replaces a dropdown that listed torrent indexers, called them providers,
 * and had no effect: the selection was handed to the search callback and
 * dropped on the floor. Worse, indexers are not consulted by search at all —
 * they answer at source-discovery time — so even a wired-up version of that
 * control would have narrowed the wrong stage of the pipeline.
 *
 * The tree shown here is the real one: repository → extension → provider, plus
 * the indexers as their own group, and each level's checkbox is a bulk toggle
 * over its descendants. Selecting nothing means "everything", which is both the
 * default and the only sane reading of an empty filter.
 *
 * The scope is stored in the main process rather than held here, because it has
 * to govern source discovery and refresh too — stages this component is long
 * gone by the time they run.
 */

interface ProviderNode {
  name: string;
  lang?: string;
}

interface ExtensionNode {
  internalName: string;
  name: string;
  language?: string;
  providers: ProviderNode[];
}

interface RepositoryNode {
  url: string;
  name: string;
  extensions: ExtensionNode[];
}

interface IndexerNode {
  id: string;
  name: string;
}

type CheckState = 'on' | 'off' | 'mixed';

interface SearchScopePickerProps {
  /** Bumped by the parent when extensions change, to force a refetch. */
  refreshKey?: number;
}

function stateOf(members: string[], selected: Set<string>): CheckState {
  if (members.length === 0) return 'off';
  const on = members.filter((m) => selected.has(m)).length;
  if (on === 0) return 'off';
  return on === members.length ? 'on' : 'mixed';
}

const Box: React.FC<{ state: CheckState }> = ({ state }) => (
  <span className={`scope__box scope__box--${state}`} aria-hidden>
    {state === 'on' && <Check size={11} strokeWidth={3} />}
    {state === 'mixed' && <Minus size={11} strokeWidth={3} />}
  </span>
);

export const SearchScopePicker: React.FC<SearchScopePickerProps> = ({ refreshKey = 0 }) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [repositories, setRepositories] = useState<RepositoryNode[]>([]);
  const [indexers, setIndexers] = useState<IndexerNode[]>([]);
  const [disabledProviders, setDisabledProviders] = useState<string[]>([]);
  const [providers, setProviders] = useState<Set<string>>(new Set());
  const [chosenIndexers, setChosenIndexers] = useState<Set<string>>(new Set());

  const wrapper = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    if (!window.cloudstream?.getSearchScopeOptions) return;
    setLoading(true);
    const response = await window.cloudstream.getSearchScopeOptions();
    setRepositories(response.repositories ?? []);
    setIndexers(response.indexers ?? []);
    setDisabledProviders(response.disabledProviders ?? []);
    setProviders(new Set(response.scope?.providers ?? []));
    setChosenIndexers(new Set(response.scope?.indexers ?? []));
    setLoading(false);
    setLoaded(true);
  }, []);

  // Deferred until the picker is first opened: building the tree loads every
  // installed extension, which is far too much to do during cold start.
  useEffect(() => {
    if (open && !loaded) void load();
  }, [open, loaded, load]);

  useEffect(() => {
    if (refreshKey > 0) setLoaded(false);
  }, [refreshKey]);

  useEffect(() => {
    if (!open) return;
    const onOutside = (event: PointerEvent) => {
      if (wrapper.current && !wrapper.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onOutside, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const disabled = useMemo(() => new Set(disabledProviders), [disabledProviders]);

  /** Providers switched off in the extensions screen are not offered here. */
  const selectable = useMemo(
    () =>
      repositories.map((repo) => ({
        ...repo,
        extensions: repo.extensions
          .map((ext) => ({
            ...ext,
            providers: ext.providers.filter((p) => !disabled.has(p.name)),
          }))
          .filter((ext) => ext.providers.length > 0),
      })),
    [repositories, disabled]
  );

  const persist = useCallback((nextProviders: Set<string>, nextIndexers: Set<string>) => {
    setProviders(nextProviders);
    setChosenIndexers(nextIndexers);
    void window.cloudstream?.setSearchScope({
      providers: [...nextProviders],
      indexers: [...nextIndexers],
    });
  }, []);

  /** Toggling a group applies the state the group does *not* already have. */
  const toggleGroup = (names: string[], target: Set<string>, isIndexer: boolean) => {
    const next = new Set(target);
    const turnOn = stateOf(names, target) !== 'on';
    for (const name of names) {
      if (turnOn) next.add(name);
      else next.delete(name);
    }
    if (isIndexer) persist(providers, next);
    else persist(next, chosenIndexers);
  };

  const toggleOne = (name: string, target: Set<string>, isIndexer: boolean) => {
    const next = new Set(target);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    if (isIndexer) persist(providers, next);
    else persist(next, chosenIndexers);
  };

  const totalChosen = providers.size + chosenIndexers.size;
  const label =
    totalChosen === 0
      ? 'All sources'
      : totalChosen === 1
        ? [...providers, ...chosenIndexers][0]
        : `${totalChosen} sources`;

  return (
    <div className="scope" ref={wrapper}>
      <button
        className={`btn btn-secondary scope__trigger${totalChosen > 0 ? ' scope__trigger--active' : ''}`}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="true"
        title="Choose which providers and indexers this app searches"
      >
        <Filter size={14} />
        <span className="scope__label">{label}</span>
        <ChevronDown size={14} />
      </button>

      {open && (
        <div className="scope__menu" role="group" aria-label="Search scope">
          <div className="scope__head">
            <span>Search scope</span>
            <button
              className="scope__reset"
              onClick={() => persist(new Set(), new Set())}
              disabled={totalChosen === 0}
            >
              Reset to all
            </button>
          </div>

          <p className="scope__hint">
            Nothing selected searches everything. This also applies when finding
            sources to play or download.
          </p>

          {loading && (
            <div className="scope__loading">
              <Loader2 size={14} className="spin" /> Loading extensions…
            </div>
          )}

          {!loading && selectable.length === 0 && (
            <p className="scope__empty">
              No extension providers are installed. Add a repository in Extensions.
            </p>
          )}

          {selectable.map((repo) => {
            const repoProviders = repo.extensions.flatMap((e) => e.providers.map((p) => p.name));
            return (
              <section key={repo.url || repo.name} className="scope__repo">
                <button
                  className="scope__row scope__row--repo"
                  onClick={() => toggleGroup(repoProviders, providers, false)}
                  title={repo.url || 'Sideloaded extension'}
                >
                  <Box state={stateOf(repoProviders, providers)} />
                  <Package size={13} />
                  <span className="scope__name">{repo.name}</span>
                  <span className="scope__count">{repoProviders.length}</span>
                </button>

                {repo.extensions.map((ext) => {
                  const extProviders = ext.providers.map((p) => p.name);
                  return (
                    <div key={ext.internalName}>
                      <button
                        className="scope__row scope__row--ext"
                        onClick={() => toggleGroup(extProviders, providers, false)}
                      >
                        <Box state={stateOf(extProviders, providers)} />
                        <span className="scope__name">{ext.name}</span>
                        <span className="scope__count">{extProviders.length}</span>
                      </button>

                      {ext.providers.map((provider) => (
                        <button
                          key={provider.name}
                          className="scope__row scope__row--provider"
                          onClick={() => toggleOne(provider.name, providers, false)}
                        >
                          <Box state={providers.has(provider.name) ? 'on' : 'off'} />
                          <span className="scope__name">{provider.name}</span>
                          {provider.lang && (
                            <span className="scope__lang">{provider.lang.toUpperCase()}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  );
                })}
              </section>
            );
          })}

          {indexers.length > 0 && (
            <section className="scope__repo">
              <button
                className="scope__row scope__row--repo"
                onClick={() => toggleGroup(indexers.map((i) => i.id), chosenIndexers, true)}
                title="Torrent indexers are asked when finding something to play, not while searching titles"
              >
                <Box state={stateOf(indexers.map((i) => i.id), chosenIndexers)} />
                <Radio size={13} />
                <span className="scope__name">Torrent indexers</span>
                <span className="scope__count">{indexers.length}</span>
              </button>

              {indexers.map((indexer) => (
                <button
                  key={indexer.id}
                  className="scope__row scope__row--provider"
                  onClick={() => toggleOne(indexer.id, chosenIndexers, true)}
                >
                  <Box state={chosenIndexers.has(indexer.id) ? 'on' : 'off'} />
                  <span className="scope__name">{indexer.name}</span>
                </button>
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  );
};
