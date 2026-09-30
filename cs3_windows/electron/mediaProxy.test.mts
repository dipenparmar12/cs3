/**
 * The proxy's manifest handling, against a stubbed origin.
 *
 *   bun run test:proxy
 *   node --experimental-strip-types electron/mediaProxy.test.mts
 *
 * This module earns tests because its failures are silent and are attributed to
 * the wrong thing. A DASH manifest served unmodified from loopback produces a
 * player asking this proxy for segment paths it has no route for — every segment
 * 404s, and the report that comes back is "the provider is broken". Nothing in
 * the manifest, the network log or the player says the rewriting is what went
 * wrong.
 *
 * The *origin* is a stub rather than a real server, and that is deliberate: a
 * real one would have to listen on 127.0.0.1, and `wrap` returns loopback URLs
 * untouched by design — so a socket-backed origin tests nothing, which is a
 * mistake worth only making once. Requests to the proxy itself are real HTTP.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { MediaProxy } from './mediaProxy.ts'

const MPD_RELATIVE = `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static">
 <Period>
  <AdaptationSet mimeType="video/mp4">
   <Representation id="0" bandwidth="800000">
    <SegmentTemplate media="chunk-$RepresentationID$-$Number%05d$.m4s" initialization="init-$RepresentationID$.m4s" startNumber="1"/>
   </Representation>
  </AdaptationSet>
 </Period>
</MPD>`

const MPD_WITH_BASE = `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011">
 <BaseURL>https://cdn.origin.test/v1/</BaseURL>
 <Period><AdaptationSet><Representation>
  <SegmentTemplate media="seg-$Number$.m4s" initialization="init.m4s"/>
 </Representation></AdaptationSet></Period>
</MPD>`

const MPD_ABSOLUTE = `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011">
 <Period><AdaptationSet><Representation>
  <SegmentTemplate media="https://cdn.origin.test/abs/seg-$Number$.m4s" initialization="https://cdn.origin.test/abs/init.m4s"/>
 </Representation></AdaptationSet></Period>
</MPD>`

const HLS_PLAYLIST = `#EXTM3U
#EXT-X-KEY:METHOD=AES-128,URI="key.bin"
#EXTINF:6.0,
seg1.ts
`

/**
 * An MPEG-TS segment the way Castle TV's CDN serves it: three aligned packets,
 * each opening with the sync byte, carrying 0x0A bytes and bytes above 0x7F —
 * the two things that make a body die if it is ever treated as text.
 */
const TS_SEGMENT = (() => {
  const bytes = new Uint8Array(188 * 6)
  for (let packet = 0; packet < 6; packet++) {
    bytes[packet * 188] = 0x47
    for (let i = 1; i < 188; i++) bytes[packet * 188 + i] = (packet * 188 + i) % 251
    bytes[packet * 188 + 40] = 0x0a // a newline where a text splitter would cut
  }
  return bytes
})()

/** What the stub origin was asked for, in order. */
const seen: Array<{ url: string; referer?: string }> = []

const bodies: Record<
  string,
  { body?: string; bytes?: Uint8Array; type?: string; length?: boolean }
> = {
  'https://cdn.origin.test/rel.mpd': { body: MPD_RELATIVE, type: 'application/dash+xml' },
  'https://cdn.origin.test/base.mpd': {
    body: MPD_WITH_BASE,
    type: 'application/octet-stream',
    length: true,
  },
  'https://cdn.origin.test/abs.mpd': { body: MPD_ABSOLUTE, type: 'application/dash+xml' },
  'https://cdn.origin.test/noext': {
    body: MPD_RELATIVE,
    type: 'application/octet-stream',
    length: true,
  },
  'https://cdn.origin.test/list.m3u8': {
    body: HLS_PLAYLIST,
    type: 'application/vnd.apple.mpegurl',
  },
  // Castle TV's shape, measured 2026-09-30 on img.klnwm.com: the playlist and
  // every segment live under `/hls/`, segments are named `.jpg` and served as
  // image/jpeg. A URL test that matches `/hls/` classifies every one of them
  // as a playlist.
  'https://img.origin.test/hls/abc123/720/index.m3u8': {
    body: '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6.0,\nhttps://img.origin.test/hls/abc123/720/s_0.jpg?t=1\n#EXTINF:6.0,\nhttps://img.origin.test/hls/abc123/720/s_1.jpg?t=1\n#EXT-X-ENDLIST\n',
    type: 'application/vnd.apple.mpegurl',
  },
  'https://img.origin.test/hls/abc123/720/s_0.jpg?t=1': {
    bytes: TS_SEGMENT,
    type: 'image/jpeg',
    length: true,
  },
  'https://img.origin.test/hls/abc123/720/s_1.jpg?t=1': {
    bytes: TS_SEGMENT,
    type: 'image/jpeg',
    length: true,
  },
  // A playlist whose origin will not say what it is; only the body can.
  'https://cdn.origin.test/octet.m3u8': {
    body: HLS_PLAYLIST,
    type: 'application/octet-stream',
    length: true,
  },
}

