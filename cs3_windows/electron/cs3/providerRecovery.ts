/**
 * Making a provider that a saved page names actually answer again.
 *
 * The reported failure: after restoring a backup, opening a title says *"This
 * media was retrieved from the Netflix extension, which is currently switched
 * off"*, offers a button, and the button does nothing. It was not one bug.
 *
 * **The button only ever fixed one third of the cascade.** A provider answers
 * when *it*, its extension, its repository and the adult gate all allow it —
 * `PluginManager.enabledProviderNames` enforces exactly that. The handler
 * called `setProviderEnabled(name, true)`, which removes the name from the
 * disabled *providers* list and touches neither of the other two. So on the
 * common post-restore state — the repository switched off, or the extension
 * switched off — it completed successfully and changed nothing observable.
 *
 * **And on a fresh machine there was nothing to enable.** The archives are not
 * in a backup: they are hundreds of megabytes that re-download. So the ordinary
 * case after moving to a new computer is that the extension is not installed at
 * all, and `setProviderEnabled` on a name no record mentions is a no-op that
 * cannot report itself as one — the disabled list simply does not contain the
 * name, which is indistinguishable from having just removed it.
 *
 * ## A plan, then an execution
 *
 * `planRecovery` is pure and returns the ordered steps. That split is not
 * tidiness: the steps are a repository fetch and a DEX translation, so the user
 * has to be told what pressing the button will do *before* it starts, and a
 * plan that can be rendered is the only way to say it. It is also the half
 * worth testing — every wrong answer here is a button that runs, reports
 * success, and leaves the provider exactly as unreachable as it was.
 *
 * ## What it will not do
 *
 * It never adds a repository the app has not been told about. The URL comes
 * from the installed list, the restored plugin catalogue, or the provider's own
 * origin record — never from the address being opened. `cs3ext://` URLs are
 * built from provider names and travel in library rows and bookmarks, and a
 * recovery that accepted a URL out of one would turn "reopen my saved page"
 * into a way to make the app install code from anywhere. That is the rule
 * `ott:installSuggestion` already follows, and for the same reason.
 */

/** What is standing between a provider name and a working scrape. */
export type RecoveryStepKind =
  | 'add-repository'
  | 'install-extension'
  | 'enable-repository'
  | 'enable-extension'
  | 'enable-provider';

export interface RecoveryStep {
  kind: RecoveryStepKind;
  /** What this step acts on: a repository URL, an internal name, or a provider. */
  target: string;
  /** Shown to the user before they commit to it. */
  label: string;
  /**
   * Whether this step goes to the network and takes real time. The panel says
   * so, because installing an extension over a slow connection is a minute of
   * apparent hang if nothing warned about it.
   */
  costly?: boolean;
}

export interface RecoveryPlan {
  provider: string;
  /** Empty when the provider should already work — see `blocked`. */
  steps: RecoveryStep[];
  /**
   * Set when nothing here can help: the provider is unknown to every source of
   * truth, so there is no extension to install and no switch to flip. The
   * honest answer is to search again, not to offer a button.
   */
  blocked?: string;
  /** The extension recovery believes owns this provider, when it knows. */
  extension?: { internalName: string; name: string; repositoryUrl?: string };
}

/**
 * Everything the planner is allowed to look at.
 *
 * Passed in rather than reached for, so the decision is testable without a
 * datastore, a sidecar or a network — and so the set of inputs is visible in
 * one place rather than spread across whatever the planner happened to call.
 */
export interface RecoveryContext {
  /** Providers currently registered, and the extension that registered each. */
  registered: Map<string, { pluginInternalName: string; pluginName: string; adult: boolean }>;
  /** Extensions installed on disk, and the repository each came from. */
  installed: Map<string, { name: string; repositoryUrl: string }>;
  /** Repositories in the user's list. */
  repositories: Set<string>;
  /** Extensions a restored backup says the user had. */
  known: Map<string, { name: string; repositoryUrl: string }>;
  /** Persisted provider-to-extension map, which outlives an uninstall. */
  origins: Map<string, { internalName: string; pluginName: string }>;
  disabledProviders: Set<string>;
  disabledExtensions: Set<string>;
  disabledRepositories: Set<string>;
  /** Which repository id a given extension belongs to. */
  repositoryIdOf: (internalName: string) => string;
  adultAllowed: boolean;
}

