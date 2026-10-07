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
import React, { useState } from 'react';
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
import { tagLabel } from './useExtensionFilters';
import { extKey, provKey, type SelectionKey, type VisibleRepository } from './bulkSelection';
import type { ExtensionJob } from './useExtensionJobs';
import type {
  ProviderTreeExtension,
  ProviderTreeProvider,
  ProviderTreeRepository,
} from '../../types/plugin';

interface SourceTreeProps {
  tree: ProviderTreeRepository[];
  /** What the filters leave — computed once by the screen (`filterTree`). */
  visible: VisibleRepository[];
  busy: string | null;
  selected: Set<SelectionKey>;
  /** Selecting an extension selects all of it, whatever the filter shows. */
  onToggleExtension(extension: ProviderTreeExtension): void;
  onToggleProvider(provider: ProviderTreeProvider, extension: ProviderTreeExtension, shown: ProviderTreeProvider[]): void;
  /** The queue's job for an extension, so its row says what is happening to it. */
  jobFor(internalName: string): ExtensionJob | null;
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

const ProviderRow: React.FC<{
  provider: ProviderTreeProvider;
  busy: string | null;
  selected: boolean;
  /** Selected through its extension: shown checked, and clicking it narrows to providers. */
  viaExtension: boolean;
  locked: boolean;
  onToggleSelected(): void;
  onToggle(name: string, enabled: boolean): void;
}> = ({ provider, busy, selected, viaExtension, locked, onToggleSelected, onToggle }) => {
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
          state={selected || viaExtension ? 'checked' : 'unchecked'}
          onChange={onToggleSelected}
          title={viaExtension ? 'Selected with its extension — click to select providers individually' : 'Select for a bulk action'}
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
          disabled={locked || busy === `provider:${provider.name}`}
          onChange={(next) => onToggle(provider.name, next)}
        />
      </div>
      {showDetails ? <ProvenancePanel details={provenance} /> : null}
    </li>
  );
};

