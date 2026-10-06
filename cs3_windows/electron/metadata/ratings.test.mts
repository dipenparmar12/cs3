import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RatingCache, buildRatingCacheKey } from './ratings/ratingCache.ts';
import { IMDbRatingProvider } from './ratings/providers/imdbProvider.ts';
import { RottenTomatoesRatingProvider } from './ratings/providers/rottenTomatoesProvider.ts';
import { MetacriticRatingProvider } from './ratings/providers/metacriticProvider.ts';
import { TMDBRatingProvider } from './ratings/providers/tmdbProvider.ts';
import { MediaRatingService } from './ratings/mediaRatingService.ts';
import { formatDeltaSeconds } from '../../src/components/player/timeDisplay.ts';
import type { CanonicalMediaIdentity, MediaRating, RatingProvider, WikidataReviewStatement } from '../../src/types/ratings.ts';

test('buildRatingCacheKey creates canonical deterministic keys', () => {
  assert.equal(
    buildRatingCacheKey({ title: 'The Dark Knight', imdbId: 'tt0468569' }),
    'imdb:tt0468569'
  );
  assert.equal(
    buildRatingCacheKey({ title: 'The Dark Knight', tmdbId: 155 }),
    'tmdb:155'
  );
  assert.equal(
    buildRatingCacheKey({ title: 'Dune: Part Two', year: 2024 }),
    'title:dune part two:2024'
  );
});

test('RatingCache stores, retrieves, and checks staleness', () => {
  const cache = new RatingCache();
  const identity: CanonicalMediaIdentity = { title: 'Test Movie', imdbId: 'tt1234567' };
  const ratings: MediaRating[] = [
    {
      source: 'imdb',
      score: 8.5,
      maxScore: 10,
      displayValue: '8.5/10',
      fetchedAt: Date.now(),
    },
  ];

  cache.set(identity, ratings);
  const result = cache.get(identity);
  assert.ok(result.entry);
  assert.equal(result.isStale, false);
  assert.equal(result.entry.ratings[0].score, 8.5);

  cache.delete(identity);
  assert.equal(cache.get(identity).entry, null);
});

test('IMDbRatingProvider parses Wikidata review statements', async () => {
  const provider = new IMDbRatingProvider();
  const identity: CanonicalMediaIdentity = { title: 'Interstellar', imdbId: 'tt0816692' };
  const mockStatements: WikidataReviewStatement[] = [
    {
      reviewer: 'http://www.wikidata.org/entity/Q37312',
      reviewerLabel: 'IMDb',
      criterionLabel: 'weighted average',
      score: '8.7/10',
      reviews: '2500000',
    },
  ];

  const rating = await provider.fetch(identity, {
    wikidataStatements: Promise.resolve(mockStatements),
  });

  assert.ok(rating);
  assert.equal(rating.source, 'imdb');
  assert.equal(rating.score, 8.7);
  assert.equal(rating.maxScore, 10);
  assert.equal(rating.displayValue, '8.7/10');
  assert.equal(rating.voteCount, 2500000);
  assert.equal(rating.url, 'https://www.imdb.com/title/tt0816692/');
});

test('RottenTomatoesRatingProvider parses critics and audience scores', async () => {
  const provider = new RottenTomatoesRatingProvider();
  const identity: CanonicalMediaIdentity = { title: 'The Dark Knight', imdbId: 'tt0468569' };
  const mockStatements: WikidataReviewStatement[] = [
    {
      reviewer: 'http://www.wikidata.org/entity/Q105584',
      reviewerLabel: 'Rotten Tomatoes',
      criterionLabel: 'Tomatometer score',
      score: '94%',
      reviews: '341',
    },
    {
      reviewer: 'http://www.wikidata.org/entity/Q105584',
      reviewerLabel: 'Rotten Tomatoes',
      criterionLabel: 'Popcornmeter score',
      score: '91%',
    },
  ];

  const rating = await provider.fetch(identity, {
    wikidataStatements: Promise.resolve(mockStatements),
  });

  assert.ok(rating);
  assert.equal(rating.source, 'rottenTomatoes');
  assert.equal(rating.score, 94);
  assert.equal(rating.criticsScore, 94);
  assert.equal(rating.audienceScore, 91);
  assert.equal(rating.displayValue, 'Critics 94% · Audience 91%');
  assert.equal(rating.voteCount, 341);
});

