import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { customPlayerName, validatePlayerPath } from './externalPlayer.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs3-player-'));
const exe = path.join(dir, 'mpv.exe');
const bat = path.join(dir, 'player.bat');
fs.writeFileSync(exe, '');
fs.writeFileSync(bat, '');

test('a real .exe on Windows is a player', () => {
  assert.equal(validatePlayerPath(exe, 'win32'), null);
});

test('anything cmd would interpret is refused on Windows', () => {
  // A .bat/.cmd runs through cmd, which parses the URL handed to it.
  assert.match(validatePlayerPath(bat, 'win32') ?? '', /\.exe/);
});

test('missing files, folders and relative paths are refused with a reason', () => {
  assert.match(validatePlayerPath(path.join(dir, 'gone.exe'), 'win32') ?? '', /no longer exists/);
  assert.match(validatePlayerPath(dir, 'linux') ?? '', /folder/);
  assert.ok(validatePlayerPath('mpv.exe', 'win32'));
  assert.equal(validatePlayerPath(bat, 'linux'), null);
});

test('the name shown is the program, not its path', () => {
  assert.equal(customPlayerName('C:\\Tools\\mpv\\mpv.exe'.replace(/\\/g, path.sep)), 'mpv');
  assert.equal(customPlayerName('/Applications/Elmedia Player.app'), 'Elmedia Player');
});

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
