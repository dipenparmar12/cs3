/**
 * PRD-40.1 §4.2 & §7: Container-Aware Inspection unit tests.
 *
 *   node --experimental-strip-types electron/media/containerInspection.test.mts
 */
import assert from 'node:assert/strict';
import {
  detectUrlType,
  parseHlsManifest,
  parseDashManifest,
  isMetadataIncomplete,
} from './mediaInspector.ts';
import { canPlayVideo, isPlayableAudioCodec } from './decisionEngine.ts';

const tests: Array<[string, () => void | Promise<void>]> = [];
const test = (name: string, fn: () => void | Promise<void>) => tests.push([name, fn]);

test('detectUrlType categorizes URLs synchronously', () => {
  assert.equal(detectUrlType('https://cdn.test/master.m3u8'), 'manifest-hls');
  assert.equal(detectUrlType('https://cdn.test/stream.php?format=m3u8'), 'manifest-hls');
  assert.equal(detectUrlType('https://cdn.test/manifest.mpd'), 'manifest-dash');
  assert.equal(detectUrlType('https://cdn.test/video.mp4?token=123'), 'mp4');
  assert.equal(detectUrlType('https://cdn.test/stream.m4v'), 'mp4');
  assert.equal(detectUrlType('https://cdn.test/recording.ts'), 'ts');
  assert.equal(detectUrlType('https://cdn.test/release.mkv'), 'mkv');
  assert.equal(detectUrlType('https://cdn.test/unknown-stream'), 'unknown');
});

test('parseHlsManifest extracts master playlist variants, codecs, and audio without ffprobe', () => {
  const hls = `#EXTM3U
#EXT-X-VERSION:4
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio-aac",NAME="English",DEFAULT=YES,LANGUAGE="eng",URI="audio-en.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio-aac",NAME="Spanish",DEFAULT=NO,LANGUAGE="spa",URI="audio-es.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",DEFAULT=YES,LANGUAGE="eng",URI="sub-en.vtt"
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,FRAME-RATE=23.976,CODECS="avc1.640028,mp4a.40.2",AUDIO="audio-aac",SUBTITLES="subs"
1080p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720,FRAME-RATE=23.976,CODECS="avc1.4d401f,mp4a.40.2",AUDIO="audio-aac"
720p.m3u8
`;

  const meta = parseHlsManifest(hls);
  assert.ok(meta);
  assert.equal(meta.formatName, 'hls,applehttp');
  assert.ok(meta.video);
  assert.equal(meta.video.codec, 'h264');
  assert.equal(meta.video.width, 1920);
  assert.equal(meta.video.height, 1080);
  assert.equal(meta.video.bitDepth, 8);
  assert.equal(meta.audio.length, 2);
  assert.equal(meta.audio[0].language, 'eng');
  assert.equal(meta.audio[1].language, 'spa');
  assert.equal(meta.subtitles.length, 1);
  assert.equal(meta.subtitles[0].language, 'eng');
});

test('parseDashManifest extracts video representations, HEVC 10-bit and audio', () => {
  const mpd = `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static">
  <Period>
    <AdaptationSet contentType="video" mimeType="video/mp4">
      <Representation id="v1" width="3840" height="2160" codecs="hvc1.2.4.L120.B0" bandwidth="15000000"/>
      <Representation id="v2" width="1920" height="1080" codecs="hvc1.2.4.L120.B0" bandwidth="8000000"/>
    </AdaptationSet>
    <AdaptationSet contentType="audio" mimeType="audio/mp4" lang="en">
      <Representation id="a1" codecs="mp4a.40.2" bandwidth="128000"/>
    </AdaptationSet>
  </Period>
</MPD>`;

  const meta = parseDashManifest(mpd);
  assert.ok(meta);
  assert.equal(meta.formatName, 'dash');
  assert.ok(meta.video);
  assert.equal(meta.video.codec, 'hevc');
  assert.equal(meta.video.width, 3840);
  assert.equal(meta.video.height, 2160);
  assert.equal(meta.video.bitDepth, 10);
  assert.equal(meta.audio.length, 1);
  assert.equal(meta.audio[0].codec, 'aac');
  assert.equal(meta.audio[0].language, 'en');
});

