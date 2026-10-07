/**
 * Related Media Service — on-demand discovery of reviews, explanations,
 * recaps, analysis and public related media.
 *
 * Implements PRD 2026-10-06-On-Demand Movie Reviews, Explanations and Related Media.md
 * (§19 Provider Isolation, §24 Related Media Cache, §25 Cache Strategy, §34 Multi-Source Search).
 */

import path from 'path';
import { JsonFileStore } from '../../util/jsonFileStore.ts';
import type {
  RelatedMediaProvider,
  RelatedMediaResponse,
  RelatedMediaResult,
  RelatedMediaSearchRequest,
} from '../../../src/types/relatedMedia.ts';
import { normalizeMediaTitle } from './queryBuilder.ts';
import { rankRelatedMedia } from './ranking.ts';
import { YouTubeRelatedMediaProvider } from './providers/youtubeProvider.ts';
import { DailymotionRelatedMediaProvider } from './providers/dailymotionProvider.ts';
import { PublicWebRelatedMediaProvider } from './providers/publicWebProvider.ts';

interface CacheEntry {
  results: RelatedMediaResult[];
  timestamp: number;
}

interface CacheRow {
  key: string;
  entry: CacheEntry;
}

/** Persistent cache file name. */
const FILE_NAME = 'cs3-related-media-cache.json';

/** Cache TTL: 7 days so returning viewers get instant cached results. */
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class RelatedMediaService {
  private readonly providers: RelatedMediaProvider[];
  private readonly cache = new Map<string, CacheEntry>();
  private store: JsonFileStore<CacheRow[]>;

  constructor(customProviders?: RelatedMediaProvider[], directory?: string) {
    this.providers = customProviders ?? [
      new YouTubeRelatedMediaProvider(),
      new DailymotionRelatedMediaProvider(),
      new PublicWebRelatedMediaProvider(),
    ];

    const baseDir = directory ?? process.cwd();
    this.store = new JsonFileStore(
      path.join(baseDir, FILE_NAME),
      2_000,
      () => [...this.cache.entries()].map(([key, entry]) => ({ key, entry }))
    );

    this.restore();
  }

  /**
   * Configures persistent directory (e.g. app.getPath('userData')) and restores entries.
   */
  setDirectory(directory: string): void {
    this.store = new JsonFileStore(
      path.join(directory, FILE_NAME),
      2_000,
      () => [...this.cache.entries()].map(([key, entry]) => ({ key, entry }))
    );
    this.restore();
  }

  private restore(): void {
    const parsed = this.store.load();
    if (!Array.isArray(parsed)) return;
    const cutoff = Date.now() - CACHE_TTL_MS;
    for (const row of parsed) {
      if (row?.key && row.entry?.results && row.entry.timestamp >= cutoff) {
        this.cache.set(row.key, row.entry);
      }
    }
  }

  private buildCacheKey(request: RelatedMediaSearchRequest): string {
    const title = normalizeMediaTitle(request.title || request.originalTitle || '').toLowerCase();
    const year = request.year ? String(request.year) : '';
    const season = request.season ? `s${request.season}` : '';
    const episode = request.episode ? `e${request.episode}` : '';
    const type = request.type || 'all';
    return `${title}:${year}:${season}:${episode}:${type}`;
  }

  /**
   * Clears the related media cache and schedules file update.
   */
  clearCache(): void {
    this.cache.clear();
    this.store.schedule();
  }

  /**
   * Checks if cached results are already present for the given request.
   */
  getCached(request: RelatedMediaSearchRequest): RelatedMediaResponse | null {
    const title = request.title || request.originalTitle;
    if (!title?.trim()) return null;

    const cacheKey = this.buildCacheKey(request);
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return { ok: true, results: cached.results, cached: true };
    }
    return null;
  }

  /**
   * On-demand search across all configured providers concurrently.
   * Isolates provider failures, deduplicates, ranks results, and caches to disk.
   */
  async search(
    request: RelatedMediaSearchRequest,
    signal?: AbortSignal
  ): Promise<RelatedMediaResponse> {
    const title = request.title || request.originalTitle;
    if (!title?.trim()) {
      return { ok: true, results: [] };
    }

    const cacheKey = this.buildCacheKey(request);

    // Return cached results if available and not forced to refresh
    if (!request.forceRefresh) {
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        return { ok: true, results: cached.results, cached: true };
      }
    }

    // If caller specifically requested cached-only without network hit
    if (request.cachedOnly) {
      return { ok: true, results: [], cached: false };
    }

    // Query all providers concurrently with isolation
    const providerPromises = this.providers.map(async (provider) => {
      try {
        return await provider.search(request, signal);
      } catch {
        // Individual provider failures never break the whole search
        return [];
      }
    });

    const settled = await Promise.allSettled(providerPromises);
    const rawResults: RelatedMediaResult[] = [];

    for (const result of settled) {
      if (result.status === 'fulfilled' && Array.isArray(result.value)) {
        rawResults.push(...result.value);
      }
    }

    const ranked = rankRelatedMedia(rawResults, request);

    // Store in memory and schedule persistent flush
    this.cache.set(cacheKey, {
      results: ranked,
      timestamp: Date.now(),
    });
    this.store.schedule();

    return {
      ok: true,
      results: ranked,
      cached: false,
    };
  }
}

export const relatedMediaService = new RelatedMediaService();
