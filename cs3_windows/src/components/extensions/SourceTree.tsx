/**
 * What is installed, as the three levels it actually has.
 *
 * repository → extension → provider, and the provider is the selectable leaf.
 * There is no fourth entity in the CloudStream model, so there are no deeper
 * rows to render; what looks like duplication — `Fivemovierulz > Fivemovierulz`
 * — is the ordinary case of an archive registering one provider named after
 * itself.
 *
 * The distinction this view exists to preserve is `enabled` versus
 * `effectivelyEnabled`. A provider greyed out because its repository is off must
 * not look like one the user turned off themselves, or clicking its toggle
 * appears to do nothing. `Toggle` takes a `suppressedReason` for exactly this:
 * the switch keeps showing its own real state and the tooltip names the ancestor
 * responsible.
 */
import React, { useMemo, useState } from 'react';
import { Package, Layers, Radio, Trash2, AlertTriangle, Info } from 'lucide-react';
import {
  Badge,
  Disclosure,
  ExternalLink,
  Toggle,
  TriStateCheckbox,
  type CheckState,
} from './primitives';
import { ProvenancePanel, type Provenance } from './ProvenancePanel';
import { tagLabel, matchesQuery, matchesTags, matchesLanguages } from './useExtensionFilters';
import type { FilterState } from './useExtensionFilters';
import type {
  ProviderTreeExtension,
  ProviderTreeProvider,
  ProviderTreeRepository,
} from '../../types/plugin';

interface SourceTreeProps {
  tree: ProviderTreeRepository[];
  filters: FilterState;
  busy: string | null;
  selected: Set<string>;
  onToggleSelected(name: string): void;
  onRepositoryToggle(id: string, enabled: boolean): void;
  onExtensionToggle(internalName: string, enabled: boolean): void;
  onProviderToggle(name: string, enabled: boolean): void;
  onUninstall(internalName: string): void;
  onRemoveRepository(url: string): void;
}

/**
 * Why a node is silent when it is not its own doing.
 *
 * Returns undefined when the node is simply switched off, which needs no
 * explanation — labelling that case would bury the one that does.
 */
function suppression(
  node: { enabled?: boolean; effectivelyEnabled?: boolean },
  ancestor: string
): string | undefined {
  const own = node.enabled !== false;
  const effective = node.effectivelyEnabled !== false;
  return own && !effective ? `switched off by ${ancestor}` : undefined;
}

function providerMatches(provider: ProviderTreeProvider, filters: FilterState): boolean {
  if (!matchesTags(provider.supportedTypes, filters.tags)) return false;
  if (!matchesLanguages(provider.lang, filters.languages)) return false;
  if (filters.status === 'enabled' && provider.effectivelyEnabled === false) return false;
  if (filters.status === 'disabled' && provider.effectivelyEnabled !== false) return false;
  return matchesQuery(filters.query, provider.name, provider.extensionName);
}

const ProviderRow: React.FC<{
  provider: ProviderTreeProvider;
  busy: string | null;
  selected: boolean;
  onToggleSelected(name: string): void;
  onToggle(name: string, enabled: boolean): void;
}> = ({ provider, busy, selected, onToggleSelected, onToggle }) => {
  const [showDetails, setShowDetails] = useState(false);
  const suppressed = suppression(provider, 'its extension or repository');

  const provenance: Provenance = {
    kind: 'provider',
    title: provider.name,
    chain: [provider.repositoryName, provider.extensionName, provider.name].filter(
      Boolean
    ) as string[],
    language: provider.lang,
    tags: provider.supportedTypes,
    suppressedReason: suppressed,
  };

  return (
    <li className="ext-node ext-node--provider">
      <div className="ext-row__head">
        <TriStateCheckbox
          state={selected ? 'checked' : 'unchecked'}
          onChange={() => onToggleSelected(provider.name)}
          title="Select for a bulk action"
        />
        <Radio size={13} className="ext-node__icon" />
        <div className="ext-row__grow">
          <div className="ext-row__title">
            {provider.name}
            {provider.adult ? <Badge tone="danger">18+</Badge> : null}
          </div>
          <div className="ext-row__subtitle">
            {provider.lang ? <span>{provider.lang}</span> : null}
            <span>{provider.supportedTypes.map(tagLabel).join(', ') || 'no declared types'}</span>
            {suppressed ? <span className="ext-warn">{suppressed}</span> : null}
          </div>
        </div>
        <button
          type="button"
          className="ext-icon-button"
          title="Where this provider came from"
          aria-expanded={showDetails}
          onClick={() => setShowDetails((value) => !value)}
        >
          <Info size={14} />
        </button>
        <Toggle
          on={provider.enabled !== false}
          label={`Ask ${provider.name} when searching`}
          suppressedReason={suppressed}
          disabled={busy === `provider:${provider.name}`}
          onChange={(next) => onToggle(provider.name, next)}
        />
      </div>
      {showDetails ? <ProvenancePanel details={provenance} /> : null}
    </li>
  );
};