test('isMetadataIncomplete correctly flags incomplete metadata', () => {
  assert.equal(isMetadataIncomplete(null), true);
  assert.equal(
    isMetadataIncomplete({
      formatName: '',
      durationSeconds: 100,
      video: null,
      audio: [],
      subtitles: [],
    }),
    true
  );

  assert.equal(
    isMetadataIncomplete({
      formatName: 'mov,mp4',
      durationSeconds: 100,
      video: {
        index: 0,
        codec: '', // missing codec
        codecLongName: '',
        bitDepth: 8,
        pixelFormat: 'yuv420p',
        width: 1920,
        height: 1080,
        frameRate: 24,
        isHdr: false,
        isInterlaced: false,
      },
      audio: [],
      subtitles: [],
    }),
    true
  );

  assert.equal(
    isMetadataIncomplete({
      formatName: 'mov,mp4',
      durationSeconds: 100,
      video: {
        index: 0,
        codec: 'h264',
        codecLongName: 'H.264',
        bitDepth: 8,
        pixelFormat: 'yuv420p',
        width: 1920,
        height: 1080,
        frameRate: 24,
        isHdr: false,
        isInterlaced: false,
      },
      audio: [
        {
          index: 0,
          codec: 'aac',
          codecLongName: 'AAC',
          channels: 2,
          isDefault: true,
          isForced: false,
          playable: true,
        },
      ],
      subtitles: [],
    }),
    false
  );
});

// --- execution -------------------------------------------------------------


/**
 * Format coverage, from two real source exports (2026-09-20).
 *
 * Every row these pin failed silently: the manifest declared a codec, the
 * parser did not recognise it, and the optimistic `h264`/`aac` defaults
 * survived — so a Dolby Vision or DTS stream was reported as directly
 * playable, handed to hls.js, and failed in the element, where the failover
 * ladder attributes it to the source rather than to the decision.
 */
test('an unrecognised CODECS attribute is never reported as H.264/AAC', () => {
  const meta = parseHlsManifest(`#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=9000000,RESOLUTION=1920x1080,CODECS="zzzz.1,wxyz.2"
v.m3u8`);
  assert.ok(meta?.video);
  assert.notEqual(meta.video.codec, 'h264');
  assert.equal(meta.video.codec, 'unknown');
  assert.equal(meta.audio[0].codec, 'unknown');
  assert.equal(meta.audio[0].playable, false);
});

test('a manifest that declares no CODECS at all keeps the optimistic default', () => {
  // The distinction the fix turns on: silence is not an unreadable
  // declaration, and only the second is a reason to be pessimistic.
  const meta = parseHlsManifest(`#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=9000000,RESOLUTION=1920x1080
v.m3u8`);
  assert.equal(meta?.video?.codec, 'h264');
  assert.equal(meta?.audio[0].codec, 'aac');
});

test('Dolby Vision is detected from the codec string and refused the element', () => {
  const meta = parseHlsManifest(`#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=28000000,RESOLUTION=3840x2160,CODECS="dvh1.05.06,ec-3"
v.m3u8`);
  assert.ok(meta?.video);
  assert.equal(meta.video.codec, 'hevc');
  assert.equal(meta.video.dolbyVision, true);
  // DV signals its transfer inside the RPU, so this must not depend on the
  // container claiming PQ — the re-encode path tone-maps off this flag.
  assert.equal(meta.video.isHdr, true);
  assert.equal(
    canPlayVideo(meta.video.codec, meta.video.pixelFormat, null, meta.video.dolbyVision),
    false
  );
  assert.equal(meta.audio[0].codec, 'eac3');
  assert.equal(meta.audio[0].playable, false);
});