/**
 * The two shapes a real origin takes when handed a `Range`, as measured.
 *
 * `honours` is an ordinary CDN. `ignores` is `video-downloads.googleusercontent.com`
 * — the GDFlix "Instant Download" link — which answers **200 with the whole file
 * from byte zero** no matter what was asked for, and never sends `Accept-Ranges`.
 * Nothing in its reply says the range was refused; it simply is not there.
 */
const ENDLESS = 'https://cdn.origin.test/endless.mkv'
const FLAKY = 'https://cdn.origin.test/flaky.mkv'
const flaky = { calls: 0 }
/** What the endless body did, so a test can see the transfer actually stop. */
const endless = { pulls: 0, cancelled: false, aborted: false }

const RANGE_HONOURING = 'https://cdn.origin.test/seekable.mkv'
const RANGE_IGNORING = 'https://cdn.origin.test/unseekable.mkv'
const FILE_SIZE = 1_000_000

const stubFetch = (async (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => {
  seen.push({ url, referer: init?.headers?.Referer ?? init?.headers?.referer })

  if (url === ENDLESS) {
    // A film-sized body that never ends on its own, the way a 3.24 GB link does
    // not. `pull` is only called while something is still reading.
    init?.signal?.addEventListener('abort', () => {
      endless.aborted = true
    })
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        endless.pulls++
        controller.enqueue(new Uint8Array(64 * 1024))
      },
      cancel() {
        endless.cancelled = true
      },
    })
    return new Response(body, {
      status: 200,
      headers: new Headers({ 'Content-Type': 'video/x-matroska', 'Content-Length': String(5e9) }),
    })
  }

  if (url === FLAKY) {
    // Answers the first range, then throttles — the workers.dev mirror shape.
    flaky.calls++
    if (flaky.calls === 1) {
      return new Response('OK', {
        status: 206,
        headers: new Headers({
          'Content-Type': 'video/x-matroska',
          'Content-Length': '2',
          'Content-Range': 'bytes 0-1/1000000',
        }),
      })
    }
    return new Response('denied', { status: 403, headers: new Headers({ 'Content-Length': '6' }) })
  }

  if (url === RANGE_HONOURING || url === RANGE_IGNORING) {
    const asked = /bytes=(\d+)-/.exec(init?.headers?.Range ?? '')?.[1]
    const headers = new Headers({ 'Content-Type': 'video/x-matroska' })
    if (url === RANGE_IGNORING || asked === undefined) {
      // Whole file from zero, no Accept-Ranges — the header is simply ignored.
      // Content-Length matches the body so the client is not left waiting; the
      // sniff path is skipped anyway, because these requests carry a Range.
      headers.set('Content-Length', String(Buffer.byteLength('BODY-FROM-ZERO')))
      return new Response('BODY-FROM-ZERO', { status: 200, headers })
    }
    // Note: no `Accept-Ranges` here either. The gdflix workers.dev mirrors
    // answer 206 with a Content-Range and omit it, so a client reading only
    // that header concludes it cannot seek a source that seeks perfectly.
    headers.set('Content-Range', `bytes ${asked}-${FILE_SIZE - 1}/${FILE_SIZE}`)
    headers.set('Content-Length', String(Buffer.byteLength('BODY-FROM-OFFSET')))
    return new Response('BODY-FROM-OFFSET', { status: 206, headers })
  }

  const entry = bodies[url]
  const body = entry?.bytes ?? entry?.body ?? 'SEGMENT'
  const headers = new Headers({ 'Content-Type': entry?.type ?? 'video/mp4' })
  const length = typeof body === 'string' ? Buffer.byteLength(body) : body.byteLength
  if (entry?.length || !entry) headers.set('Content-Length', String(length))
  return new Response(body, { status: 200, headers })
}) as never

