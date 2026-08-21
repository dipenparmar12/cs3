import { handleRaw } from './channel.ts';
import type { RegisterHandlers } from './services.ts';
import type { IndexerConfig, SourcePreferences } from '../../src/types/torrent';

/**
 * Torrent indexers, and how sources are ranked.
 *
 * Moved out of `main.ts` unchanged; see `services.ts` for why the dependencies
 * are named rather than reached for.
 */
export const registerIndexerHandlers: RegisterHandlers = (services) => {
  const {
    contentService,
  } = services;

  // --- indexers and source preferences -------------------------------------------
  handleRaw('indexer:getConfigs', async () => contentService.getRegistry().getConfigs());

  handleRaw('indexer:saveConfig', async (config: IndexerConfig) => {
    contentService.getRegistry().upsertConfig(config);
    return contentService.getRegistry().getConfigs();
  });

  handleRaw('indexer:removeConfig', async (id: string) => {
    contentService.getRegistry().removeConfig(id);
    return contentService.getRegistry().getConfigs();
  });

  handleRaw('indexer:test', async (config: IndexerConfig) => contentService.getRegistry().testIndexer(config));

  handleRaw('indexer:getHealth', async () => contentService.getRegistry().getHealth());

  handleRaw('sources:getPreferences', async () => contentService.getPreferences());

  handleRaw('sources:savePreferences', async (prefs: Partial<SourcePreferences>) => contentService.savePreferences(prefs));
};
