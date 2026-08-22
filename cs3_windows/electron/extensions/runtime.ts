import type { DatastoreManager } from '../datastore';
import type { AccessChallenge } from '../access/accessChallenge';
import type { AccessScope, HumanInteractionGateway } from '../access/humanGateway';
import type { RawTorrent } from '../torrent/indexers/base';
import type { IndexerQuery } from '../../src/types/torrent';

/**
 * The surface a desktop provider extension is written against.
 *
 * This is the first-party half of the community extension standard the app is
 * starting: `.cs3` archives keep working exactly as they do (that is the JVM
 * sidecar's job and nothing here touches it), and this is the *desktop-native*
 * ecosystem beside it — for the sites an Android provider cannot reach at all,
 * beginning with the ones behind a browser challenge.
 *
 * ## The principle
 *
 * **Extensions own provider-specific knowledge. The platform owns networking,
 * browser intervention, session management, caching, security and lifecycle.**
 *
 * An extension that had to implement Cloudflare handling, cookie persistence,
 * retry policy, TLS, redirects and rate limiting would get several of them
 * wrong, and each one it got wrong would be a bug in a different extension with
 * a different symptom. `ExtToProvider.search` is thirty lines and knows nothing
 * about any of it: it asks for a URL and parses what comes back. When the site
 * puts a challenge in the way, `context.http.get` reports it, and the same
 * thirty lines work unchanged once the user has answered it.
 *
 * ## What is deliberately not built
 *
 * **Downloadable extension code.** The PRD is explicit that arbitrary
 * JavaScript must not be fetched and run in the main process, and it is right —
 * that is a remote code execution channel with the user's filesystem behind it.
 * Doing it properly needs a sandboxed runtime with an integrity check, and that
 * is a subsystem, not a detail. So the interface below is real and the
 * extensions implementing it are **first-party and compiled in**. Building the
 * API against a concrete provider first is the PRD's own instruction, and it is
 * what makes the eventual sandbox a change of *loader* rather than a redesign.
 *
 * Nothing here weakens that boundary in the meantime: an extension already gets
 * no `fs`, no `child_process`, no Electron object and no `BrowserWindow` — only
 * the context below.
 */

export interface ExtensionLogger {
  debug(message: string, detail?: unknown): void;
  warn(message: string, detail?: unknown): void;
}

/**
 * Small persistent values, namespaced per extension.
 *
 * The case that justifies it: a site whose domain rotates. An extension that
 * finds a working mirror should not re-derive it on every launch, and it has no
 * other way to remember.
 */
export interface ExtensionStorage {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
}

export interface ExtensionResponse {
  ok: boolean;
  status: number;
  url: string;
  text(): Promise<string>;
  /**
   * Set when the request was intercepted rather than answered. The extension is
   * not expected to do anything about it beyond stopping — the reason travels
   * out to the UI, which is the only layer that can offer the action that helps.
   */
  challenge?: AccessChallenge;
}

export interface ExtensionHttp {
  get(url: string, options?: { headers?: Record<string, string> }): Promise<ExtensionResponse>;
}

export interface ExtensionContext {
  http: ExtensionHttp;
  storage: ExtensionStorage;
  logger: ExtensionLogger;
  /**
   * Whether this call may put a verification window on screen.
   *
   * Threaded through rather than decided inside, because the same
   * `search()` runs from a background prefetch and from a user pressing a
   * button, and only one of those may steal focus. See the policy note in
   * `humanGateway.ts`.
   */
  interactive: boolean;
  signal?: AbortSignal;
}

/**
 * What a provider extension implements.
 *
 * Shaped around torrents because ext.to is a torrent site and the PRD says to
 * design the API while implementing it rather than in front of it. A direct-link
 * provider would add a sibling method; nothing here forecloses that, and
 * guessing at its shape now would produce an interface fitted to no real site.
 */
export interface ProviderExtension {
  readonly manifest: ExtensionManifest;
  /** The site session this extension's requests belong to. */
  readonly scope: AccessScope;
  search(query: IndexerQuery, context: ExtensionContext): Promise<RawTorrent[]>;
}

export interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  /** Free text, shown in provenance. Not used for anything else. */
  authors?: string[];
  /** True when the site is known to challenge automated requests. */
  expectsHumanVerification?: boolean;
}

/**
 * Builds the context an extension is called with.
 *
 * The gateway is captured rather than passed on, so an extension holds a
 * `get(url)` and never a session, a partition or a window.
 */
export function createExtensionContext(
  extension: ProviderExtension,
  gateway: HumanInteractionGateway,
  datastore: DatastoreManager,
  options: { interactive: boolean; signal?: AbortSignal }
): ExtensionContext {
  const prefix = `cs3_ext_${extension.manifest.id}_`;

  return {
    interactive: options.interactive,
    signal: options.signal,

    http: {
      async get(url, requestOptions) {
        const result = await gateway.request(extension.scope.id, url, {
          interactive: options.interactive,
          signal: options.signal,
          headers: requestOptions?.headers,
        });

        if (result.response) {
          const response = result.response;
          return {
            ok: result.ok,
            status: response.status,
            url,
            text: () => response.text(),
            challenge: result.challenge,
          };
        }

        return {
          ok: false,
          status: result.challenge?.statusCode ?? 0,
          url,
          text: async () => '',
          challenge: result.challenge,
        };
      },
    },

    storage: {
      get: (key) => datastore.getString(prefix + key, '') || undefined,
      set: (key, value) => datastore.setString(prefix + key, value),
    },

    logger: {
      debug: (message, detail) =>
        console.log(`[ext:${extension.manifest.id}] ${message}`, detail ?? ''),
      warn: (message, detail) =>
        console.warn(`[ext:${extension.manifest.id}] ${message}`, detail ?? ''),
    },
  };
}