const proxy = new MediaProxy(stubFetch)

const tests: Array<[string, () => Promise<void>]> = []
const test = (name: string, fn: () => Promise<void>) => tests.push([name, fn])

const baseUrlIn = (text: string): string => {
  const match = /<BaseURL>([^<]+)<\/BaseURL>/.exec(text)
  assert.ok(match, `no BaseURL in:\n${text}`)
  return match![1]
}

// --- DASH ------------------------------------------------------------------

test('a manifest with no BaseURL is given one pointing at the proxy', async () => {
  const wrapped = await proxy.wrap('https://cdn.origin.test/rel.mpd', {
    Referer: 'https://provider.test/',
  })
  const text = await (await fetch(wrapped)).text()
  assert.match(baseUrlIn(text), /^http:\/\/127\.0\.0\.1:\d+\/base\/[0-9a-f]{32}\/$/)
})

test('segment templates keep their placeholders — the player expands them', async () => {
  // This is why DASH needs a *directory* route where HLS did not: there is no
  // list of segment URLs to rewrite, only a base to redirect.
  const wrapped = await proxy.wrap('https://cdn.origin.test/rel.mpd', {})
  const text = await (await fetch(wrapped)).text()
  assert.match(text, /media="chunk-\$RepresentationID\$-\$Number%05d\$\.m4s"/)
})

test('a segment fetched through that base reaches the origin with the Referer', async () => {
  const wrapped = await proxy.wrap('https://cdn.origin.test/rel.mpd', {
    Referer: 'https://provider.test/',
  })
  const text = await (await fetch(wrapped)).text()
  seen.length = 0

  const segment = await fetch(`${baseUrlIn(text)}chunk-0-00001.m4s`)
  assert.equal(await segment.text(), 'SEGMENT')
  assert.equal(seen.at(-1)?.url, 'https://cdn.origin.test/chunk-0-00001.m4s')
  assert.equal(seen.at(-1)?.referer, 'https://provider.test/')
})

test('an existing BaseURL is replaced, not added to', async () => {
  const wrapped = await proxy.wrap('https://cdn.origin.test/base.mpd', {})
  const text = await (await fetch(wrapped)).text()
  assert.equal((text.match(/<BaseURL>/g) ?? []).length, 1)
  assert.doesNotMatch(text, /<BaseURL>https:\/\/cdn\.origin\.test/)
})

test('the replaced BaseURL still points at what it originally named', async () => {
  const wrapped = await proxy.wrap('https://cdn.origin.test/base.mpd', {})
  const text = await (await fetch(wrapped)).text()
  seen.length = 0
  await fetch(`${baseUrlIn(text)}seg-1.m4s`)
  // The manifest's own BaseURL was `/v1/`, so the segment lives under it.
  assert.equal(seen.at(-1)?.url, 'https://cdn.origin.test/v1/seg-1.m4s')
})

