import { handle, handleRaw } from './channel.ts';
import type { RegisterHandlers } from './services.ts';
import type { HistoryEvent, HistoryFilter } from '../../src/types/history';
import { HistoryStore } from '../cs3/historyStore';

/**
 * The media history feed.
 *
 * Moved out of `main.ts` unchanged; see `services.ts` for why the dependencies
 * are named rather than reached for.
 */
export const registerHistoryHandlers: RegisterHandlers = (services) => {
  const {
    historyStore,
  } = services;

  // --- media history -------------------------------------------------------------
  handleRaw('history:recordEvent', async (event: Parameters<HistoryStore['record']>[0]) => historyStore.record(event));

  handleRaw('history:updateEvent', async (id: string, updates: Partial<HistoryEvent>) => historyStore.update(id, updates));

  handleRaw('history:list', async (filter?: HistoryFilter) => historyStore.list(filter));

  handleRaw('history:get', async (id: string) => historyStore.get(id));

  handleRaw('history:deleteItem', async (id: string) => historyStore.delete(id));

  handleRaw('history:deleteItems', async (ids: string[]) => historyStore.deleteMany(ids));

  handle('history:clearAll', async () => {
    historyStore.clear();
    return {};
  });

  handleRaw('history:getStats', async () => historyStore.getStats());
};
