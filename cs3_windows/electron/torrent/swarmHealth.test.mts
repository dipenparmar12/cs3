/**
 * What the swarm diagnosis is allowed to claim.
 *
 *   bun run test:swarm
 *   node --experimental-strip-types electron/torrent/swarmHealth.test.mts
 *
 * These rows exist because every wrong answer here is confidently wrong. A
 * diagnosis that reports "you are firewalled" during the first ten seconds of
 * every torrent sends users to change router settings that were never the
 * problem, and one that never reports it leaves them believing the app is just
 * slow. Both are worse than no diagnosis at all, so the thresholds are pinned.
 */
import assert from 'node:assert/strict';
import {
  censusPeers,
  classifyPeer,
  diagnoseSwarm,
  summariseSwarm,
  SWARM_PROFILES,
  type SwarmObservation,
} from './swarmHealth.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

const base: SwarmObservation = {
  census: { total: 0, incoming: 0, outgoing: 0, webSeed: 0, webrtc: 0 },
  ageMs: 0,
  mode: 'download',
  utpAvailable: true,
  listenPort: 6881,
  maxConns: 200,
};

const ids = (o: SwarmObservation) => diagnoseSwarm(o).map((f) => f.id);

// --- peer classification ---------------------------------------------------

test('incoming and outgoing peers are told apart', () => {
  assert.equal(classifyPeer('tcpIncoming'), 'incoming');
  assert.equal(classifyPeer('utpIncoming'), 'incoming');
  assert.equal(classifyPeer('tcpOutgoing'), 'outgoing');
  assert.equal(classifyPeer('utpOutgoing'), 'outgoing');
});

test('a web seed is not counted as a peer that reached us', () => {
  // A web seed is an HTTP server we dialled. Counting it as incoming would
  // report every torrent with a web seed as reachable.
  assert.equal(classifyPeer('webSeed'), 'webSeed');
});

test('an unknown peer type counts as outgoing', () => {
  // Over-reporting reachability is the failure that matters: it hides the one
  // limitation the user could actually act on.
  assert.equal(classifyPeer('somethingNew'), 'outgoing');
  assert.equal(classifyPeer(undefined), 'outgoing');
});

test('the census counts every class', () => {
  const census = censusPeers([
    { type: 'tcpIncoming' },
    { type: 'utpOutgoing' },
    { type: 'utpOutgoing' },
    { type: 'webSeed' },
    { type: 'webrtc' },
  ]);
  assert.deepEqual(census, { total: 5, incoming: 1, outgoing: 2, webSeed: 1, webrtc: 1 });
});

// --- reachability ----------------------------------------------------------

test('reachability is not judged before peers have had time to dial', () => {
  // A tracker announce and a DHT bootstrap both have to finish first. Judging
  // at ten seconds reports every healthy torrent as firewalled.
  const found = ids({ ...base, ageMs: 10_000 });
  assert.ok(found.includes('reachability-unknown'));
  assert.ok(!found.includes('unreachable'));
});

test('no incoming peer after the grace period is reported as a limit', () => {
  const found = ids({ ...base, ageMs: 120_000, census: { ...base.census, total: 40, outgoing: 40 } });
  assert.ok(found.includes('unreachable'));
});

test('one incoming peer is proof of reachability, at any age', () => {
  const found = ids({
    ...base,
    ageMs: 5_000,
    census: { total: 3, incoming: 1, outgoing: 2, webSeed: 0, webrtc: 0 },
  });
  assert.ok(found.includes('reachable'));
  assert.ok(!found.includes('unreachable'));
});

test('a web seed alone does not prove reachability', () => {
  const found = ids({
    ...base,
    ageMs: 120_000,
    census: { total: 1, incoming: 0, outgoing: 0, webSeed: 1, webrtc: 0 },
  });
  assert.ok(found.includes('unreachable'));
});

// --- what is and is not our fault -----------------------------------------

test('a thin swarm is named as the swarm, not as a setting to change', () => {
  const finding = diagnoseSwarm({
    ...base,
    ageMs: 120_000,
    census: { total: 2, incoming: 1, outgoing: 1, webSeed: 0, webrtc: 0 },
  }).find((f) => f.id === 'thin-swarm');
  assert.ok(finding);
  assert.match(finding.advice ?? '', /different source/i);
});

test('a swarm with no peers at all is not called thin', () => {
  // Zero peers is "still looking" or "dead", and both are already covered.
  // Reporting "only 0 peers connected" as a finding is a sentence that helps
  // nobody.
  assert.ok(!ids({ ...base, ageMs: 120_000 }).includes('thin-swarm'));
});

test('the connection ceiling is reported only when it is reached', () => {
  const under = ids({ ...base, census: { ...base.census, total: 40, outgoing: 40 } });
  assert.ok(!under.includes('connection-ceiling'));

  const at = ids({ ...base, census: { ...base.census, total: 200, outgoing: 200 } });
  assert.ok(at.includes('connection-ceiling'));
});

test('missing uTP is reported as a limit', () => {
  assert.ok(ids({ ...base, utpAvailable: false }).includes('no-utp'));
  assert.ok(!ids({ ...base, utpAvailable: true }).includes('no-utp'));
});

test('streaming names its own cost', () => {
  // The user asked why a torrent is slow. "Because it is fetching in order so
  // you could press play" is the honest answer, and it points at the download
  // that does not pay it.
  assert.ok(ids({ ...base, mode: 'stream' }).includes('sequential-cost'));
  assert.ok(!ids({ ...base, mode: 'download' }).includes('sequential-cost'));
});

// --- the strategy split ----------------------------------------------------

test('a download fetches out of order and a stream does not', () => {
  // The whole throughput argument. Sequential leaves a peer idle whenever it
  // lacks the one next piece; a download has no reason to accept that.
  assert.equal(SWARM_PROFILES.download.strategy, 'rarest');
  assert.equal(SWARM_PROFILES.stream.strategy, 'sequential');
});

test('only a stream front-loads the header and index', () => {
  assert.equal(SWARM_PROFILES.stream.prioritiseHeadAndTail, true);
  assert.equal(SWARM_PROFILES.download.prioritiseHeadAndTail, false);
});

// --- the one-line summary --------------------------------------------------

test('the summary leads with the limit, not the peer count', () => {
  const observation: SwarmObservation = {
    ...base,
    ageMs: 120_000,
    census: { total: 40, incoming: 0, outgoing: 40, webSeed: 0, webrtc: 0 },
  };
  const line = summariseSwarm(diagnoseSwarm(observation), observation.census);
  assert.match(line, /No peer has connected to you/);
});

test('a healthy swarm gets a plain sentence rather than a complaint', () => {
  const observation: SwarmObservation = {
    ...base,
    ageMs: 120_000,
    census: { total: 40, incoming: 4, outgoing: 36, webSeed: 0, webrtc: 0 },
  };
  const line = summariseSwarm(diagnoseSwarm(observation), observation.census);
  assert.equal(line, 'Connected to 40 peers');
});

test('no peers yet reads as looking, not as a failure', () => {
  const line = summariseSwarm(diagnoseSwarm({ ...base, ageMs: 1_000 }), base.census);
  assert.equal(line, 'Looking for peers');
});

// --- runner ----------------------------------------------------------------

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL ${name}`);
    console.log(`       ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(failed === 0 ? `\n${tests.length} passed` : `\n${failed} of ${tests.length} FAILED`);
process.exit(failed === 0 ? 0 : 1);
