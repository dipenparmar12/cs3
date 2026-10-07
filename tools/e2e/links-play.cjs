/**
 * Stage two of `links-e2e.mjs`: can the app actually fetch these links?
 *
 * Run under Electron so requests go through `net.fetch` — Chromium's network
 * stack, as `MediaProxy` uses it — with the provider's own headers. For HLS it
 * walks master → variant → first segment, because a playable master over dead
 * segments is the commonest "it opened and never started". Each link is also
 * tried under Chromium's default referrer policy, to show what the app did
 * before `referrerPolicy: 'unsafe-url'`.
 *
 *   node_modules/electron/dist/electron tools/e2e/links-play.cjs links.json
 */
const { app, net } = require('electron');
const fs = require('node:fs');

const file = process.argv.find((a) => a.endsWith('.json'));
const cases = JSON.parse(fs.readFileSync(file, 'utf8'));

function sniff(buf, ct) {
  const b = Buffer.from(buf);
  const head = b.subarray(0, 16).toString('latin1');
  if (head.startsWith('#EXTM3U')) return 'm3u8';
  if (b[0] === 0x47) return 'ts';
  if (b.subarray(0, 4).toString('hex') === '89504e47' && b.indexOf(0x47, 8) > 0) return 'png+ts';
  if (b.subarray(0, 4).toString('hex') === '1a45dfa3') return 'mkv';
  if (b.subarray(4, 8).toString('latin1') === 'ftyp' || b.subarray(4, 8).toString('latin1') === 'styp') return 'mp4';
  if (/<MPD/i.test(b.subarray(0, 400).toString('latin1'))) return 'mpd';
  if (/^\s*</.test(head)) return 'html';
  return (ct || '?').split(';')[0];
}

async function get(url, headers, policy, bytes = 65535) {
  try {
    const init = { headers: { ...headers, Range: `bytes=0-${bytes}` }, signal: AbortSignal.timeout(20000) };
    if (policy) init.referrerPolicy = policy;
    const r = await net.fetch(url, init);
    const body = Buffer.from(await r.arrayBuffer());
    return { status: r.status, kind: sniff(body, r.headers.get('content-type')), body, url: r.url || url };
  } catch (e) {
    return { status: 0, kind: String(e.message).replace(/^net::/, ''), body: Buffer.alloc(0), url };
  }
}

const MEDIA = new Set(['ts', 'png+ts', 'mkv', 'mp4']);

async function check(link, policy) {
  const headers = { ...(link.headers ?? {}) };
  if (link.referer && !Object.keys(headers).some((k) => k.toLowerCase() === 'referer')) headers.Referer = link.referer;
  const first = await get(link.url, headers, policy);
  if (first.status >= 400 || first.status === 0) return `${first.status || 'ERR'} ${first.kind}`;
  if (first.kind === 'mpd') return 'PLAY mpd';
  if (MEDIA.has(first.kind)) return `PLAY ${first.kind}`;
  if (first.kind !== 'm3u8') return `?? ${first.status} ${first.kind}`;
  // master → variant → segment
  let playlist = first;
  for (let depth = 0; depth < 3; depth++) {
    const lines = playlist.body.toString('utf8').split(/\r?\n/);
    const next = lines.find((l) => l && !l.startsWith('#'));
    if (!next) return 'm3u8 with no entries';
    const target = new URL(next.trim(), playlist.url).href;
    const r = await get(target, headers, policy, 4095);
    if (r.status >= 400 || r.status === 0) return `m3u8→${depth ? 'segment' : 'child'} ${r.status || 'ERR'} ${r.kind}`;
    if (MEDIA.has(r.kind)) return `PLAY hls(${r.kind})`;
    if (r.kind !== 'm3u8') return `m3u8→${r.kind}?`;
    playlist = await get(target, headers, policy, 2_000_000);
  }
  return 'm3u8 too deep';
}

app.whenReady().then(async () => {
  const summary = [];
  for (const c of cases) {
    if (c.stage !== 'ok') {
      console.log(`✗ ${c.provider} / ${c.query}: ${c.stage} — ${String(c.error).slice(0, 120)}`);
      summary.push({ ...c, verdict: 'NO-LINKS' });
      continue;
    }
    const http = c.links.filter((l) => /^https?:/i.test(l.url) && !/TORRENT|MAGNET/.test(l.type ?? ''));
    const results = [];
    for (const link of http) {
      const now = await check(link, 'unsafe-url');
      const before = now.startsWith('PLAY') ? await check(link, undefined) : '';
      results.push({ host: new URL(link.url).hostname, now, before });
    }
    const playing = results.filter((r) => r.now.startsWith('PLAY')).length;
    const rescued = results.filter((r) => r.now.startsWith('PLAY') && !r.before.startsWith('PLAY')).length;
    console.log(`${playing ? '✓' : '✗'} ${c.provider} / "${c.title}": ${playing}/${results.length} play${rescued ? ` (${rescued} blocked before this fix)` : ''}`);
    for (const r of results) console.log(`     ${r.host}: ${r.now}${r.before && r.before !== r.now ? `  [before: ${r.before}]` : ''}`);
    summary.push({ provider: c.provider, query: c.query, playing, total: results.length, rescued });
  }
  fs.writeFileSync(file.replace(/\.json$/, '.verdict.json'), JSON.stringify(summary, null, 2));
  app.quit();
});
