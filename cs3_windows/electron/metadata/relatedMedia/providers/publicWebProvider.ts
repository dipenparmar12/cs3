/**
 * Public Web search provider for on-demand articles, written reviews, and recaps.
 * Keyless, queries public search without user tracking.
 *
 * Implements PRD 2026-10-06 §7 (Related Media / Articles) & §18 (PublicWebProvider).
 */

import { fetchDocument } from '../../../torrent/http.ts';
import type {
  RelatedMediaProvider,
  RelatedMediaResult,
  RelatedMediaSearchRequest,
} from '../../../../src/types/relatedMedia.ts';
import { classifyRelatedMediaCategory } from '../classifier.ts';
import { buildRelatedMediaQueries } from '../queryBuilder.ts';

function extractRealUrl(rawHref: string): string {
  try {
    if (rawHref.includes('uddg=')) {
      const parsed = new URL(rawHref, 'https://html.duckduckgo.com');
      const uddg = parsed.searchParams.get('uddg');
      if (uddg) return decodeURIComponent(uddg);
    }
  } catch {
    // Fall back to rawHref
  }
  return rawHref;
}

function cleanHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
}

function extractDomain(url: string): string {
  try {
    const host = new URL(url).hostname;
    return host.replace(/^www\./i, '');
  } catch {
    return 'Web';
  }
}

export class PublicWebRelatedMediaProvider implements RelatedMediaProvider {
  readonly id = 'publicWeb';
  readonly name = 'Public Web';

  async search(
    request: RelatedMediaSearchRequest,
    signal?: AbortSignal
  ): Promise<RelatedMediaResult[]> {
    const queries = buildRelatedMediaQueries(request);
    if (!queries.length) return [];

    const query = queries[0];
    const postBody = `q=${encodeURIComponent(query)}`;

    try {
      const html = await fetchDocument('https://html.duckduckgo.com/html/', {
        signal,
        timeoutMs: 8_000,
        retries: 0,
        body: postBody,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      const results: RelatedMediaResult[] = [];
      const snippetRegex = /<a class="result__snippet"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      const titleRegex = /<a class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

      const titleMatches = Array.from(html.matchAll(titleRegex));
      const snippetMatches = Array.from(html.matchAll(snippetRegex));

      const count = Math.min(titleMatches.length, 8);
      for (let i = 0; i < count; i++) {
        const rawHref = titleMatches[i][1];
        const rawTitle = titleMatches[i][2];
        const rawSnippet = snippetMatches[i] ? snippetMatches[i][2] : '';

        const realUrl = extractRealUrl(rawHref);
        const title = cleanHtml(rawTitle);
        const snippet = cleanHtml(rawSnippet);

        if (!title || !realUrl.startsWith('http')) continue;

        const domain = extractDomain(realUrl);
        const category = classifyRelatedMediaCategory(title, snippet);

        results.push({
          id: `web:${realUrl}`,
          title,
          description: snippet || undefined,
          source: {
            provider: domain,
            url: realUrl,
          },
          type: category === 'review' ? 'review' : 'article',
          category: category === 'other' ? 'review' : category,
          creator: { name: domain },
        });
      }

      return results;
    } catch {
      // Provider isolation
      return [];
    }
  }
}
