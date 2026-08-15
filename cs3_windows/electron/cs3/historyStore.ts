import { randomUUID } from 'crypto';
import type { DatastoreManager } from '../datastore';
import type {
  HistoryEvent,
  HistoryFilter,
  HistoryListResponse,
  HistoryStats,
  HistoryAction,
  HistoryStatus,
} from '../../src/types/history';
import { canonicalKey } from './libraryStore';

const HISTORY_KEY = 'media_history_events_v1';
const MAX_HISTORY_EVENTS = 10_000;

export class HistoryStore {
  private datastore: DatastoreManager;
  private events: HistoryEvent[] = [];

  constructor(datastore: DatastoreManager) {
    this.datastore = datastore;
    this.restore();
  }

  private restore(): void {
    const raw = this.datastore.getObject<HistoryEvent[]>(HISTORY_KEY, []);
    if (Array.isArray(raw)) {
      this.events = raw.filter((item) => item && typeof item.id === 'string' && item.title);
    }
  }

  private persist(): void {
    if (this.events.length > MAX_HISTORY_EVENTS) {
      this.events = this.events.slice(0, MAX_HISTORY_EVENTS);
    }
    this.datastore.setObject(HISTORY_KEY, this.events);
  }

  /**
   * Records a user interaction, playback attempt, failure, or download into history.
   * Chronologically preserves discrete attempts rather than overwriting previous logs.
   */
  public record(
    input: Omit<HistoryEvent, 'id' | 'timestamp' | 'mediaKey'> & {
      id?: string;
      timestamp?: number;
      mediaKey?: string;
    }
  ): HistoryEvent {
    const timestamp = input.timestamp ?? Date.now();
    const mediaKey = input.mediaKey ?? canonicalKey(input.title, input.year);
    const id = input.id ?? randomUUID();

    const event: HistoryEvent = {
      ...input,
      id,
      mediaKey,
      timestamp,
    };

    // Newest first
    this.events.unshift(event);
    this.persist();
    return event;
  }

  /**
   * Updates an existing live event (e.g. updating progress, duration, or completion status).
   */
  public update(id: string, updates: Partial<HistoryEvent>): HistoryEvent | null {
    const index = this.events.findIndex((e) => e.id === id);
    if (index < 0) return null;

    const existing = this.events[index];
    const updated: HistoryEvent = {
      ...existing,
      ...updates,
      id: existing.id,
      timestamp: existing.timestamp,
    };

    this.events[index] = updated;
    this.persist();
    return updated;
  }

  public get(id: string): HistoryEvent | null {
    return this.events.find((e) => e.id === id) ?? null;
  }

  public delete(id: string): boolean {
    const initialLen = this.events.length;
    this.events = this.events.filter((e) => e.id !== id);
    const removed = this.events.length < initialLen;
    if (removed) this.persist();
    return removed;
  }

  public deleteMany(ids: string[]): number {
    const idSet = new Set(ids);
    const initialLen = this.events.length;
    this.events = this.events.filter((e) => !idSet.has(e.id));
    const removed = initialLen - this.events.length;
    if (removed > 0) this.persist();
    return removed;
  }

  public clear(): void {
    this.events = [];
    this.persist();
  }

  public getStats(): HistoryStats {
    let played = 0;
    let failed = 0;
    let downloaded = 0;
    let attempted = 0;
    let unchecked = 0;

    for (const e of this.events) {
      if (e.status === 'Played') played++;
      else if (e.status === 'Failed') failed++;
      else if (e.status === 'Downloaded') downloaded++;
      else if (e.status === 'Attempted' || e.status === 'Download Failed') attempted++;
      else if (e.status === 'Unchecked' || e.status === 'Unknown') unchecked++;
    }

    return {
      total: this.events.length,
      played,
      failed,
      downloaded,
      attempted,
      unchecked,
    };
  }

