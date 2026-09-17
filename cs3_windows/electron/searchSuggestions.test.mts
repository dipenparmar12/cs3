import { test } from 'node:test';
import assert from 'node:assert/strict';

import { setHttpFetch } from './torrent/http.ts';
import {
  SearchSuggestionService,
  bigramSimilarity,
  collapseTitle,
  matchableNames,
  stillMatches,
} from './searchSuggestions.ts';
import { TvType, type SearchSuggestion } from '../src/types/api.ts';

/**
 * Autocomplete: the parts where a wrong answer is silent.
 *
 * Three things are pinned here and they are the three that cannot be seen by
 * looking at the dropdown.
 *
 * **That nothing waits for everything.** The measured spread between the
 * fastest catalogue and the slowest is 170 ms against 935 ms, and the version
 * this replaces paid the 935 on every keystroke because `Promise.allSettled`
 * resolves once. A regression there does not break anything — it just makes the
 * feature feel exactly as slow as it did before, which is not something a test
 * of the returned list would notice.
 *
 * **That a superseded query stops costing anything.** A search box issues a
 * request per word, and each one is a fan-out to three third-party hosts; if
 * the abort stops being honoured, typing a title quietly becomes nine
 * concurrent scrapes and nothing on screen says so.
 *
 * **That the instant answer is actually instant.** `instant()` is synchronous
 * precisely so it cannot grow an await, and a prefix hit is what makes the
 * second keystroke of a word draw with no network at all.
 *
 * The fixtures are hand-built from each endpoint's measured shape — the field
 * names were read off live responses while this was written (`imdb_id`,
 * `releaseInfo`, `externals.imdb`, `title { romaji english native }`) — so they
 * pin the parsing and the merging, not the reachability of the hosts.
 */

type Handler = (url: string, init?: RequestInit) => unknown;

/**
 * Installs a fake transport and reports what it was asked for.
 *
 * `gate` is what makes the ordering tests deterministic rather than timed. A
 * request whose URL matches it hangs until `release()` is called, so "the
 * answer arrived while that host was still thinking" is an assertion about
 * sequence and not about how fast a machine happens to be — the whole point
 * being that a timing test for a latency fix is the kind that passes on the
 * developer's laptop and fails in the evening.
 */