test('absolute segment URLs are rewritten, keeping the filename intact', async () => {
  const wrapped = await proxy.wrap('https://cdn.origin.test/abs.mpd', {})
  const text = await (await fetch(wrapped)).text()
  assert.doesNotMatch(text, /media="https:\/\/cdn\.origin\.test/)
  assert.match(text, /media="http:\/\/127\.0\.0\.1:\d+\/base\/[0-9a-f]{32}\/seg-\$Number\$\.m4s"/)
})

test('a manifest with no extension and no content type is recognised by its body', async () => {
  // Providers serve `.mpd` documents as octet-stream from extensionless URLs
  // routinely. The URL cannot answer this; the first bytes can.
  const wrapped = await proxy.wrap('https://cdn.origin.test/noext', {})
  const response = await fetch(wrapped)
  assert.equal(response.headers.get('content-type'), 'application/dash+xml')
  assert.match(await response.text(), /<BaseURL>http:\/\/127\.0\.0\.1/)
})

test('a directory route cannot be walked out of', async () => {
  // The suffix arrives from the renderer. Without the containment check a
  // directory route becomes the arbitrary-URL fetcher `wrap` deliberately is.
  const wrapped = await proxy.wrap('https://cdn.origin.test/rel.mpd', {})
  const text = await (await fetch(wrapped)).text()
  const escaped = await fetch(`${baseUrlIn(text)}../../secret`)
  assert.equal(escaped.status, 404)
})

test('one directory route is minted per base, not one per segment', async () => {
  const wrapped = await proxy.wrap('https://cdn.origin.test/rel.mpd', {})
  const base = baseUrlIn(await (await fetch(wrapped)).text())
  const again = baseUrlIn(await (await fetch(wrapped)).text())
  assert.equal(base, again)
})

// --- HLS, unchanged --------------------------------------------------------

test('HLS playlists are still rewritten line by line', async () => {
  // DASH handling must not have displaced the playlist path it sits beside.
  const wrapped = await proxy.wrap('https://cdn.origin.test/list.m3u8', {})
  const text = await (await fetch(wrapped)).text()
  assert.match(text, /URI="http:\/\/127\.0\.0\.1:\d+\/stream\/[0-9a-f]{32}"/)
  assert.match(text, /^http:\/\/127\.0\.0\.1:\d+\/stream\/[0-9a-f]{32}$/m)
})

test('a loopback URL is returned untouched rather than wrapped again', async () => {
  const already = 'http://127.0.0.1:9/stream/1'
  assert.equal(await proxy.wrap(already, { Referer: 'x' }), already)
})

// --- segments whose URLs look like playlists -------------------------------
//
// Measured on Castle TV's CDN (img.klnwm.com, 2026-09-30): a film's 854
// segments are served from `…/hls/<id>/720/s_0.jpg`, so the URL pattern in
// `looksLikeHls` matched every one. Each segment was read as text and
// "rewritten" — split on its newline bytes, every binary chunk handed to
// `routeFor` — and the player received a body of loopback URLs where MPEG-TS
// belonged. hls.js answered fragParsingError, FFmpeg "Error when loading first
// segment", and downloading the same title worked because the downloader never
// asks this proxy to parse anything. The body, not the URL, decides.

test('a segment served from a /hls/ path is streamed untouched, not rewritten', async () => {
  const wrapped = await proxy.wrap('https://img.origin.test/hls/abc123/720/index.m3u8', {})
  const playlist = await (await fetch(wrapped)).text()
  const segment = playlist.split('\n').find((line) => line.startsWith('http://127.0.0.1'))
  assert.ok(segment, 'playlist was not rewritten')

  // The un-ranged fetch is what hls.js sends for a full segment.
  const full = await fetch(segment!)
  assert.equal(full.status, 200)
  const fullBody = Buffer.from(await full.arrayBuffer())
  assert.equal(fullBody.byteLength, TS_SEGMENT.byteLength, 'segment grew or shrank')
  assert.ok(fullBody.equals(Buffer.from(TS_SEGMENT)), 'segment bytes were altered')
})

test('the same holds for a ranged fetch, which is what ffmpeg sends', async () => {
  const wrapped = await proxy.wrap('https://img.origin.test/hls/abc123/720/s_0.jpg?t=1', {})
  const res = await fetch(wrapped, { headers: { Range: 'bytes=0-' } })
  const body = Buffer.from(await res.arrayBuffer())
  // The stub does not honour ranges; byte-zero-from-the-start is the honest 200.
  assert.ok(body.equals(Buffer.from(TS_SEGMENT)), 'ranged segment bytes were altered')
})

test('a playlist served as octet-stream is still rewritten — its body says so', async () => {
  // The other half of the rule: refusing to trust the URL must not stop
  // recognising a playlist whose origin will not name it.
  const wrapped = await proxy.wrap('https://cdn.origin.test/octet.m3u8', {})
  const text = await (await fetch(wrapped)).text()
  assert.match(text, /URI="http:\/\/127\.0\.0\.1:\d+\/stream\/[0-9a-f]{32}"/)
  assert.match(text, /^http:\/\/127\.0\.0\.1:\d+\/stream\/[0-9a-f]{32}$/m)
})

test('binary that merely lives at an hls-patterned address is not a playlist either', async () => {
  // Wrapped directly rather than via a playlist, so this is the un-ranged
  // sniff path rather than a playlist-minted segment route.
  const wrapped = await proxy.wrap('https://img.origin.test/hls/abc123/720/s_1.jpg?t=1', {})
  const res = await fetch(wrapped)
  const body = Buffer.from(await res.arrayBuffer())
  assert.ok(body.equals(Buffer.from(TS_SEGMENT)), 'binary at a playlist-looking URL was rewritten')
})

// --- range semantics -------------------------------------------------------
//
// The proxy is the only component that sees how an origin answers a `Range`, so
// it is the only one that can tell the player. Passing the origin's headers
// through unexamined understated one shape and misreported the other, and both
// failures land on the player as something else entirely: a source that cannot
// be seeked, or a frozen timeline.

test('an origin that honours ranges is reported seekable even when it never says so', async () => {
  const wrapped = await proxy.wrap(RANGE_HONOURING, {})
  const res = await fetch(wrapped, { headers: { Range: 'bytes=0-' } })
  assert.equal(res.status, 206)
  // The origin sent Content-Range and no Accept-Ranges; we state it outright.
  assert.equal(res.headers.get('accept-ranges'), 'bytes')
  await res.arrayBuffer()
})

test('an origin that ignores ranges is reported unseekable rather than silently', async () => {
  const wrapped = await proxy.wrap(RANGE_IGNORING, {})
  const res = await fetch(wrapped, { headers: { Range: 'bytes=0-' } })
  assert.equal(res.status, 200)
  // Without this the player has nothing to read, assumes it may seek, and
  // satisfies the seek by reading the file from the beginning — which on a
  // multi-gigabyte link never arrives.
  assert.equal(res.headers.get('accept-ranges'), 'none')
  await res.arrayBuffer()
})

test('byte-zero data is never served as though it were a mid-file range', async () => {
  const wrapped = await proxy.wrap(RANGE_IGNORING, {})
  const res = await fetch(wrapped, { headers: { Range: 'bytes=500000-' } })
  // The origin answered 200 with the opening of the file. Forwarding that would
  // hand the player the start of the film labelled as its middle.
  assert.equal(res.status, 416)
  assert.equal(res.headers.get('accept-ranges'), 'none')
  assert.equal(await res.text(), '')
})

test('a client that walks away takes the upstream transfer with it', async () => {
  /**
   * `releaseLock()` detaches the reader and leaves the body running. On an
   * origin that ignores `Range` and answers everything with the whole file,
   * every abandoned probe was a multi-gigabyte download still in flight —
   * against a link the viewer is often already downloading. That is how a
   * source which probes in two seconds on an idle machine times out at twenty
   * in the app.
   */
  endless.pulls = 0
  endless.cancelled = false
  endless.aborted = false
  const wrapped = await proxy.wrap(ENDLESS, {})

  const controller = new AbortController()
  const res = await fetch(wrapped, { headers: { Range: 'bytes=0-' }, signal: controller.signal })
  const reader = res.body!.getReader()
  let got = 0
  while (got < 200_000) {
    const next = await reader.read()
    if (next.done) break
    got += next.value!.byteLength
  }
  controller.abort() // the viewer switched source, or ffprobe gave up
  await new Promise((r) => setTimeout(r, 200))

  const settled = endless.pulls
  await new Promise((r) => setTimeout(r, 400))

  assert.ok(endless.cancelled || endless.aborted, 'upstream body was neither cancelled nor aborted')
  assert.equal(endless.pulls, settled, 'upstream kept being read after the client left')
})

test('a throttled reply does not retract a proven range verdict', async () => {
  // A 403 declines the request, not the range. Recording "no" from one poisons
  // the route: every later response claims Accept-Ranges: none and the player
  // stops seeking a source that seeks perfectly.
  flaky.calls = 0
  const wrapped = await proxy.wrap(FLAKY, {})

  const first = await fetch(wrapped, { headers: { Range: 'bytes=0-' } })
  assert.equal(first.headers.get('accept-ranges'), 'bytes')
  await first.arrayBuffer()

  const denied = await fetch(wrapped, { headers: { Range: 'bytes=500-' } })
  assert.equal(denied.status, 403)
  await denied.arrayBuffer()

  const after = await fetch(wrapped, { headers: { Range: 'bytes=0-' } })
  assert.equal(after.headers.get('accept-ranges'), 'bytes', 'verdict was retracted by a 403')
  await after.arrayBuffer()
})

// --- route capacity --------------------------------------------------------

test('a route handed to the player survives a burst of newer ones', async () => {
  // Rewriting one HLS media playlist mints a route per segment — ~1200 for a
  // two-hour film, in a single burst. Under a plain LRU those evicted the
  // oldest routes, which are the master playlist and the video variants it had
  // just named: mpv read the master, asked for the variant, and got a 404 from
  // us. The variant is unfetched, not stale, and must outlive the segments.
  const variant = await proxy.wrap('https://cdn.origin.test/variant-playlist.m3u8', {})
  for (let i = 0; i < 3000; i++) {
    await proxy.wrap(`https://cdn.origin.test/seg-${i}.ts`, {})
  }
  const res = await fetch(variant)
  assert.notEqual(res.status, 404)
  await res.arrayBuffer()
})

// --- local files -----------------------------------------------------------
//
// A finished download is served over the same loopback origin a stream is, so
// ffprobe, the media element and mpv all reach it through one door. Range
// support is the whole point: without it the file plays and cannot be seeked,
// which reads as a corrupt download rather than a missing HTTP feature.

const localFixture = (() => {
  const file = path.join(os.tmpdir(), `cs3-proxy-local-${process.pid}.bin`)
  // Recognisable bytes, so a wrong offset is visible rather than merely plausible.
  const bytes = Buffer.alloc(300_000)
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251
  fs.writeFileSync(file, bytes)
  return { file, bytes }
})()

test('a local file is served whole, and says it accepts ranges', async () => {
  const url = await proxy.serveFile(localFixture.file)
  const response = await fetch(url)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('accept-ranges'), 'bytes')
  const body = Buffer.from(await response.arrayBuffer())
  assert.ok(body.equals(localFixture.bytes), 'body must match the file byte for byte')
})