const ExtensionRow: React.FC<{
  extension: ProviderTreeExtension;
  filters: FilterState;
  busy: string | null;
  selected: Set<string>;
  onToggleSelected(name: string): void;
  onExtensionToggle(internalName: string, enabled: boolean): void;
  onProviderToggle(name: string, enabled: boolean): void;
  onUninstall(internalName: string): void;
}> = ({
  extension,
  filters,
  busy,
  selected,
  onToggleSelected,
  onExtensionToggle,
  onProviderToggle,
  onUninstall,
}) => {
  const [open, setOpen] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const suppressed = suppression(extension, 'its repository');

  const providers = useMemo(
    () => extension.providers.filter((provider) => providerMatches(provider, filters)),
    [extension.providers, filters]
  );

  /**
   * The checkbox reflects the providers beneath it, not a state of its own.
   *
   * `indeterminate` is the honest answer for a partial selection — collapsing it
   * to checked or unchecked would make the next click do something the user did
   * not ask for.
   */
  const names = providers.map((provider) => provider.name);
  const chosen = names.filter((name) => selected.has(name)).length;
  const state: CheckState =
    chosen === 0 ? 'unchecked' : chosen === names.length ? 'checked' : 'indeterminate';

  const provenance: Provenance = {
    kind: 'extension',
    title: extension.name,
    chain: [extension.repositoryName, extension.name].filter(Boolean) as string[],
    internalName: extension.internalName,
    version: extension.version,
    authors: extension.authors,
    description: extension.description,
    language: extension.language,
    tags: extension.tvTypes,
    fileSize: extension.fileSize,
    problem: extension.unavailableReason,
    suppressedReason: suppressed,
    counts: [{ label: 'Providers', value: String(extension.providers.length) }],
  };

  return (
    <li className="ext-node ext-node--extension">
      <div className="ext-row__head">
        <Disclosure
          open={open}
          hidden={providers.length === 0}
          label={open ? 'Collapse providers' : 'Expand providers'}
          onToggle={() => setOpen((value) => !value)}
        />
        <TriStateCheckbox
          state={state}
          onChange={() => names.forEach(onToggleSelected)}
          title="Select every provider in this extension"
        />
        <Layers size={14} className="ext-node__icon" />
        <div className="ext-row__grow">
          <div className="ext-row__title">
            {extension.name}
            {extension.version ? <Badge>v{extension.version}</Badge> : null}
          </div>
          <div className="ext-row__subtitle">
            <span>
              {extension.providers.length}{' '}
              {extension.providers.length === 1 ? 'provider' : 'providers'}
            </span>
            {extension.language ? <span>{extension.language}</span> : null}
            {/*
              An extension that registered nothing says so, and is never given a
              placeholder provider to stand in for it — a synthesised name no
              provider answers to is what made the search scope picker offer
              sources the main process then dropped.
            */}
            {extension.unavailableReason ? (
              <span className="ext-warn">
                <AlertTriangle size={11} /> {extension.unavailableReason}
              </span>
            ) : null}
            {suppressed ? <span className="ext-warn">{suppressed}</span> : null}
          </div>
        </div>
        <button
          type="button"
          className="ext-icon-button"
          title="Provenance and compatibility"
          aria-expanded={showDetails}
          onClick={() => setShowDetails((value) => !value)}
        >
          <Info size={14} />
        </button>
        <button
          type="button"
          className="ext-icon-button ext-icon-button--danger"
          title="Uninstall this extension and delete its archive"
          disabled={busy === `uninstall:${extension.internalName}`}
          onClick={() => onUninstall(extension.internalName)}
        >
          <Trash2 size={14} />
        </button>
        <Toggle
          on={extension.enabled !== false}
          label="Keep the archive, but stop asking its providers"
          suppressedReason={suppressed}
          disabled={busy === `ext:${extension.internalName}`}
          onChange={(next) => onExtensionToggle(extension.internalName, next)}
        />
      </div>

      {showDetails ? <ProvenancePanel details={provenance} /> : null}

      {open && providers.length > 0 ? (
        <ul className="ext-children">
          {providers.map((provider) => (
            <ProviderRow
              key={provider.id ?? provider.name}
              provider={provider}
              busy={busy}
              selected={selected.has(provider.name)}
              onToggleSelected={onToggleSelected}
              onToggle={onProviderToggle}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
};

export const SourceTree: React.FC<SourceTreeProps> = ({
  tree,
  filters,
  busy,
  selected,
  onToggleSelected,
  onRepositoryToggle,
  onExtensionToggle,
  onProviderToggle,
  onUninstall,
  onRemoveRepository,
}) => {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [details, setDetails] = useState<Record<string, boolean>>({});

  /**
   * A repository survives the filter when anything under it does.
   *
   * Filtering the leaves and keeping every branch would show empty repositories
   * as though they matched; filtering the branches by their own fields would
   * hide a repository whose providers are exactly what was searched for.
   */
  const visible = useMemo(
    () =>
      tree
        .map((repository) => ({
          repository,
          extensions: repository.extensions.filter(
            (extension) =>
              extension.providers.some((provider) => providerMatches(provider, filters)) ||
              matchesQuery(filters.query, extension.name, extension.internalName)
          ),
        }))
        .filter(
          ({ repository, extensions }) =>
            extensions.length > 0 || matchesQuery(filters.query, repository.name, repository.url)
        ),
    [tree, filters]
  );

  if (tree.length === 0) {
    return (
      <p className="ext-empty">
        Nothing installed yet. Open <strong>Repositories</strong> to browse the verified
        catalogue, then install the extensions you want.
      </p>
    );
  }

  if (visible.length === 0) {
    return <p className="ext-empty">Nothing matches those filters.</p>;
  }

  return (
    <ul className="ext-tree">
      {visible.map(({ repository, extensions }) => {
        const key = repository.id ?? repository.url;
        const expanded = open[key] ?? true;
        const providerCount = repository.extensions.reduce(
          (total, extension) => total + extension.providers.length,
          0
        );

        const provenance: Provenance = {
          kind: 'repository',
          title: repository.name,
          chain: [repository.name],
          description: repository.description,
          category: repository.category,
          tags: repository.tvTypes,
          url: repository.url,
          homepageUrl: repository.homepageUrl,
          verified: repository.verified,
          bundled: repository.bundled,
          counts: [
            { label: 'Extensions', value: String(repository.extensions.length) },
            { label: 'Providers', value: String(providerCount) },
          ],
        };

        return (
          <li key={key} className="ext-node ext-node--repository">
            <div className="ext-row__head">
              <Disclosure
                open={expanded}
                label={expanded ? 'Collapse extensions' : 'Expand extensions'}
                onToggle={() => setOpen((current) => ({ ...current, [key]: !expanded }))}
              />
              <Package size={15} className="ext-node__icon" />
              <div className="ext-row__grow">
                <div className="ext-row__title">
                  {repository.name}
                  {/*
                    Bundled repositories are labelled, never hidden, and always
                    removable — the label explains where they came from rather
                    than protecting them.
                  */}
                  {repository.bundled ? <Badge tone="accent">first run</Badge> : null}
                  {repository.verified ? <Badge tone="success">verified</Badge> : null}
                </div>
                <div className="ext-row__subtitle">
                  <span>
                    {repository.extensions.length}{' '}
                    {repository.extensions.length === 1 ? 'extension' : 'extensions'}
                  </span>
                  <span>
                    {providerCount} {providerCount === 1 ? 'provider' : 'providers'}
                  </span>
                  <ExternalLink url={repository.homepageUrl ?? repository.url} />
                </div>
              </div>
              <button
                type="button"
                className="ext-icon-button"
                title="Where this repository came from"
                aria-expanded={details[key] ?? false}
                onClick={() => setDetails((current) => ({ ...current, [key]: !current[key] }))}
              >
                <Info size={14} />
              </button>
              <button
                type="button"
                className="ext-icon-button ext-icon-button--danger"
                title="Remove this repository and uninstall the extensions it installed"
                disabled={busy === `remove:${repository.url}`}
                onClick={() => onRemoveRepository(repository.url)}
              >
                <Trash2 size={14} />
              </button>
              <Toggle
                on={repository.enabled !== false}
                label="Keep everything installed, but stop asking this repository's providers"
                disabled={busy === `repo:${key}`}
                onChange={(next) => onRepositoryToggle(repository.id ?? repository.url, next)}
              />
            </div>

            {details[key] ? <ProvenancePanel details={provenance} /> : null}

            {expanded ? (
              <ul className="ext-children">
                {extensions.map((extension) => (
                  <ExtensionRow
                    key={extension.id ?? extension.internalName}
                    extension={extension}
                    filters={filters}
                    busy={busy}
                    selected={selected}
                    onToggleSelected={onToggleSelected}
                    onExtensionToggle={onExtensionToggle}
                    onProviderToggle={onProviderToggle}
                    onUninstall={onUninstall}
                  />
                ))}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
};
