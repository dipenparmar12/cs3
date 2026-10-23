/**
 * Services that several providers front under their own names.
 *
 * The built-in Internet Archive provider and community extensions that also
 * register an "Internet Archive" (or "InternetArchive", "Archive.org") provider
 * are the same service to the viewer. Switching one off and still getting its
 * rows from the other read as the switch not working, so a service switched
 * off anywhere is off everywhere: `PluginManager.enabledProviderNames` and
 * `NativeProviderRegistry.enabledProviderNames` both consult this.
 *
 * Listed by hand, never inferred: a loose rule would switch off a provider that
 * only shares a word with the service. Pure.
 */
const SERVICES: Record<string, readonly string[]> = {
  'internet-archive': ['internetarchive', 'archiveorg', 'archive'],
};

function fold(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** The service a provider name stands for, or null when it is its own thing. */
export function serviceOf(name: string | undefined): string | null {
  if (!name) return null;
  const folded = fold(name);
  for (const [service, names] of Object.entries(SERVICES)) {
    if (names.includes(folded)) return service;
  }
  return null;
}

/** The services among a set of switched-off provider names. */
export function servicesOff(disabledNames: Iterable<string>): Set<string> {
  const off = new Set<string>();
  for (const name of disabledNames) {
    const service = serviceOf(name);
    if (service) off.add(service);
  }
  return off;
}