test('a mid-file range returns those exact bytes — this is what seeking does', async () => {
  const url = await proxy.serveFile(localFixture.file)
  const response = await fetch(url, { headers: { Range: 'bytes=100000-100099' } })
  assert.equal(response.status, 206)
  assert.equal(
    response.headers.get('content-range'),
    `bytes 100000-100099/${localFixture.bytes.length}`,
  )
  const slice = Buffer.from(await response.arrayBuffer())
  assert.ok(
    slice.equals(localFixture.bytes.subarray(100000, 100100)),
    'ranged bytes must come from the requested offset',
  )
})

test('an open-ended range is honoured, which is the form ffmpeg sends', async () => {
  const url = await proxy.serveFile(localFixture.file)
  const response = await fetch(url, { headers: { Range: 'bytes=299900-' } })
  assert.equal(response.status, 206)
  assert.equal((await response.arrayBuffer()).byteLength, 100)
})

test('a range past the end is refused with the header a player can recover from', async () => {
  const url = await proxy.serveFile(localFixture.file)
  const response = await fetch(url, { headers: { Range: 'bytes=999999-' } })
  // Without `Content-Range` on a 416 a player retries the same bad range
  // forever instead of correcting itself.
  assert.equal(response.status, 416)
  assert.equal(response.headers.get('content-range'), `bytes */${localFixture.bytes.length}`)
})

