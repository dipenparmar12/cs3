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
