/**
 * Related Media Service — on-demand discovery of reviews, explanations,
 * recaps, analysis and public related media.
 *
 * Implements PRD 2026-10-06-On-Demand Movie Reviews, Explanations and Related Media.md
 * (§19 Provider Isolation, §24 Related Media Cache, §25 Cache Strategy, §34 Multi-Source Search).
 */

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

/** Cache TTL: 6 hours. */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export class RelatedMediaService {
  private readonly providers: RelatedMediaProvider[];
  private readonly cache = new Map<string, CacheEntry>();

  constructor(customProviders?: RelatedMediaProvider[]) {
    this.providers = customProviders ?? [
      new YouTubeRelatedMediaProvider(),
      new DailymotionRelatedMediaProvider(),
      new PublicWebRelatedMediaProvider(),
    ];
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
   * Clears the in-memory related media cache.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * On-demand search across all configured providers concurrently.
   * Isolates provider failures, deduplicates and ranks results.
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

    // Return cached results if fresh and not forced to refresh
    if (!request.forceRefresh) {
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        return { ok: true, results: cached.results, cached: true };
      }
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

    // Store in cache
    this.cache.set(cacheKey, {
      results: ranked,
      timestamp: Date.now(),
    });

    return {
      ok: true,
      results: ranked,
      cached: false,
    };
  }
}

export const relatedMediaService = new RelatedMediaService();
