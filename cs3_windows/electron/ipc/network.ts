import { handle, handleRaw } from './channel.ts';
import type { RegisterHandlers } from './services.ts';
import { DNS_PRESETS } from '../networkSettings';
import type { NetworkSettings } from '../networkSettings';
import { net } from 'electron';

/**
 * DNS presets, and a reachability probe.
 *
 * Moved out of `main.ts` unchanged; see `services.ts` for why the dependencies
 * are named rather than reached for.
 */
export const registerNetworkHandlers: RegisterHandlers = (services) => {
  const {
    contentService,
    network,
  } = services;

  // --- network / DNS -------------------------------------------------------------
  handleRaw('network:get', async () => ({
    settings: network.get(),
    presets: DNS_PRESETS,
  }));

  handleRaw('network:set', async (settings: Partial<NetworkSettings>) => network.set(settings));

  handleRaw('network:reset', async () => network.reset());

  /**
   * Answers "can this machine actually reach the sites the app needs".
   *
   * Deliberately tests the real indexer hosts rather than a generic connectivity
   * endpoint: the failure being diagnosed is selective, and a machine that can
   * reach example.com while every torrent site is blocked is exactly the case
   * this setting exists for. Reporting per-host is what makes the difference
   * between "no internet" and "your ISP blocks these" visible.
   */
  /**
   * Can this machine actually reach the sources it is configured to use?
   *
   * Probes the catalogues plus **every configured indexer**, through `net.fetch`
   * so the DNS setting is the one being tested. The list is derived rather than
   * hardcoded: a fixed five told a Jackett user their connection was fine while
   * the indexer they actually search was unreachable.
   *
   * Disabled indexers are still probed and reported as such. The question being
   * answered is "what can this network reach", and knowing a site is reachable is
   * exactly what tells someone it is worth enabling.
   */
  handle('network:test', async () => {
    const targets = [
      { id: 'cinemeta', name: 'Cinemeta (catalogue)', url: 'https://v3-cinemeta.strem.io/manifest.json', enabled: true, kind: 'catalogue' as const },
      { id: 'tvmaze', name: 'TVmaze (catalogue)', url: 'https://api.tvmaze.com/shows/1', enabled: true, kind: 'catalogue' as const },
      ...contentService
        .getRegistry()
        .probeTargets()
        .map((target) => ({ ...target, kind: 'indexer' as const })),
    ];

    const results = await Promise.all(
      targets.map(async (target) => {
        const started = Date.now();
        try {
          const response = await net.fetch(target.url, {
            method: 'GET',
            signal: AbortSignal.timeout(8_000),
          });
          return {
            name: target.name,
            kind: target.kind,
            enabled: target.enabled,
            // A 4xx still proves the host resolved and answered, which is what
            // this test is about; only a transport failure is a "no".
            ok: true,
            status: response.status,
            latencyMs: Date.now() - started,
          };
        } catch (error) {
          return {
            name: target.name,
            kind: target.kind,
            enabled: target.enabled,
            ok: false,
            latencyMs: Date.now() - started,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      })
    );

    return { results, dnsMode: network.get().dnsMode };
  });
};
