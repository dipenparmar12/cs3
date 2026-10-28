import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classOf, sniff } from './sourceSniff.ts';

const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const bytes = (...parts: Array<number[] | Uint8Array>) => {
  const out: number[] = [];
  for (const part of parts) out.push(...part);
  return Uint8Array.from(out);
};
/** `n` MPEG-TS packets: a sync byte then 187 bytes of filler. */
const ts = (n: number) => bytes(...Array.from({ length: n }, () => [0x47, ...new Array(187).fill(0)]));

test('each signature is recognised', () => {
  const cases: Array<[Uint8Array, string]> = [
    [ascii('#EXTM3U\n#EXT-X-VERSION:3'), 'm3u8'],
    [bytes([0xef, 0xbb, 0xbf], ascii('#EXTM3U')), 'm3u8'],
    [ascii('<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash">'), 'mpd'],
    [bytes([0, 0, 0, 0x20], ascii('ftypisom')), 'mp4'],
    [bytes([0, 0, 0, 0x20], ascii('moof')), 'mp4'],
    [bytes([0x1a, 0x45, 0xdf, 0xa3, 0x01]), 'mkv'],
    [ts(4), 'ts'],
    [bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], new Array(16).fill(0), ts(4)), 'png+ts'],
    [bytes([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0], ts(4)), 'jpeg+ts'],
    [bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]), 'image'],
    [ascii('FLV\x01'), 'flv'],
    [ascii('OggS\x00'), 'ogg'],
    [ascii('fLaC'), 'flac'],
    [ascii('ID3\x04'), 'mp3'],
    [bytes([0xff, 0xf1, 0x50, 0x80]), 'aac'],
    [bytes([0x50, 0x4b, 0x03, 0x04]), 'archive'],
    [bytes([0x1f, 0x8b, 0x08]), 'archive'],
    [ascii('d8:announce35:udp://tracker'), 'torrent'],
    [ascii('<!DOCTYPE html><html><head>'), 'html'],
    [ascii('  <iframe src="https://embed.example/x">'), 'html'],
    [ascii('<?xml version="1.0"?><Error><Code>AccessDenied</Code></Error>'), 'xml-other'],
    [ascii('{"url":"https://x/y.m3u8"}'), 'json'],
    [new Uint8Array(0), 'empty'],
    [ascii('hello'), 'unknown'],
  ];
  for (const [input, kind] of cases) assert.equal(sniff(input).kind, kind, kind);
});

test('an XML error page is never DASH (H-01)', () => {
  assert.notEqual(sniff(ascii('<?xml version="1.0"?><Error/>')).kind, 'mpd');
});

test('a stray 0x47 is not a transport stream', () => {
  assert.equal(sniff(bytes([0x47, 1, 2, 3])).kind, 'unknown');
});

test('kinds fall into the classes a claim is compared with', () => {
  assert.equal(classOf('png+ts'), 'video');
  assert.equal(classOf('mpd'), 'manifest');
  assert.equal(classOf('html'), 'page');
  assert.equal(classOf('xml-other'), 'data');
  assert.equal(classOf('archive'), 'other');
});
