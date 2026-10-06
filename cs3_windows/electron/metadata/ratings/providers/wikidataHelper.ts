import { fetchJson } from '../../../torrent/http.ts';
import type { WikidataReviewStatement } from '../types.ts';

const WIKIDATA_SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';
const WIKIDATA_USER_AGENT = 'CloudStream/4.8 (contact: info@cloudstream.cfd)';
const QUERY_TIMEOUT_MS = 12_000;

interface SparqlBinding {
  reviewer?: { type: string; value: string };
  reviewerLabel?: { type: string; value: string };
  criterion?: { type: string; value: string };
  criterionLabel?: { type: string; value: string };
  score?: { type: string; value: string };
  reviews?: { type: string; value: string };
}

interface SparqlResponse {
  results?: {
    bindings?: SparqlBinding[];
  };
}

/**
 * Queries Wikidata P444 (review score) statements for a canonical IMDb id.
 * Pure, isolated, keyless, and failure-tolerant.
 */
export async function fetchWikidataReviewStatements(
  imdbId: string
): Promise<WikidataReviewStatement[]> {
  const cleanId = imdbId.trim();
  if (!/^tt\d+$/i.test(cleanId)) {
    return [];
  }

  const sparql = `SELECT ?score ?reviewer ?reviewerLabel ?criterion ?criterionLabel ?reviews WHERE {
  ?item wdt:P345 "${cleanId}" .
  ?item p:P444 ?s .
  ?s ps:P444 ?score .
  OPTIONAL { ?s pq:P447 ?reviewer . }
  OPTIONAL { ?s pq:P459 ?criterion . }
  OPTIONAL { ?s pq:P7887 ?reviews . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;

  try {
    const url = `${WIKIDATA_SPARQL_ENDPOINT}?format=json&query=${encodeURIComponent(sparql)}`;
    const data = await fetchJson<SparqlResponse>(url, {
      headers: {
        'User-Agent': WIKIDATA_USER_AGENT,
        Accept: 'application/sparql-results+json,application/json',
      },
      timeoutMs: QUERY_TIMEOUT_MS,
    });

    const bindings = data.results?.bindings ?? [];
    return bindings.map((b) => ({
      reviewer: b.reviewer?.value,
      reviewerLabel: b.reviewerLabel?.value,
      criterion: b.criterion?.value,
      criterionLabel: b.criterionLabel?.value,
      score: b.score?.value,
      reviews: b.reviews?.value,
    }));
  } catch (error) {
    // Wikidata under load or SPARQL syntax/timeout issues should fail cleanly
    // without affecting the rest of the application.
    return [];
  }
}