/**
 * The ordered list of things that would make `provider` answer.
 *
 * Order matters and is not incidental: a repository has to be in the list
 * before its extension can be fetched, and the extension has to be on disk
 * before enabling it means anything. Each step is also *checked* rather than
 * assumed — a plan that always carried all five would reinstall a working
 * extension in order to fix a switched-off repository.
 */
export function planRecovery(provider: string, context: RecoveryContext): RecoveryPlan {
  const steps: RecoveryStep[] = [];

  /*
   * Three sources, most authoritative first. `registered` is what the runtime
   * actually has. The origin record covers an extension on disk whose providers
   * are not loaded yet — the ordinary state at launch, since providers are
   * hydrated lazily and loaded per archive on demand. `known` is the backup's
   * claim, and is the only one that can answer on a fresh install.
   */
  const live = context.registered.get(provider);
  const origin = context.origins.get(provider);
  const internalName = live?.pluginInternalName ?? origin?.internalName;

  if (!internalName) {
    return {
      provider,
      steps: [],
      blocked:
        `Nothing on this machine records which extension provided ${provider}. ` +
        'Search for the title again to find it somewhere else.',
    };
  }

  const onDisk = context.installed.get(internalName);
  const fromBackup = context.known.get(internalName);
  const source = onDisk ?? fromBackup;
  const displayName = live?.pluginName ?? source?.name ?? origin?.pluginName ?? internalName;
  const repositoryUrl = source?.repositoryUrl;
  const extension = { internalName, name: displayName, repositoryUrl };

  /*
   * The adult gate is checked first and reported rather than flipped. It is a
   * decision about the whole app, made in Settings; silently turning it on to
   * open one title would be a setting changed by a button that never mentioned
   * it. Reported before the install steps so the user is not asked to spend a
   * download on something that will still not open.
   */
  if (live?.adult && !context.adultAllowed) {
    return {
      provider,
      steps: [],
      extension,
      blocked:
        `${provider} serves adult content, which is turned off. Turn it on in Settings to ` +
        'use this provider.',
    };
  }

  if (!onDisk) {
    if (!repositoryUrl) {
      return {
        provider,
        steps: [],
        extension,
        blocked:
          `${provider} came from ${displayName}, which is not installed and whose repository ` +
          'this machine has no record of. Add that repository in Extensions, or search again.',
      };
    }
    if (!context.repositories.has(repositoryUrl)) {
      steps.push({
        kind: 'add-repository',
        target: repositoryUrl,
        label: `Add the repository ${displayName} came from`,
        costly: true,
      });
    }
    steps.push({
      kind: 'install-extension',
      target: internalName,
      label: `Install ${displayName}`,
      costly: true,
    });
  }

  /*
   * The enable steps are computed from the *stored* disabled lists rather than
   * from `enabledProviderNames`, because an extension that is about to be
   * installed has no live state to ask. A name absent from a disabled list is
   * already on, and adding a step for it would report work that did not happen.
   */
  if (onDisk) {
    const repositoryId = context.repositoryIdOf(internalName);
    if (repositoryId && context.disabledRepositories.has(repositoryId)) {
      steps.push({
        kind: 'enable-repository',
        target: repositoryId,
        label: 'Switch its repository back on',
      });
    }
  }
  if (context.disabledExtensions.has(internalName)) {
    steps.push({
      kind: 'enable-extension',
      target: internalName,
      label: `Switch ${displayName} back on`,
    });
  }
  if (context.disabledProviders.has(provider)) {
    steps.push({
      kind: 'enable-provider',
      target: provider,
      label: `Switch ${provider} back on`,
    });
  }

  return { provider, steps, extension };
}

/** What actually happened, step by step. */
export interface RecoveryOutcome {
  ok: boolean;
  provider: string;
  done: Array<{ kind: RecoveryStepKind; target: string; ok: boolean; error?: string }>;
  /** Set when the provider still does not answer once every step has run. */
  error?: string;
}

/**
 * Whether a plan is worth offering as a button.
 *
 * A plan with no steps and no block is a provider that should already work —
 * which happens, and means the failure was something else entirely (the host,
 * the title, the runtime). Offering "fix this" there is the dead button all
 * over again, one level up.
 */
export function isActionable(plan: RecoveryPlan): boolean {
  return !plan.blocked && plan.steps.length > 0;
}