test('one token is minted per file, not one per request', async () => {
  const first = await proxy.serveFile(localFixture.file)
  const second = await proxy.serveFile(localFixture.file)
  // Otherwise every re-open of the same download leaks another route for the
  // life of the process.
  assert.equal(first, second)
})

test('an unknown local token is a 404, not a way to read arbitrary files', async () => {
  const url = await proxy.serveFile(localFixture.file)
  const response = await fetch(url.replace(/\/local\/[0-9a-f]{32}$/, `/local/${'9'.repeat(32)}`))
  assert.equal(response.status, 404)
})

test('serving a file that does not exist fails now rather than at play time', async () => {
  await assert.rejects(() => proxy.serveFile(path.join(os.tmpdir(), 'cs3-absent-file.bin')))
})

test('serving a file outside allowed directories is rejected for path traversal protection', async () => {
  // A path outside allowedDirectories (such as C:\Windows\System32\drivers\etc\hosts or /etc/passwd)
  const outsidePath =
    process.platform === 'win32' ? 'C:\\Windows\\System32\\drivers\\etc\\hosts' : '/etc/passwd'
  await assert.rejects(
    () => proxy.serveFile(outsidePath),
    /Access denied: path outside allowed directories/,
  )
})

test('header injection with CRLF is sanitized when forwarded', async () => {
  const wrapped = await proxy.wrap('https://cdn.origin.test/rel.mpd', {
    Referer: 'https://provider.test/\r\nInjected-Header: evil',
    'Bad\r\nHeader': 'value',
  })
  seen.length = 0
  await fetch(wrapped)
  assert.equal(seen.at(-1)?.referer, 'https://provider.test/Injected-Header: evil')
})

