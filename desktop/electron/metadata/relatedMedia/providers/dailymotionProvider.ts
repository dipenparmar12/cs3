/**
 * Dailymotion search provider for on-demand reviews, explanations, and related media.
 * Keyless, queries Dailymotion public REST API.
 *
 * Implements PRD 2026-10-06 §18 (Dailymotion Integration).
 */

import { fetchJson } from '../../../torrent/http.ts';
import type {
  RelatedMediaProvider,
  RelatedMediaResult,
  RelatedMediaSearchRequest,
} from '../../../../src/types/relatedMedia.ts';
import { classifyRelatedMediaCategory } from '../classifier.ts';
import { buildRelatedMediaQueries } from '../queryBuilder.ts';

interface DailymotionItem {
  id: string;
  title: string;
  description?: string;
  duration?: number;
  thumbnail_480_url?: string;
  created_time?: number;
  'owner.screenname'?: string;
  url: string;
}

interface DailymotionResponse {
  list?: DailymotionItem[];
}

export class DailymotionRelatedMediaProvider implements RelatedMediaProvider {
  readonly id = 'dailymotion';
  readonly name = 'Dailymotion';

  async search(
    request: RelatedMediaSearchRequest,
    signal?: AbortSignal
  ): Promise<RelatedMediaResult[]> {
    const queries = buildRelatedMediaQueries(request);
    if (!queries.length) return [];

    // Use top query (e.g. "<title> <year> review" or "<title> ending explained")
    const query = queries[0];
    const url = `https://api.dailymotion.com/videos?search=${encodeURIComponent(query)}&fields=id,title,description,duration,thumbnail_480_url,created_time,owner.screenname,url&limit=12`;

    try {
      const data = await fetchJson<DailymotionResponse>(url, {
        signal,
        timeoutMs: 8_000,
        retries: 0,
      });

      if (!Array.isArray(data?.list)) return [];

      const results: RelatedMediaResult[] = [];
      for (const item of data.list) {
        if (!item.id || !item.title) continue;

        const category = classifyRelatedMediaCategory(item.title, item.description);
        let publishedAt: string | undefined;
        if (item.created_time) {
          const date = new Date(item.created_time * 1000);
          publishedAt = date.getFullYear().toString();
        }

        results.push({
          id: `dailymotion:${item.id}`,
          title: item.title,
          description: item.description,
          source: {
            provider: 'Dailymotion',
            url: item.url || `https://www.dailymotion.com/video/${item.id}`,
            externalId: item.id,
          },
          type: 'video',
          category,
          thumbnailUrl: item.thumbnail_480_url,
          durationSeconds: item.duration,
          publishedAt,
          creator: item['owner.screenname'] ? { name: item['owner.screenname'] } : undefined,
        });
      }

      return results;
    } catch {
      // Provider isolation: failure should not block other providers
      return [];
    }
  }
}
