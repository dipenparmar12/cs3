import { app, session } from 'electron';
import type { DatastoreManager } from './datastore';

/**
 * DNS configuration, because DNS is this app's most common single point of
 * failure.
 *
 * The empty-result message already says it out loud: "public torrent sites are
 * often DNS-blocked by ISPs". When that happens every indexer fails at once,
 * the app looks broken, and nothing in it could previously be changed to fix
 * it. Android CloudStream has had a DNS-over-HTTPS setting for exactly this
 * reason.
 *
 * **Why this has to go through Chromium.** `app.configureHostResolver` governs
 * Chromium's network stack and nothing else. Node's own `fetch` resolves
 * through the OS and would ignore it completely — so the setting only means
 * anything if main-process requests are issued with `net.fetch`, which is what
 * `setHttpFetch` in `torrent/http.ts` arranges. Configuring the resolver
 * without that would produce a switch that looks like it works and does not.
 *
 * Torrent peer and tracker connections still use Node's resolver. They are not
 * routed here, and the UI does not claim otherwise.
 */

const SETTINGS_KEY = 'cs3_network_settings';

/**
 * - `system` leaves Chromium alone, using whatever the OS resolves with.
 * - `automatic` upgrades to DoH when the configured resolver is known to offer
 *   it, and silently falls back to plaintext when it does not.
 * - `secure` refuses to resolve any other way. It is the only setting that
 *   actually defeats a resolver-level block, and the only one that can take
 *   the whole app offline if the servers are unreachable.
 */
export type DnsMode = 'system' | 'automatic' | 'secure';

export interface NetworkSettings {
  dnsMode: DnsMode;
  /** DoH URI templates, in preference order. Only read in the non-system modes. */
  dnsServers: string[];
}

export interface DnsPreset {
  id: string;
  name: string;
  description: string;
  servers: string[];
  /**
   * Resolvers that deliberately filter. Useful to some people and actively
   * counterproductive here — a family or malware filter can be the very thing
   * blocking the sites the user is trying to reach, so the UI groups them apart
   * rather than listing them beside the unfiltered ones.
   */
  filtered?: boolean;
}

/**
 * Resolvers offered by name, so the common case is one click rather than a
 * URI template the user has to find and type correctly.
 *
 * Every entry is free, public, and needs no account, no client certificate and
 * no manual step — anything requiring registration would be a dead end at the
 * exact moment the user is trying to get the app working again.
 *
 * Unfiltered ones come first, and that ordering is the advice: this setting
 * exists because an ISP resolver is blocking sites, and a filtering resolver
 * can reproduce the same symptom for a different reason.
 */
export const DNS_PRESETS: DnsPreset[] = [
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    description: 'Fast and widely reachable. A good first thing to try.',
    servers: ['https://cloudflare-dns.com/dns-query'],
  },
  {
    id: 'google',
    name: 'Google',
    description: 'Reliable, and reachable from most networks.',
    servers: ['https://dns.google/dns-query'],
  },
  {
    id: 'quad9-unsecured',
    name: 'Quad9 (unfiltered)',
    description: 'Quad9 without its malware blocklist, so nothing is withheld.',
    servers: ['https://dns10.quad9.net/dns-query'],
  },
  {
    id: 'mullvad',
    name: 'Mullvad',
    description: 'Run by a privacy provider, no logging, no account needed.',
    servers: ['https://dns.mullvad.net/dns-query'],
  },
  {
    id: 'dnssb',
    name: 'DNS.SB',
    description: 'Unfiltered and anycast, with no query logging.',
    servers: ['https://doh.sb/dns-query'],
  },
  {
    id: 'opendns',
    name: 'OpenDNS',
    description: 'Cisco’s public resolver. Long-established and stable.',
    servers: ['https://doh.opendns.com/dns-query'],
  },
  {
    id: 'controld-unfiltered',
    name: 'Control D (unfiltered)',
    description: 'Free unfiltered endpoint, no sign-up.',
    servers: ['https://freedns.controld.com/p0'],
  },
  {
    id: 'njalla',
    name: 'Njalla',
    description: 'Privacy-focused resolver, no filtering and no logs.',
    servers: ['https://dns.njal.la/dns-query'],
  },
  {
    id: 'quad9',
    name: 'Quad9 (malware filter)',
    description: 'Blocks known-malicious domains as well as resolving.',
    servers: ['https://dns.quad9.net/dns-query'],
    filtered: true,
  },
  {
    id: 'adguard',
    name: 'AdGuard',
    description: 'Filters advertising and tracking domains.',
    servers: ['https://dns.adguard-dns.com/dns-query'],
    filtered: true,
  },
  {
    id: 'cloudflare-security',
    name: 'Cloudflare (malware filter)',
    description: 'Cloudflare with malware blocking added.',
    servers: ['https://security.cloudflare-dns.com/dns-query'],
    filtered: true,
  },
];

const DEFAULTS: NetworkSettings = { dnsMode: 'system', dnsServers: [] };

export class NetworkSettingsStore {
  private datastore: DatastoreManager;

  constructor(datastore: DatastoreManager) {
    this.datastore = datastore;
  }

  public get(): NetworkSettings {
    const stored = this.datastore.getObject<Partial<NetworkSettings>>(SETTINGS_KEY, DEFAULTS);
    const mode = stored?.dnsMode;
    return {
      dnsMode: mode === 'automatic' || mode === 'secure' ? mode : 'system',
      dnsServers: Array.isArray(stored?.dnsServers)
        ? stored.dnsServers.filter((s) => typeof s === 'string' && s.trim().length > 0)
        : [],
    };
  }

  public set(next: Partial<NetworkSettings>): NetworkSettings {
    const merged: NetworkSettings = { ...this.get(), ...next };
    // A secure mode with no servers cannot resolve anything at all, which would
    // take the whole app offline with no way back through the UI it just broke.
    const settings: NetworkSettings =
      merged.dnsMode !== 'system' && merged.dnsServers.length === 0
        ? { ...merged, dnsMode: 'system' }
        : merged;

    this.datastore.setObject(SETTINGS_KEY, settings);
    this.apply();
    return settings;
  }

  /** Back to the OS resolver, which is the state that is always recoverable. */
  public reset(): NetworkSettings {
    return this.set(DEFAULTS);
  }

  /**
   * Pushes the current setting into Chromium.
   *
   * Must run after `app.whenReady()`; before that the resolver does not exist
   * yet and the call is ignored. Called again on every change, because the
   * resolver is reconfigurable at runtime and making the user restart to change
   * a DNS server would be a poor answer to "the app cannot reach anything".
   */
  public apply(): void {
    if (!app?.isReady()) return;
    const { dnsMode, dnsServers } = this.get();

    if (dnsMode === 'system') {
      app.configureHostResolver({ secureDnsMode: 'off', secureDnsServers: [] });
    } else {
      app.configureHostResolver({
        secureDnsMode: dnsMode === 'secure' ? 'secure' : 'automatic',
        secureDnsServers: dnsServers,
      });
    }

    /**
     * Chromium caches resolutions, and a new resolver does not invalidate them.
     * Without this flush, every host already looked up keeps its old answer —
     * so switching DNS to escape a block appears to do nothing for exactly the
     * hosts the user is trying to reach. Measured: a request repeated against
     * the same host succeeded even with a deliberately dead DoH server, while
     * a fresh host correctly failed to resolve.
     */
    void session.defaultSession?.clearHostResolverCache().catch(() => {
      // Best-effort. A stale cache entry expires on its own soon enough, and
      // failing to clear it must not stop the setting being applied.
    });
  }
}
