/**
 * "Uninstall 3 extensions?" — what a bulk action will do, before it does it.
 *
 * Grouped repository → extension → providers, because that is the relationship
 * a person needs to see to judge the consequence: uninstalling one extension
 * can take five providers with it. Anything the action will *not* touch is
 * said too — items a job is busy with, providers that cannot be uninstalled on
 * their own, selections the filter is hiding — so nothing is silently skipped.
 *
 * The one real dependency the app has is checked live: a provider named in the
 * current search selection or in a saved search profile. Removing it does not
 * break those, but they will report it as missing, and that is worth knowing
 * before rather than after.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Power, PowerOff, Trash2 } from 'lucide-react';
import { Dialog, DialogActions } from '../ui/Dialog';
import { Button } from '../ui/Button';
import type { BulkPlan, ExtensionRef, ProviderRef } from './bulkSelection';

export type BulkVerb = 'uninstall' | 'disable' | 'enable';

interface Props {
  verb: BulkVerb;
  plan: BulkPlan;
  onConfirm: () => void;
  onCancel: () => void;
}

const VERB: Record<BulkVerb, { title: string; button: string; icon: React.ReactNode; danger: boolean }> = {
  uninstall: { title: 'Uninstall', button: 'Uninstall', icon: <Trash2 size={18} />, danger: true },
  disable: { title: 'Disable', button: 'Disable', icon: <PowerOff size={18} />, danger: true },
  enable: { title: 'Enable', button: 'Enable', icon: <Power size={18} />, danger: false },
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Providers named by the current search selection or a saved profile. */
function useProviderReferences(): Map<string, string[]> {
  const [refs, setRefs] = useState<Map<string, string[]>>(new Map());
  useEffect(() => {
    let alive = true;
    void (async () => {
      const map = new Map<string, string[]>();
      const add = (provider: string, where: string) => map.set(provider, [...(map.get(provider) ?? []), where]);
      try {
        const options = await window.cloudstream?.getSearchScopeOptions?.(false);
        for (const name of options?.scope?.providers ?? []) add(name, 'your current search selection');
        const profiles = await window.cloudstream?.listSourceProfiles?.();
        for (const profile of profiles?.profiles ?? []) {
          for (const name of profile.providers) add(name, `the “${profile.name}” profile`);
        }
      } catch {
        // Unknown references are not shown; the action itself is unaffected.
      }
      if (alive) setRefs(map);
    })();
    return () => {
      alive = false;
    };
  }, []);
  return refs;
}

export const BulkConfirmDialog: React.FC<Props> = ({ verb, plan, onConfirm, onCancel }) => {
  const words = VERB[verb];
  const references = useProviderReferences();
  const part: { extensions: ExtensionRef[]; providers: ProviderRef[] } =
    verb === 'uninstall' ? { extensions: plan.uninstall, providers: [] } : plan[verb];

  const groups = useMemo(() => {
    const byRepo = new Map<string, { extensions: ExtensionRef[]; providers: ProviderRef[] }>();
    const bucket = (repo = 'Unknown repository') => {
      if (!byRepo.has(repo)) byRepo.set(repo, { extensions: [], providers: [] });
      return byRepo.get(repo)!;
    };
    for (const extension of part.extensions) bucket(extension.repositoryName).extensions.push(extension);
    for (const provider of part.providers) bucket(provider.repositoryName).providers.push(provider);
    return [...byRepo.entries()];
  }, [part]);

  const affectedProviders = [
    ...part.extensions.flatMap((extension) => extension.providers),
    ...part.providers.map((provider) => provider.name),
  ];
  const referenced = affectedProviders
    .map((name) => ({ name, where: references.get(name) ?? [] }))
    .filter((entry) => entry.where.length > 0);

  const summary = [
    part.extensions.length ? plural(part.extensions.length, 'extension') : null,
    part.providers.length ? plural(part.providers.length, 'provider') : null,
  ]
    .filter(Boolean)
    .join(' and ');

  const consequence =
    verb === 'uninstall'
      ? `${plural(affectedProviders.length, 'provider')} will no longer be available. Their archives are deleted; you can install them again from Browse.`
      : verb === 'disable'
        ? `${plural(affectedProviders.length, 'provider')} will stop being searched. Everything stays installed and can be switched back on.`
        : `${plural(affectedProviders.length, 'provider')} will be searched again.`;

  return (
    <Dialog
      title={`${words.title} ${summary}?`}
      description={consequence}
      icon={words.icon}
      tone={words.danger ? 'danger' : 'default'}
      size="md"
      onClose={onCancel}
      initialFocus={words.danger ? '[data-autofocus="cancel"]' : '[data-autofocus="confirm"]'}
      footer={
        <DialogActions>
          <Button onClick={onCancel} data-autofocus="cancel">
            Cancel
          </Button>
          <Button
            variant={words.danger ? 'destructive' : 'prominent'}
            onClick={onConfirm}
            data-autofocus="confirm"
          >
            {words.button} {summary}
          </Button>
        </DialogActions>
      }
    >
      <ul className="bulk-confirm__groups">
        {groups.map(([repository, group]) => (
          <li key={repository}>
            <span className="bulk-confirm__repo">{repository}</span>
            <ul>
              {group.extensions.map((extension) => (
                <li key={extension.internalName}>
                  <strong>{extension.name}</strong>
                  <span className="bulk-confirm__providers">
                    {extension.providers.length === 0
                      ? 'registers no providers'
                      : `└ ${plural(extension.providers.length, 'provider')}: ${extension.providers.join(', ')}`}
                  </span>
                </li>
              ))}
              {group.providers.map((provider) => (
                <li key={provider.name}>
                  <strong>{provider.name}</strong>
                  <span className="bulk-confirm__providers">provider from {provider.extensionName}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>

      {referenced.length > 0 && (
        <p className="bulk-confirm__note bulk-confirm__note--warn">
          <AlertTriangle size={13} />
          <span>
            {referenced.map((entry) => `${entry.name} (in ${entry.where.join(', ')})`).join('; ')}
            {referenced.length === 1 ? ' is' : ' are'} named in a search selection. Searches will report{' '}
            {referenced.length === 1 ? 'it' : 'them'} as {verb === 'uninstall' ? 'missing' : 'switched off'}.
          </span>
        </p>
      )}

      {verb === 'uninstall' && plan.notUninstallable.length > 0 && (
        <p className="bulk-confirm__note">
          Not included: {plan.notUninstallable.map((provider) => provider.name).join(', ')} —{' '}
          {plan.notUninstallable.length === 1 ? 'a provider is' : 'providers are'} uninstalled with{' '}
          {plan.notUninstallable.length === 1 ? 'its' : 'their'} extension. Select the extension, or disable{' '}
          {plan.notUninstallable.length === 1 ? 'it' : 'them'} instead.
        </p>
      )}
      {plan.busy.length > 0 && (
        <p className="bulk-confirm__note">
          Not included while busy: {plan.busy.map((entry) => `${entry.name} (${entry.reason})`).join(', ')}.
        </p>
      )}
      {plan.hidden > 0 && (
        <p className="bulk-confirm__note">
          Not included: {plural(plan.hidden, 'selected item')} hidden by the current search or filters.
        </p>
      )}
    </Dialog>
  );
};