  public list(filter?: HistoryFilter): HistoryListResponse {
    let result = [...this.events];

    if (filter) {
      // 1. Text search across title, provider, sourceName, resolution, failure reason
      if (filter.query && filter.query.trim()) {
        const q = filter.query.trim().toLowerCase();
        result = result.filter((item) => {
          const matchTitle = item.title.toLowerCase().includes(q);
          const matchOriginal = item.originalTitle?.toLowerCase().includes(q);
          const matchEpisode = item.episodeTitle?.toLowerCase().includes(q);
          const matchProvider = item.source?.providerName?.toLowerCase().includes(q) ||
            item.source?.indexerName?.toLowerCase().includes(q);
          const matchSource = item.source?.sourceName?.toLowerCase().includes(q);
          const matchError = item.failureReason?.toLowerCase().includes(q);
          const matchResolution = item.source?.resolution ? String(item.source.resolution).includes(q) : false;
          return (
            matchTitle ||
            matchOriginal ||
            matchEpisode ||
            matchProvider ||
            matchSource ||
            matchError ||
            matchResolution
          );
        });
      }

      // 2. Status filter
      if (filter.status && filter.status !== 'All') {
        result = result.filter((item) => item.status === filter.status);
      }

      // 3. Media Type filter
      if (filter.type && filter.type !== 'all') {
        const typeLower = filter.type.toLowerCase();
        result = result.filter((item) => {
          const itemType = String(item.type ?? '').toLowerCase();
          if (typeLower === 'movie') return itemType.includes('movie');
          if (typeLower === 'series') return itemType.includes('series') || itemType.includes('tv');
          if (typeLower === 'anime') return itemType.includes('anime');
          return true;
        });
      }

      // 4. Provider filter
      if (filter.provider && filter.provider.trim()) {
        const prov = filter.provider.trim().toLowerCase();
        result = result.filter((item) =>
          item.source?.providerName?.toLowerCase() === prov ||
          item.source?.indexerName?.toLowerCase() === prov
        );
      }

      // 5. Action filter
      if (filter.action) {
        result = result.filter((item) => item.action === filter.action);
      }

      // 6. Date range filter
      if (filter.startDate) {
        result = result.filter((item) => item.timestamp >= filter.startDate!);
      }
      if (filter.endDate) {
        result = result.filter((item) => item.timestamp <= filter.endDate!);
      }

      // 7. Sorting
      const sortBy = filter.sortBy || 'recent';
      if (sortBy === 'recent') {
        result.sort((a, b) => b.timestamp - a.timestamp);
      } else if (sortBy === 'oldest') {
        result.sort((a, b) => a.timestamp - b.timestamp);
      } else if (sortBy === 'played') {
        result.sort((a, b) => {
          if (a.status === 'Played' && b.status !== 'Played') return -1;
          if (b.status === 'Played' && a.status !== 'Played') return 1;
          return b.timestamp - a.timestamp;
        });
      } else if (sortBy === 'failed') {
        result.sort((a, b) => {
          if (a.status === 'Failed' && b.status !== 'Failed') return -1;
          if (b.status === 'Failed' && a.status !== 'Failed') return 1;
          return b.timestamp - a.timestamp;
        });
      } else if (sortBy === 'downloaded') {
        result.sort((a, b) => {
          if (a.status === 'Downloaded' && b.status !== 'Downloaded') return -1;
          if (b.status === 'Downloaded' && a.status !== 'Downloaded') return 1;
          return b.timestamp - a.timestamp;
        });
      }
    }

    const total = result.length;
    const offset = Math.max(0, filter?.offset ?? 0);
    const limit = Math.max(1, Math.min(filter?.limit ?? 50, 200));
    const paginated = result.slice(offset, offset + limit);

    return {
      items: paginated,
      total,
      hasMore: offset + limit < total,
    };
  }

  public exportAll(): HistoryEvent[] {
    return [...this.events];
  }

  public importAll(imported: HistoryEvent[]): number {
    let count = 0;
    const existingIds = new Set(this.events.map((e) => e.id));

    for (const item of imported) {
      if (item && item.id && !existingIds.has(item.id)) {
        this.events.push(item);
        existingIds.add(item.id);
        count++;
      }
    }

    this.events.sort((a, b) => b.timestamp - a.timestamp);
    this.persist();
    return count;
  }
}