test('MetacriticRatingProvider parses Metascore and User score', async () => {
  const provider = new MetacriticRatingProvider();
  const identity: CanonicalMediaIdentity = { title: 'The Dark Knight', imdbId: 'tt0468569' };
  const mockStatements: WikidataReviewStatement[] = [
    {
      reviewer: 'http://www.wikidata.org/entity/Q210394',
      reviewerLabel: 'Metacritic',
      criterionLabel: 'Metascore',
      score: '84/100',
      reviews: '39',
    },
    {
      reviewer: 'http://www.wikidata.org/entity/Q210394',
      reviewerLabel: 'Metacritic',
      criterionLabel: 'user score',
      score: '8.5/10',
    },
  ];

  const rating = await provider.fetch(identity, {
    wikidataStatements: Promise.resolve(mockStatements),
  });

  assert.ok(rating);
  assert.equal(rating.source, 'metacritic');
  assert.equal(rating.score, 84);
  assert.equal(rating.userScore, 8.5);
  assert.equal(rating.displayValue, 'Metascore 84/100 · User 8.5/10');
  assert.equal(rating.voteCount, 39);
});

test('TMDBRatingProvider returns null gracefully when no API key is configured', async () => {
  const provider = new TMDBRatingProvider();
  const identity: CanonicalMediaIdentity = { title: 'Dune', tmdbId: 438631 };

  const rating = await provider.fetch(identity, {});
  assert.equal(rating, null);
});

test('MediaRatingService enforces provider failure isolation and ordering', async () => {
  const failingProvider: RatingProvider = {
    id: 'rottenTomatoes',
    name: 'Rotten Tomatoes',
    fetch: async () => {
      throw new Error('Connection refused by origin');
    },
  };

  const emptyProvider: RatingProvider = {
    id: 'metacritic',
    name: 'Metacritic',
    fetch: async () => null,
  };

  const workingImdb: RatingProvider = {
    id: 'imdb',
    name: 'IMDb',
    fetch: async () => ({
      source: 'imdb',
      score: 9.0,
      maxScore: 10,
      displayValue: '9.0/10',
      fetchedAt: Date.now(),
    }),
  };

  const workingTmdb: RatingProvider = {
    id: 'tmdb',
    name: 'TMDB',
    fetch: async () => ({
      source: 'tmdb',
      score: 8.5,
      maxScore: 10,
      displayValue: '8.5/10',
      fetchedAt: Date.now(),
    }),
  };

  const service = new MediaRatingService([
    failingProvider,
    workingTmdb,
    emptyProvider,
    workingImdb,
  ]);

  const identity: CanonicalMediaIdentity = { title: 'Isolated Movie', imdbId: 'tt9999999' };
  const result = await service.getRatings(identity);

  assert.equal(result.ok, true);
  assert.equal(result.ratings.length, 2);
  // Stable sort order: IMDb first, then TMDB
  assert.equal(result.ratings[0].source, 'imdb');
  assert.equal(result.ratings[0].score, 9.0);
  assert.equal(result.ratings[1].source, 'tmdb');
  assert.equal(result.ratings[1].score, 8.5);
});

test('formatDeltaSeconds formats positive and negative seek deltas correctly', () => {
  assert.equal(formatDeltaSeconds(15), '+15s');
  assert.equal(formatDeltaSeconds(75), '+1m 15s');
  assert.equal(formatDeltaSeconds(120), '+2m');
  assert.equal(formatDeltaSeconds(3665), '+1h 1m');
  assert.equal(formatDeltaSeconds(-45), '-45s');
  assert.equal(formatDeltaSeconds(-130), '-2m 10s');
});
