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
 * `effectivelyEnabled`. A provider greyed out because its repository is off
 * must not look like one the user turned off themselves, or clicking its toggle
 * appears to do nothing. Every node therefore shows *which ancestor* is
 * silencing it rather than just showing itself as off.
 */
import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Package,
  Layers,
  Radio,
  Trash2,
  AlertTriangle,
} from 'lucide-react';
import type {
  ProviderTreeExtension,
  ProviderTreeProvider,
  ProviderTreeRepository,
} from '../../types/plugin';

interface SourceTreeProps {
  tree: ProviderTreeRepository[];
  busy: string | null;
  onRepositoryToggle(id: string, enabled: boolean): void;
  onExtensionToggle(internalName: string, enabled: boolean): void;
  onProviderToggle(name: string, enabled: boolean): void;
  onUninstall(internalName: string): void;
  onRemoveRepository(url: string): void;
}

const Toggle: React.FC<{
  checked: boolean;
  disabled?: boolean;
  title: string;
  onChange(next: boolean): void;
}> = ({ checked, disabled, title, onChange }) => (
  <label className="ext-toggle" title={title}>
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
    />
    <span className="ext-toggle__track" aria-hidden="true" />
  </label>
);

/**
 * Says why a node is silent when it is not its own doing.
 *
 * Returning null when the node is simply off is deliberate: "you turned this
 * off" needs no explanation, and labelling it would bury the case that does.
 */
function silencedBy(
  node: { enabled?: boolean; effectivelyEnabled?: boolean },
  ancestor: string
): string | null {
  const own = node.enabled !== false;
  const effective = node.effectivelyEnabled !== false;
  return own && !effective ? `Off because ${ancestor} is off` : null;
}

const ProviderRow: React.FC<{
  provider: ProviderTreeProvider;
  busy: string | null;
  onToggle(name: string, enabled: boolean): void;
}> = ({ provider, busy, onToggle }) => {
  const reason = silencedBy(provider, 'its extension or repository');
  return (
    <li className={`ext-node ext-node--provider${reason ? ' ext-node--inherited' : ''}`}>
      <Radio size={13} className="ext-node__icon" />
      <div className="ext-node__body">
        <span className="ext-node__name">{provider.name}</span>
        <span className="ext-node__meta">
          {provider.lang ? <span className="ext-chip">{provider.lang}</span> : null}
          {provider.supportedTypes.slice(0, 4).map((type) => (
            <span key={type} className="ext-chip ext-chip--type">
              {type}
            </span>
          ))}
          {provider.adult ? <span className="ext-chip ext-chip--adult">18+</span> : null}
        </span>
        {reason ? <span className="ext-node__reason">{reason}</span> : null}
      </div>
      <Toggle
        checked={provider.enabled !== false}
        disabled={busy === `provider:${provider.name}`}
        title={reason ?? 'Ask this provider when searching'}
        onChange={(next) => onToggle(provider.name, next)}
      />
    </li>
  );
};

