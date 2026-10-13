/**
 * YouTube search provider for on-demand reviews, explanations, and related media.
 * Keyless, queries public YouTube search results and parses ytInitialData.
 *
 * Implements PRD 2026-10-06 §17 (YouTube Integration).
 */

import { fetchDocument } from '../../../torrent/http.ts';
import type {
  RelatedMediaProvider,
  RelatedMediaResult,
  RelatedMediaSearchRequest,
} from '../../../../src/types/relatedMedia.ts';
import { classifyRelatedMediaCategory } from '../classifier.ts';
import { buildRelatedMediaQueries } from '../queryBuilder.ts';

function parseDurationSeconds(text?: string): number | undefined {
  if (!text?.trim()) return undefined;
  const parts = text.trim().split(':').map((p) => Number(p));
  if (parts.some((n) => Number.isNaN(n) || n < 0)) return undefined;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return undefined;
}

export class YouTubeRelatedMediaProvider implements RelatedMediaProvider {
  readonly id = 'youtube';
  readonly name = 'YouTube';

  async search(
    request: RelatedMediaSearchRequest,
    signal?: AbortSignal
  ): Promise<RelatedMediaResult[]> {
    const queries = buildRelatedMediaQueries(request);
    if (!queries.length) return [];

    // Query top 2 queries concurrently to broaden coverage across reviews & explanations
    const targetQueries = queries.slice(0, 2);
    const seenIds = new Set<string>();
    const results: RelatedMediaResult[] = [];

    const fetchQuery = async (query: string): Promise<void> => {
      const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
      try {
        const html = await fetchDocument(url, {
          signal,
          timeoutMs: 9_000,
          retries: 0,
        });

        const match =
          html.match(/ytInitialData\s*=\s*({.+?});<\/script>/s) ||
          html.match(/var ytInitialData\s*=\s*({.+?});/s);
        if (!match) return;

        const json = JSON.parse(match[1]);
        const contents =
          json.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents;
        if (!Array.isArray(contents)) return;

        for (const section of contents) {
          const items = section?.itemSectionRenderer?.contents;
          if (!Array.isArray(items)) continue;

          for (const item of items) {
            const vr = item.videoRenderer;
            if (!vr?.videoId || !/^[\w-]{11}$/.test(vr.videoId)) continue;
            if (seenIds.has(vr.videoId)) continue;
            seenIds.add(vr.videoId);

            const title = vr.title?.runs?.[0]?.text?.trim() || '';
            if (!title) continue;

            // Description snippet
            let description = '';
            if (Array.isArray(vr.detailedMetadataSnippets)) {
              description =
                vr.detailedMetadataSnippets[0]?.snippetText?.runs?.map((r: { text?: string }) => r.text).join('') || '';
            } else if (Array.isArray(vr.descriptionSnippet?.runs)) {
              description = vr.descriptionSnippet.runs.map((r: { text?: string }) => r.text).join('');
            }

            const channel = vr.ownerText?.runs?.[0]?.text?.trim() || undefined;
            const lengthText = vr.lengthText?.simpleText || undefined;
            const durationSeconds = parseDurationSeconds(lengthText);
            const publishedAt = vr.publishedTimeText?.simpleText || undefined;

            // High res thumbnail
            const thumbs = vr.thumbnail?.thumbnails;
            const thumbnailUrl = Array.isArray(thumbs) && thumbs.length > 0 ? thumbs[thumbs.length - 1].url : undefined;

            const category = classifyRelatedMediaCategory(title, description);

            results.push({
              id: `youtube:${vr.videoId}`,
              title,
              description: description || undefined,
              source: {
                provider: 'YouTube',
                url: `https://www.youtube.com/watch?v=${vr.videoId}`,
                externalId: vr.videoId,
              },
              type: 'video',
              category,
              thumbnailUrl,
              durationSeconds,
              publishedAt,
              creator: channel ? { name: channel } : undefined,
            });
          }
        }
      } catch {
        // Provider isolation: individual search failures do not throw
      }
    };

    await Promise.allSettled(targetQueries.map((q) => fetchQuery(q)));
    return results;
  }
}