test('mp4a is a namespace, not a synonym for AAC', () => {
  // mp4a.a5 is AC-3 and mp4a.a6 is E-AC-3. Collapsing the prefix to AAC
  // reported the modal provider audio as playable, which is silent dialogue.
  const ac3 = parseHlsManifest(`#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.a5"
v.m3u8`);
  assert.equal(ac3?.audio[0].codec, 'ac3');
  assert.equal(ac3?.audio[0].playable, false);

  const eac3 = parseHlsManifest(`#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.a6"
v.m3u8`);
  assert.equal(eac3?.audio[0].codec, 'eac3');
  assert.equal(eac3?.audio[0].playable, false);

  // The ordinary case still answers AAC, or this fix breaks everything else.
  const aac = parseHlsManifest(`#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"
v.m3u8`);
  assert.equal(aac?.audio[0].codec, 'aac');
  assert.equal(aac?.audio[0].playable, true);
});

test('DTS and AC-4 in a manifest are recognised rather than defaulted', () => {
  const cases: Array<[string, string]> = [
    ['dtsc', 'dts'],
    ['dtsh', 'dtshd'],
    ['ac-4', 'ac4'],
  ];
  for (const [token, expected] of cases) {
    const meta = parseHlsManifest(`#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,CODECS="avc1.640028,${token}"
v.m3u8`);
    assert.equal(meta?.audio[0].codec, expected, token);
    assert.equal(meta?.audio[0].playable, false, token);
  }
});

test('ten bits is not a transfer function', () => {
  // This read `bitDepth > 8`, so every 10-bit SDR playlist — which is most
  // HEVC WEB-DL — was recorded as HDR and tone-mapped on re-encode, which
  // flattens a correct picture exactly as omitting it ruins a real HDR one.
  const meta = parseHlsManifest(`#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=9000000,RESOLUTION=1920x1080,CODECS="hvc1.2.4.L120.90,mp4a.40.2"
v.m3u8`);
  assert.equal(meta?.video?.bitDepth, 10);
  assert.equal(meta?.video?.isHdr, false);
});

test('a DASH manifest carrying Dolby Vision still reports a video stream', () => {
  // The rescue branch tested four codec prefixes, so a DV manifest laid out
  // this way reported `video: null` — worse than unplayable, it is absent.
  const meta = parseDashManifest(`<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"><Period><AdaptationSet>
<Representation id="1" codecs="dvh1.05.06" width="3840" height="2160"/>
</AdaptationSet></Period></MPD>`);
  assert.ok(meta?.video, 'DV DASH manifest must still report a video stream');
  assert.equal(meta.video.dolbyVision, true);
  assert.equal(meta.video.codec, 'hevc');
});

test('a named codec neither list has heard of fails closed', () => {
  // The fallback was `!UNSUPPORTED.has(name)`, so anything new was reported
  // playable and failed in the element. An absent codec is still "no
  // information, do not block" — those are different questions.
  assert.equal(canPlayVideo('ffv1', 'yuv420p', null), false);
  assert.equal(canPlayVideo('h264', 'yuv420p', null), true);
  assert.equal(canPlayVideo(undefined, undefined, null), true);
  assert.equal(isPlayableAudioCodec('ac4'), false);
  assert.equal(isPlayableAudioCodec('mpegh'), false);
  assert.equal(isPlayableAudioCodec('aac'), true);
  assert.equal(isPlayableAudioCodec('flac'), true);
});

test('a measured renderer capability still overrides the table in both directions', () => {
  // The allowlist is a fallback, never a veto: App.tsx measures canPlayType
  // at startup and that answer has to keep winning.
  const caps = { video: { hevc: true, h264: false }, audio: {} } as never;
  assert.equal(canPlayVideo('hevc', 'yuv420p', caps), true);
  assert.equal(canPlayVideo('h264', 'yuv420p', caps), false);
});

let passed = 0;
let failed = 0;

for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
    passed++;
  } catch (error) {
    console.error(`  FAIL ${name}`);
    console.error(error);
    failed++;
  }
}

console.log(`\n${passed} passed${failed > 0 ? `, ${failed} failed` : ''}`);
if (failed > 0) process.exit(1);