const ExtensionRow: React.FC<{
  extension: ProviderTreeExtension;
  busy: string | null;
  onExtensionToggle(internalName: string, enabled: boolean): void;
  onProviderToggle(name: string, enabled: boolean): void;
  onUninstall(internalName: string): void;
}> = ({ extension, busy, onExtensionToggle, onProviderToggle, onUninstall }) => {
  const [open, setOpen] = useState(false);
  const reason = silencedBy(extension, 'its repository');

  return (
    <li className={`ext-node ext-node--extension${reason ? ' ext-node--inherited' : ''}`}>
      <div className="ext-node__row">
        <button
          type="button"
          className="ext-node__disclose"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-label={open ? 'Collapse providers' : 'Expand providers'}
        >
          {extension.providers.length > 0 ? (
            open ? (
              <ChevronDown size={14} />
            ) : (
              <ChevronRight size={14} />
            )
          ) : (
            <span className="ext-node__disclose-spacer" />
          )}
        </button>
        <Layers size={14} className="ext-node__icon" />
        <div className="ext-node__body">
          <span className="ext-node__name">{extension.name}</span>
          <span className="ext-node__meta">
            {extension.version ? <span className="ext-chip">v{extension.version}</span> : null}
            <span className="ext-chip">
              {extension.providers.length}{' '}
              {extension.providers.length === 1 ? 'provider' : 'providers'}
            </span>
            {extension.language ? <span className="ext-chip">{extension.language}</span> : null}
          </span>
          {/*
            An extension that registered nothing says so, and is never given a
            placeholder provider to stand in for it — a synthesised name that no
            provider answers to is what made the search scope picker offer
            sources the main process then dropped.
          */}
          {extension.unavailableReason ? (
            <span className="ext-node__reason ext-node__reason--warn">
              <AlertTriangle size={12} /> {extension.unavailableReason}
            </span>
          ) : null}
          {reason ? <span className="ext-node__reason">{reason}</span> : null}
        </div>
        <button
          type="button"
          className="ext-icon-button"
          title="Uninstall this extension and delete its archive"
          disabled={busy === `uninstall:${extension.internalName}`}
          onClick={() => onUninstall(extension.internalName)}
        >
          <Trash2 size={14} />
        </button>
        <Toggle
          checked={extension.enabled !== false}
          disabled={busy === `ext:${extension.internalName}`}
          title={reason ?? 'Keep the archive, but stop asking its providers'}
          onChange={(next) => onExtensionToggle(extension.internalName, next)}
        />
      </div>

      {open && extension.providers.length > 0 ? (
        <ul className="ext-children">
          {extension.providers.map((provider) => (
            <ProviderRow
              key={provider.id ?? provider.name}
              provider={provider}
              busy={busy}
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
  busy,
  onRepositoryToggle,
  onExtensionToggle,
  onProviderToggle,
  onUninstall,
  onRemoveRepository,
}) => {
  const [open, setOpen] = useState<Record<string, boolean>>({});

  if (tree.length === 0) {
    return (
      <p className="ext-empty">
        Nothing installed yet. Open <strong>Repositories</strong> to browse the verified
        catalogue, then install the extensions you want.
      </p>
    );
  }

  return (
    <ul className="ext-tree">
      {tree.map((repository) => {
        const key = repository.id ?? repository.url;
        const expanded = open[key] ?? true;
        const providerCount = repository.extensions.reduce(
          (total, extension) => total + extension.providers.length,
          0
        );

        return (
          <li key={key} className="ext-node ext-node--repository">
            <div className="ext-node__row">
              <button
                type="button"
                className="ext-node__disclose"
                onClick={() => setOpen((current) => ({ ...current, [key]: !expanded }))}
                aria-expanded={expanded}
                aria-label={expanded ? 'Collapse extensions' : 'Expand extensions'}
              >
                {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
              </button>
              <Package size={15} className="ext-node__icon" />
              <div className="ext-node__body">
                <span className="ext-node__name">{repository.name}</span>
                <span className="ext-node__meta">
                  <span className="ext-chip">
                    {repository.extensions.length}{' '}
                    {repository.extensions.length === 1 ? 'extension' : 'extensions'}
                  </span>
                  <span className="ext-chip">
                    {providerCount} {providerCount === 1 ? 'provider' : 'providers'}
                  </span>
                  {/*
                    Bundled repositories are labelled, never hidden, and always
                    removable — the label explains where they came from rather
                    than protecting them.
                  */}
                  {repository.bundled ? (
                    <span className="ext-chip ext-chip--bundled">Installed on first run</span>
                  ) : null}
                </span>
                <span className="ext-node__origin" title={repository.url}>
                  {repository.url}
                </span>
              </div>
              <button
                type="button"
                className="ext-icon-button"
                title="Remove this repository and uninstall the extensions it installed"
                disabled={busy === `remove:${repository.url}`}
                onClick={() => onRemoveRepository(repository.url)}
              >
                <Trash2 size={14} />
              </button>
              <Toggle
                checked={repository.enabled !== false}
                disabled={busy === `repo:${key}`}
                title="Keep everything installed, but stop asking this repository's providers"
                onChange={(next) => onRepositoryToggle(repository.id ?? repository.url, next)}
              />
            </div>

            {expanded ? (
              <ul className="ext-children">
                {repository.extensions.map((extension) => (
                  <ExtensionRow
                    key={extension.id ?? extension.internalName}
                    extension={extension}
                    busy={busy}
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