test('direct streams without Referer header do not inject synthetic Referer to origin', async () => {
  const wrapped = await proxy.wrap('https://cdn.origin.test/noext', {})
  seen.length = 0
  await fetch(wrapped)
  assert.equal(seen.at(-1)?.referer, undefined)
})

/**
 * Tokens are unguessable.
 *
 * They used to be `1`, `2`, `3`…, and every response carries
 * `Access-Control-Allow-Origin: *` so that ffprobe, hls.js, Shaka and an
 * external VLC can all read from the same door. Together those let any page in
 * the user's browser fetch `/stream/1` cross-origin, read the body, and walk the
 * integers to enumerate the session's viewing. The ephemeral port is a speed
 * bump, not a control.
 */
test('a route token cannot be guessed by counting', async () => {
  const a = await proxy.wrap('https://cdn.origin.test/a.mp4', { Referer: 'https://origin.test/' })
  const b = await proxy.wrap('https://cdn.origin.test/b.mp4', { Referer: 'https://origin.test/' })
  const tokenOf = (url: string) => url.match(/\/stream\/([^/]+)$/)?.[1] ?? ''

  for (const token of [tokenOf(a), tokenOf(b)]) {
    assert.match(token, /^[0-9a-f]{32}$/, 'a token is 16 random bytes, hex-encoded')
    assert.doesNotMatch(token, /^\d+$/, 'a purely numeric token is enumerable')
  }
  assert.notEqual(tokenOf(a), tokenOf(b))

  // The old shape must not resolve to anything, whatever else changes.
  const guessed = await fetch(a.replace(/\/stream\/[0-9a-f]{32}$/, '/stream/1'))
  assert.equal(guessed.status, 404)
})

/**
 * A `Host` header naming anything but loopback is refused.
 *
 * Binding to 127.0.0.1 stops a request arriving from off the machine and does
 * nothing about DNS rebinding, where a page resolves its own hostname to
 * 127.0.0.1 and reaches this server with that hostname in `Host`.
 */
test('a request whose Host is not loopback is refused', async () => {
  const wrapped = await proxy.wrap('https://cdn.origin.test/a.mp4', {})
  const target = new URL(wrapped)

  // `fetch` refuses to set Host — it is a forbidden header — so the rebinding
  // case is driven with a raw request, which is also what an attacker has.
  const statusWithHost = (hostHeader: string) =>
    new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: Number(target.port),
          path: target.pathname,
          method: 'GET',
          headers: { Host: hostHeader },
        },
        (res) => {
          res.resume()
          resolve(res.statusCode ?? 0)
        },
      )
      req.on('error', reject)
      req.end()
    })

  assert.equal(await statusWithHost('evil.example.com'), 403)
  // …and the ordinary case still works, or the check is a denial of service.
  assert.equal(await statusWithHost(`127.0.0.1:${target.port}`), 200)
})

// --- runner ----------------------------------------------------------------

let failed = 0
for (const [name, fn] of tests) {
  try {
    await fn()
    console.log(`  ok   ${name}`)
  } catch (error) {
    failed++
    console.log(`  FAIL ${name}`)
    console.log(`       ${error instanceof Error ? error.message : String(error)}`)
  }
}
proxy.shutdown()
fs.rmSync(localFixture.file, { force: true })
console.log(failed === 0 ? `\n${tests.length} passed` : `\n${failed} of ${tests.length} FAILED`)
process.exit(failed === 0 ? 0 : 1)