const ExtensionRow: React.FC<{
  extension: ProviderTreeExtension;
  /** Its providers the filters leave. */
  providers: ProviderTreeProvider[];
  busy: string | null;
  selected: Set<SelectionKey>;
  job: ExtensionJob | null;
  open?: boolean;
  onToggleOpen?: () => void;
  onToggleExtension(extension: ProviderTreeExtension): void;
  onToggleProvider(provider: ProviderTreeProvider, extension: ProviderTreeExtension, shown: ProviderTreeProvider[]): void;
  onExtensionToggle(internalName: string, enabled: boolean): void;
  onProviderToggle(name: string, enabled: boolean): void;
  onUninstall(internalName: string): void;
}> = ({
  extension,
  providers,
  busy,
  selected,
  job,
  open: openProp,
  onToggleOpen,
  onToggleExtension,
  onToggleProvider,
  onExtensionToggle,
  onProviderToggle,
  onUninstall,
}) => {
  const [localOpen, setLocalOpen] = useState(false);
  const open = openProp !== undefined ? openProp : localOpen;
  const toggleOpen = () => {
    if (onToggleOpen) onToggleOpen();
    else setLocalOpen((value) => !value);
  };
  const [showDetails, setShowDetails] = useState(false);
  const suppressed = suppression(extension, 'its repository');

  /**
   * Checked when the extension itself is selected (what Uninstall acts on);
   * `indeterminate` when only some of its providers are — the honest answer for
   * a partial selection, so the next click does what was asked.
   */
  const extSelected = selected.has(extKey(extension.internalName));
  const chosen = extension.providers.filter((provider) => selected.has(provKey(provider.name))).length;
  const state: CheckState = extSelected ? 'checked' : chosen > 0 ? 'indeterminate' : 'unchecked';
  const active = job && (job.state === 'queued' || job.state === 'running');
  const jobWord: Record<string, string> = {
    install: 'Installing',
    update: 'Updating',
    uninstall: 'Uninstalling',
  };

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
          onToggle={toggleOpen}
        />
        <TriStateCheckbox
          state={state}
          onChange={() => onToggleExtension(extension)}
          title="Select this extension (and every provider it adds)"
        />
        <Layers size={14} className="ext-node__icon" />
        <div className="ext-row__grow">
          <div className="ext-row__title">
            {extension.name}
            {extension.version ? <Badge>v{extension.version}</Badge> : null}
            {extension.enabled === false ? <Badge tone="neutral">Off</Badge> : null}
            {active ? (
              <Badge tone="accent" title={job?.step}>
                {job?.state === 'queued' ? 'Queued' : `${jobWord[job!.kind] ?? 'Working'}…`}
              </Badge>
            ) : job?.state === 'failed' ? (
              <Badge tone="danger" title={job.message}>
                {job.kind === 'uninstall' ? 'Uninstall failed' : 'Failed'}
              </Badge>
            ) : null}
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
          title="Uninstall this add-on and delete the files it downloaded"
          disabled={Boolean(active)}
          onClick={() => onUninstall(extension.internalName)}
        >
          <Trash2 size={14} />
        </button>
        <Toggle
          on={extension.enabled !== false}
          label="Keep it installed, but stop using the sources it adds"
          suppressedReason={suppressed}
          disabled={Boolean(active) || busy === `ext:${extension.internalName}`}
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
              selected={selected.has(provKey(provider.name))}
              viaExtension={extSelected}
              locked={Boolean(active)}
              onToggleSelected={() => onToggleProvider(provider, extension, providers)}
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
  visible,
  busy,
  selected,
  onToggleExtension,
  onToggleProvider,
  jobFor,
  onRepositoryToggle,
  onExtensionToggle,
  onProviderToggle,
  onUninstall,
  onRemoveRepository,
}) => {
  const [openRepos, setOpenRepos] = useState<Record<string, boolean>>({});
  const [openExtensions, setOpenExtensions] = useState<Record<string, boolean>>({});
  const [details, setDetails] = useState<Record<string, boolean>>({});

  const collapseAll = () => {
    setOpenRepos({});
    setOpenExtensions({});
  };

  const expandRepositories = () => {
    const nextRepos: Record<string, boolean> = {};
    for (const { repository } of visible) {
      nextRepos[repository.id ?? repository.url] = true;
    }
    setOpenRepos(nextRepos);
    setOpenExtensions({});
  };

  const expandAllWithProviders = () => {
    const nextRepos: Record<string, boolean> = {};
    const nextExts: Record<string, boolean> = {};
    for (const { repository, extensions } of visible) {
      nextRepos[repository.id ?? repository.url] = true;
      for (const { extension: ext } of extensions) {
        nextExts[ext.id ?? ext.internalName] = true;
      }
    }
    setOpenRepos(nextRepos);
    setOpenExtensions(nextExts);
  };

  const toggleExtension = (extKey: string) => {
    setOpenExtensions((current) => ({
      ...current,
      [extKey]: !(current[extKey] ?? false),
    }));
  };

  if (tree.length === 0) {
    return (
      <p className="ext-empty">
        Nothing installed yet. Open <strong>Browse</strong> to pick from the verified catalogue —
        you can install several at once.
      </p>
    );
  }

  if (visible.length === 0) {
    return <p className="ext-empty">Nothing matches those filters.</p>;
  }

  return (
    <div className="ext-tree-container">
      <div className="ext-tree-toolbar">
        <span className="ext-tree-toolbar__count">
          <strong>{visible.length}</strong> {visible.length === 1 ? 'repository' : 'repositories'} installed
        </span>
        <div className="ext-tree-toolbar__actions">
          <button
            type="button"
            className="ext-btn"
            title="Collapse all repositories and providers"
            onClick={collapseAll}
          >
            Collapse all
          </button>
          <button
            type="button"
            className="ext-btn"
            title="Expand all repositories (Level 1)"
            onClick={expandRepositories}
          >
            Expand repositories
          </button>
          <button
            type="button"
            className="ext-btn ext-btn--accent"
            title="Expand all repositories and all providers (Level 2)"
            onClick={expandAllWithProviders}
          >
            Expand all (+ providers)
          </button>
        </div>
      </div>

      <ul className="ext-tree">
        {visible.map(({ repository, extensions }) => {
          const key = repository.id ?? repository.url;
          // By default, repositories are collapsed
          const expanded = openRepos[key] ?? false;
          const providerCount = repository.extensions.reduce(
            (total, extension) => total + extension.providers.length,
            0
          );

          const areAllRepoExtsOpen =
            extensions.length > 0 &&
            extensions.every(({ extension: ext }) => openExtensions[ext.id ?? ext.internalName]);

          const toggleAllRepoExts = () => {
            const target = !areAllRepoExtsOpen;
            setOpenExtensions((current) => {
              const next = { ...current };
              for (const { extension: ext } of extensions) {
                next[ext.id ?? ext.internalName] = target;
              }
              return next;
            });
          };

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
                  onToggle={() => setOpenRepos((current) => ({ ...current, [key]: !expanded }))}
                />
                <Package size={15} className="ext-node__icon" />
                <div className="ext-row__grow">
                  <div className="ext-row__title">
                    {repository.name}
                    {repository.category ? <Badge tone="neutral">{repository.category}</Badge> : null}
                    {repository.language ? <span className="ext-chip">{repository.language}</span> : null}
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
                {expanded && extensions.length > 0 ? (
                  <button
                    type="button"
                    className="ext-btn ext-btn--sm"
                    title={areAllRepoExtsOpen ? 'Collapse all providers' : 'Expand all providers'}
                    onClick={toggleAllRepoExts}
                  >
                    {areAllRepoExtsOpen ? 'Collapse providers' : 'Expand providers'}
                  </button>
                ) : null}
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
                  {extensions.map(({ extension, providers }) => (
                    <ExtensionRow
                      key={extension.id ?? extension.internalName}
                      extension={extension}
                      providers={providers}
                      busy={busy}
                      selected={selected}
                      job={jobFor(extension.internalName)}
                      open={openExtensions[extension.id ?? extension.internalName] ?? false}
                      onToggleOpen={() => toggleExtension(extension.id ?? extension.internalName)}
                      onToggleExtension={onToggleExtension}
                      onToggleProvider={onToggleProvider}
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
    </div>
  );
};