function stubFetch(
  handler: Handler,
  gate?: string
): {
  calls: string[];
  aborted: string[];
  release: () => void;
  restore: () => void;
} {
  const calls: string[] = [];
  const aborted: string[] = [];
  const held: Array<() => void> = [];
  let open = false;

  const release = () => {
    open = true;
    while (held.length) held.pop()!();
  };

  setHttpFetch(async (input, init) => {
    const url = typeof input === 'string' ? input : String(input);
    calls.push(url);

    const body = await new Promise<unknown>((resolve, reject) => {
      const finish = () => resolve(handler(url, init as RequestInit));
      const signal = (init as RequestInit | undefined)?.signal;
      if (signal?.aborted) {
        aborted.push(url);
        reject(new Error('aborted'));
        return;
      }
      signal?.addEventListener('abort', () => {
        aborted.push(url);
        reject(new Error('aborted'));
      });

      if (gate && url.includes(gate) && !open) {
        held.push(finish);
        return;
      }
      // A macrotask, so an abort issued in the same tick lands first — which is
      // exactly the race a keystroke creates.
      setTimeout(finish, 5);
    });

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  return { calls, aborted, release, restore: () => setHttpFetch((i, init) => fetch(i, init)) };
}

const CINEMETA_MOVIE = {
  metas: [
    {
      id: 'tt0145487',
      imdb_id: 'tt0145487',
      name: 'Spider-Man',
      releaseInfo: '2002',
      poster: 'https://example.invalid/spider.jpg',
    },
  ],
};

const TVMAZE_SHOWS = [
  {
    show: {
      id: 1,
      name: 'Spider-Man',
      premiered: '1994-11-19',
      genres: ['Animation'],
      type: 'Animation',
      language: 'English',
      externals: { imdb: 'tt0112175' },
    },
  },
];

const ANILIST_PAGE = {
  data: {
    Page: {
      media: [
        {
          id: 16498,
          title: { romaji: 'Shingeki no Kyojin', english: 'Attack on Titan', native: '進撃の巨人' },
          synonyms: ['AoT'],
          countryOfOrigin: 'JP',
          startDate: { year: 2013 },
          genres: ['Action'],
          format: 'TV',
          coverImage: { large: 'https://example.invalid/aot.jpg' },
        },
      ],
    },
  },
};

function route(url: string): unknown {
  if (url.includes('/catalog/movie/')) return CINEMETA_MOVIE;
  if (url.includes('/catalog/series/')) return { metas: [] };
  if (url.includes('api.tvmaze.com')) return TVMAZE_SHOWS;
  if (url.includes('graphql.anilist.co')) return ANILIST_PAGE;
  if (url.includes('/meta/')) return { meta: { genres: ['Action'], description: 'A film.' } };
  return {};
}

// --- the collapsed comparison ---------------------------------------------

test('a title and its unspaced spelling are one word', () => {
  assert.equal(collapseTitle('Spider-Man'), 'spiderman');
  assert.equal(collapseTitle('spider man'), 'spiderman');
  assert.equal(collapseTitle('SPIDER  MAN'), 'spiderman');
});

test('bigram similarity survives a misspelling that shares no whole token', () => {
  // The entire reason this measure exists beside `titleSimilarity`.
  assert.ok(bigramSimilarity('spidrman', 'spiderman') > 0.6);
  assert.ok(bigramSimilarity('brakin bad', 'breaking bad') > 0.6);
  assert.equal(bigramSimilarity('', 'anything'), 0);
});

// --- matching against every name a row answers to --------------------------

const AOT: SearchSuggestion = {
  title: 'Attack on Titan',
  originalTitle: '進撃の巨人',
  alternateTitles: ['Shingeki no Kyojin'],
  genres: [],
  url: 'cs3meta://anilist/16498',
  sources: ['AniList'],
};

test('a row answers to its aliases, not only to its displayed title', () => {
  assert.deepEqual(matchableNames(AOT), ['Attack on Titan', '進撃の巨人', 'Shingeki no Kyojin']);
  assert.equal(stillMatches(AOT, 'shingeki'), true);
  assert.equal(stillMatches(AOT, 'attack'), true);
  assert.equal(stillMatches(AOT, 'titan'), true);
  assert.equal(stillMatches(AOT, 'breaking'), false);
});

test('an empty query matches everything rather than nothing', () => {
  // Used to re-filter a cached list; refusing everything would blank the
  // dropdown on the way back to an empty box.
  assert.equal(stillMatches(AOT, '   '), true);
});

// --- the instant path ------------------------------------------------------

test('a cold query has no instant answer and says it is not finished', () => {
  const service = new SearchSuggestionService();
  const answer = service.instant('spider');
  assert.deepEqual(answer.suggestions, []);
  assert.equal(
    answer.done,
    false,
    'calling a cold miss "done" would stop the caller ever replacing it'
  );
});

test('a second keystroke is answered from the first, with no I/O', async () => {
  const stub = stubFetch(route);
  try {
    const service = new SearchSuggestionService();
    await service.suggest('spider');
    const before = stub.calls.length;

    const answer = service.instant('spiderm');

    assert.equal(stub.calls.length, before, 'the instant path must not touch the network');
    assert.ok(answer.suggestions.length > 0, 'the cached rows still match the longer query');
    assert.equal(
      answer.done,
      false,
      'last keystroke re-filtered is provisional, however good it looks'
    );
  } finally {
    stub.restore();
  }
});

test('the narrowed answer drops rows the longer query excludes', async () => {
  // Only Cinemeta answers, so the assertion is about the narrowing and not
  // about how many distinct works happen to be called Spider-Man.
  const stub = stubFetch((url) => {
    if (url.includes('/catalog/movie/')) {
      return {
        metas: [
          { id: 'tt1', imdb_id: 'tt1', name: 'Spider-Man', releaseInfo: '2002' },
          { id: 'tt2', imdb_id: 'tt2', name: 'Spirited Away', releaseInfo: '2001' },
        ],
      };
    }
    if (url.includes('/catalog/series/')) return { metas: [] };
    if (url.includes('api.tvmaze.com')) return [];
    if (url.includes('graphql.anilist.co')) return { data: { Page: { media: [] } } };
    return route(url);
  });
  try {
    const service = new SearchSuggestionService();
    await service.suggest('spi');

    const titles = service.instant('spider').suggestions.map((s) => s.title);
    assert.deepEqual(titles, ['Spider-Man']);
  } finally {
    stub.restore();
  }
});

test('an exact repeat is served finished, and asks nothing', async () => {
  const stub = stubFetch(route);
  try {
    const service = new SearchSuggestionService();
    await service.suggest('spider');
    const before = stub.calls.length;

    const answer = service.instant('SPIDER');
    assert.equal(answer.done, true);
    assert.ok(answer.suggestions.length > 0);
    assert.equal(stub.calls.length, before);
  } finally {
    stub.restore();
  }
});

// --- progressive delivery --------------------------------------------------

test('a fast catalogue reaches the screen while a slow one is still thinking', async () => {
  // Cinemeta held open, standing in for the 935 ms it was measured at; the
  // other two answer normally. This is the defect being pinned: the version
  // this replaces published nothing until every source had landed, so the
  // fastest two were spent waiting on the slowest.
  const stub = stubFetch(route, '/catalog/');
  try {
    const service = new SearchSuggestionService();
    const snapshots: Array<{ count: number; done: boolean }> = [];

    const running = service.suggest('attack on titan', undefined, (suggestions, done) => {
      snapshots.push({ count: suggestions.length, done });
    });

    // Long enough for the ungated sources to land and publish; the gated one
    // cannot resolve at all until `release()`.
    await new Promise((resolve) => setTimeout(resolve, 60));

    assert.ok(
      snapshots.some((snapshot) => snapshot.count > 0 && !snapshot.done),
      'nothing reached the caller while a host was outstanding — rows are being batched'
    );

    stub.release();
    await running;

    assert.equal(snapshots.at(-1)?.done, true, 'the last snapshot is the finished one');
    assert.ok(
      snapshots.slice(0, -1).every((snapshot) => snapshot.done === false),
      'only the last snapshot may claim to be finished'
    );
  } finally {
    stub.restore();
  }
});

test('the answer does not wait for the genre lookup behind it', async () => {
  // The `/meta/` endpoint never answers. If the returned promise still
  // resolves, the enrich is genuinely behind the answer; if it hangs, the
  // decoration is holding back the list exactly as it used to.
  const stub = stubFetch(route, '/meta/');
  try {
    const service = new SearchSuggestionService();

    const rows = await Promise.race([
      service.suggest('spider'),
      new Promise<'timed out'>((resolve) => setTimeout(() => resolve('timed out'), 400)),
    ]);

    assert.notEqual(
      rows,
      'timed out',
      'a genre chip must not hold back the list — measured at 52–388ms of pure delay'
    );
    assert.ok(Array.isArray(rows) && rows.length > 0);
    assert.ok(
      stub.calls.some((url) => url.includes('/meta/')),
      'the enrich must still run — behind the answer, not instead of it'
    );
  } finally {
    stub.release();
    stub.restore();
  }
});

// --- cost control ----------------------------------------------------------

test('a single character asks one catalogue, not three', async () => {
  const stub = stubFetch(route);
  try {
    const service = new SearchSuggestionService();
    await service.suggest('s');

    assert.equal(stub.calls.filter((url) => url.includes('api.tvmaze.com')).length, 0);
    assert.equal(stub.calls.filter((url) => url.includes('anilist')).length, 0);
    assert.ok(stub.calls.some((url) => url.includes('/catalog/movie/')));
  } finally {
    stub.restore();
  }
});

test('an aborted query stops its fan-out', async () => {
  const stub = stubFetch(route);
  try {
    const service = new SearchSuggestionService();
    const controller = new AbortController();

    const running = service.suggest('spider', controller.signal);
    controller.abort();
    await running;

    assert.ok(
      stub.aborted.length > 0,
      'a superseded keystroke must stop costing three third-party hosts anything'
    );
  } finally {
    stub.restore();
  }
});

// --- merging and ranking ---------------------------------------------------

test('an alias match outranks an unrelated row', async () => {
  const stub = stubFetch((url) => {
    if (url.includes('/catalog/movie/')) {
      return { metas: [{ id: 'tt9', imdb_id: 'tt9', name: 'Shin Godzilla', releaseInfo: '2016' }] };
    }
    if (url.includes('/catalog/series/')) return { metas: [] };
    if (url.includes('api.tvmaze.com')) return [];
    return route(url);
  });
  try {
    const service = new SearchSuggestionService();
    const rows = await service.suggest('shingeki');
    assert.equal(
      rows[0]?.title,
      'Attack on Titan',
      'the romaji is a name this work answers to; scoring only the English title loses it'
    );
  } finally {
    stub.restore();
  }
});

test('the native spelling and the aliases travel with the row', async () => {
  const stub = stubFetch(route);
  try {
    const service = new SearchSuggestionService();
    const rows = await service.suggest('attack on titan');
    const aot = rows.find((row) => row.title === 'Attack on Titan');

    assert.equal(aot?.originalTitle, '進撃の巨人');
    assert.ok(aot?.alternateTitles?.includes('Shingeki no Kyojin'));
    assert.equal(aot?.language, 'Japanese');
    assert.ok(
      !aot?.alternateTitles?.some((alias) => collapseTitle(alias) === collapseTitle(aot.title)),
      'an alias identical to the displayed title is noise on the wire and in the ranking'
    );
  } finally {
    stub.restore();
  }
});

test('an anime type survives a catalogue that does not model anime', async () => {
  const stub = stubFetch((url) => {
    if (url.includes('/catalog/series/')) {
      return {
        metas: [{ id: 'tt2', imdb_id: 'tt2', name: 'Attack on Titan', releaseInfo: '2013' }],
      };
    }
    if (url.includes('/catalog/movie/')) return { metas: [] };
    if (url.includes('api.tvmaze.com')) return [];
    return route(url);
  });
  try {
    const service = new SearchSuggestionService();
    const rows = await service.suggest('attack on titan');
    const aot = rows.find((row) => row.title === 'Attack on Titan');
    assert.equal(
      aot?.type,
      TvType.Anime,
      'a mislabelled anime searches anime-only indexers for nothing'
    );
  } finally {
    stub.restore();
  }
});

// --- ranking ---------------------------------------------------------------

test('a franchise is ordered by its catalogue, not by which subtitle is shortest', async () => {
  // Measured against the live Cinemeta reply for `dune`, which ranks
  // Part Two, Part One and Part Three at positions 0, 1 and 2. The scorer used
  // to put `Dune Drifter` above all three: bigram overlap scores a short tail
  // higher (0.67 against 0.50) and the word-count penalty charged the sequels
  // for words the viewer had not typed yet, so an obscure 2020 film outranked
  // the film the query obviously meant.
  const stub = stubFetch((url) => {
    if (url.includes('/catalog/movie/')) {
      return {
        metas: [
          { id: 'tt15239678', imdb_id: 'tt15239678', name: 'Dune: Part Two', releaseInfo: '2024' },
          { id: 'tt1160419', imdb_id: 'tt1160419', name: 'Dune: Part One', releaseInfo: '2021' },
          { id: 'tt11835714', imdb_id: 'tt11835714', name: 'Dune Drifter', releaseInfo: '2020' },
          { id: 'tt0099474', imdb_id: 'tt0099474', name: 'Dune Warriors', releaseInfo: '1991' },
        ],
      };
    }
    if (url.includes('/catalog/series/')) return { metas: [] };
    if (url.includes('api.tvmaze.com')) return [];
    if (url.includes('graphql.anilist.co')) return { data: { Page: { media: [] } } };
    return route(url);
  });
  try {
    const rows = await new SearchSuggestionService().suggest('dune');
    const titles = rows.map((row) => row.title);

    assert.ok(
      titles.indexOf('Dune: Part One') < titles.indexOf('Dune Drifter'),
      'the catalogue ranked Part One second; a shorter title must not overtake it'
    );
    assert.deepEqual(titles.slice(0, 2), ['Dune: Part Two', 'Dune: Part One']);
  } finally {
    stub.restore();
  }
});

test('an exact title still beats a longer one that merely starts with the query', async () => {
  // The other direction, and the reason the prefix floor sits *below* the exact
  // bonus rather than replacing it: typing a whole title must find that title.
  const stub = stubFetch((url) => {
    if (url.includes('/catalog/movie/')) {
      return {
        metas: [
          { id: 'tt2', imdb_id: 'tt2', name: 'Dune: Part Two', releaseInfo: '2024' },
          { id: 'tt1', imdb_id: 'tt1', name: 'Dune', releaseInfo: '1984' },
        ],
      };
    }
    if (url.includes('/catalog/series/')) return { metas: [] };
    if (url.includes('api.tvmaze.com')) return [];
    if (url.includes('graphql.anilist.co')) return { data: { Page: { media: [] } } };
    return route(url);
  });
  try {
    const rows = await new SearchSuggestionService().suggest('dune');
    assert.equal(rows[0]?.title, 'Dune', 'even from second place in the catalogue');
  } finally {
    stub.restore();
  }
});

test('a merged row has one identity, whichever host answered first', async () => {
  // The sources publish as they land, so `found` accumulates in arrival order —
  // a property of three third-party hosts on the night. The merge keeps the
  // first candidate's title and URL, and that URL travels with a picked
  // suggestion as `ExactMedia.url`. Without a fixed precedence the same query
  // would name the same work differently between runs.
  // Cinemeta held shut until TVmaze has landed and published, so the arrival
  // order is the reverse of the one the old `Promise.allSettled` produced. The
  // row must still come out the same.
  const stub = stubFetch((url) => {
    if (url.includes('/catalog/movie/')) {
      return { metas: [{ id: 'tt1', imdb_id: 'tt1', name: 'One Piece', releaseInfo: '1999' }] };
    }
    if (url.includes('/catalog/series/')) return { metas: [] };
    if (url.includes('api.tvmaze.com')) {
      return [{ show: { id: 7, name: 'One Piece!', premiered: '1999-10-20', genres: [] } }];
    }
    if (url.includes('graphql.anilist.co')) return { data: { Page: { media: [] } } };
    return route(url);
  }, '/catalog/');

  try {
    const service = new SearchSuggestionService();
    const order: string[] = [];

    const running = service.suggest('one piece', undefined, (suggestions) => {
      for (const row of suggestions) for (const source of row.sources) {
        if (!order.includes(source)) order.push(source);
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(order[0], 'TVmaze', 'the test has to actually win the race it describes');

    stub.release();
    const rows = await running;
    const merged = rows.find((row) => row.sources.length > 1);

    assert.ok(merged, 'the two catalogues describe one work and must merge');
    assert.equal(
      merged.title,
      'One Piece',
      'Cinemeta shapes the row regardless of who answered first'
    );
    assert.ok(merged.url.startsWith('cs3meta://cinemeta/'));
  } finally {
    stub.release();
    stub.restore();
  }
});
