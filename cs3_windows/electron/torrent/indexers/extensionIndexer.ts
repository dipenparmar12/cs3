import type { RawTorrent, TorrentIndexer } from './base';
import type { IndexerQuery } from '../../../src/types/torrent';
import type { DatastoreManager } from '../../datastore';
import type { HumanInteractionGateway } from '../../access/humanGateway';
import { createExtensionContext, type ProviderExtension } from '../../extensions/runtime';

/**
 * Lets a desktop extension answer a source search like any other indexer.
 *
 * The whole point is that everything downstream of here — ranking, dedupe by
 * infohash, the source cache, the torrent engine, the player — treats an
 * extension's rows exactly as it treats 1337x's. An extension is a *source of
 * rows*, not a new kind of thing to special-case, and the moment it becomes one
 * the rest of the app grows a branch for it in five places.
 *
 * The one thing this adapter adds is the failure that needs a person. An
 * ordinary indexer failure is a sentence; this one is an offer, so
 * `AccessBlocked` is re-thrown with its scope attached and the registry turns
 * it into a `verification` outcome rather than an error string.
 */
export class ExtensionIndexer implements TorrentIndexer {
  readonly id: string;
  readonly name: string;
  readonly specialises = 'any' as const;

  private extension: ProviderExtension;
  private gateway: HumanInteractionGateway;
  private datastore: DatastoreManager;

  constructor(
    extension: ProviderExtension,
    gateway: HumanInteractionGateway,
    datastore: DatastoreManager
  ) {
    this.extension = extension;
    this.gateway = gateway;
    this.datastore = datastore;
    this.id = extension.manifest.id;
    this.name = extension.manifest.name;
  }

  public canHandle(query: IndexerQuery): boolean {
    // Free-text sites answer anything with words in it. A query that is only an
    // IMDb id would be searched literally and match nothing.
    return query.query.trim().length > 0;
  }

  public async search(query: IndexerQuery, signal: AbortSignal): Promise<RawTorrent[]> {
    const context = createExtensionContext(this.extension, this.gateway, this.datastore, {
      interactive: query.interactive === true,
      signal,
    });
    return this.extension.search(query, context);
  }

  /** The scope a `verification` outcome should name. */
  public get scopeId(): string {
    return this.extension.scope.id;
  }

  public get scopeName(): string {
    return this.extension.scope.name;
  }

  /** The URL to open for verification: the site's own front page. */
  public get verifyUrl(): string {
    return this.extension.scope.origins[0];
  }
}
