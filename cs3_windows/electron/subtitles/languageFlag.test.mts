import test from 'node:test';
import assert from 'node:assert/strict';
import { getLanguageFlag } from '../../src/utils/languageFlag.ts';

test('getLanguageFlag: handles standard ISO language codes', () => {
  assert.equal(getLanguageFlag('eng'), '🇬🇧');
  assert.equal(getLanguageFlag('en'), '🇬🇧');
  assert.equal(getLanguageFlag('spa'), '🇪🇸');
  assert.equal(getLanguageFlag('es'), '🇪🇸');
  assert.equal(getLanguageFlag('fre'), '🇫🇷');
  assert.equal(getLanguageFlag('fra'), '🇫🇷');
  assert.equal(getLanguageFlag('fr'), '🇫🇷');
  assert.equal(getLanguageFlag('ger'), '🇩🇪');
  assert.equal(getLanguageFlag('deu'), '🇩🇪');
  assert.equal(getLanguageFlag('de'), '🇩🇪');
  assert.equal(getLanguageFlag('ita'), '🇮🇹');
  assert.equal(getLanguageFlag('it'), '🇮🇹');
  assert.equal(getLanguageFlag('jpn'), '🇯🇵');
  assert.equal(getLanguageFlag('ja'), '🇯🇵');
  assert.equal(getLanguageFlag('kor'), '🇰🇷');
  assert.equal(getLanguageFlag('ko'), '🇰🇷');
  assert.equal(getLanguageFlag('zho'), '🇨🇳');
  assert.equal(getLanguageFlag('chi'), '🇨🇳');
  assert.equal(getLanguageFlag('zh'), '🇨🇳');
  assert.equal(getLanguageFlag('rus'), '🇷🇺');
  assert.equal(getLanguageFlag('ru'), '🇷🇺');
  assert.equal(getLanguageFlag('ara'), '🇸🇦');
  assert.equal(getLanguageFlag('ar'), '🇸🇦');
  assert.equal(getLanguageFlag('hin'), '🇮🇳');
  assert.equal(getLanguageFlag('hi'), '🇮🇳');
  assert.equal(getLanguageFlag('tur'), '🇹🇷');
  assert.equal(getLanguageFlag('tr'), '🇹🇷');
  assert.equal(getLanguageFlag('pol'), '🇵🇱');
  assert.equal(getLanguageFlag('pl'), '🇵🇱');
  assert.equal(getLanguageFlag('dut'), '🇳🇱');
  assert.equal(getLanguageFlag('nld'), '🇳🇱');
  assert.equal(getLanguageFlag('nl'), '🇳🇱');
  assert.equal(getLanguageFlag('swe'), '🇸🇪');
  assert.equal(getLanguageFlag('nor'), '🇳🇴');
  assert.equal(getLanguageFlag('dan'), '🇩🇰');
  assert.equal(getLanguageFlag('fin'), '🇫🇮');
  assert.equal(getLanguageFlag('ell'), '🇬🇷');
  assert.equal(getLanguageFlag('heb'), '🇮🇱');
  assert.equal(getLanguageFlag('ukr'), '🇺🇦');
  assert.equal(getLanguageFlag('ron'), '🇷🇴');
  assert.equal(getLanguageFlag('ces'), '🇨🇿');
  assert.equal(getLanguageFlag('hun'), '🇭🇺');
  assert.equal(getLanguageFlag('bul'), '🇧🇬');
  assert.equal(getLanguageFlag('hrv'), '🇭🇷');
  assert.equal(getLanguageFlag('srp'), '🇷🇸');
  assert.equal(getLanguageFlag('slk'), '🇸🇰');
  assert.equal(getLanguageFlag('slv'), '🇸🇮');
});

test('getLanguageFlag: handles regional variants accurately', () => {
  // Brazilian Portuguese vs European
  assert.equal(getLanguageFlag('pob'), '🇧🇷');
  assert.equal(getLanguageFlag('pt-br'), '🇧🇷');
  assert.equal(getLanguageFlag('', 'Portuguese (BR)'), '🇧🇷');
  assert.equal(getLanguageFlag('por', 'Portuguese'), '🇵🇹');

  // Latin American Spanish vs European
  assert.equal(getLanguageFlag('es-419'), '🇲🇽');
  assert.equal(getLanguageFlag('', 'Spanish (Latin America)'), '🇲🇽');
  assert.equal(getLanguageFlag('', 'Español Latino'), '🇲🇽');
  assert.equal(getLanguageFlag('spa', 'Spanish'), '🇪🇸');

  // Traditional vs Simplified Chinese
  assert.equal(getLanguageFlag('zht'), '🇹🇼');
  assert.equal(getLanguageFlag('zh-tw'), '🇹🇼');
  assert.equal(getLanguageFlag('', 'Chinese (Traditional)'), '🇹🇼');
  assert.equal(getLanguageFlag('', '繁體中文'), '🇹🇼');
  assert.equal(getLanguageFlag('zh-cn'), '🇨🇳');
  assert.equal(getLanguageFlag('', 'Chinese (Simplified)'), '🇨🇳');

  // Hong Kong / Cantonese
  assert.equal(getLanguageFlag('zh-hk'), '🇭🇰');
  assert.equal(getLanguageFlag('', 'Cantonese'), '🇭🇰');

  // Canadian French
  assert.equal(getLanguageFlag('fr-ca'), '🇨🇦');
  assert.equal(getLanguageFlag('', 'Canadian French'), '🇨🇦');

  // American English
  assert.equal(getLanguageFlag('en-us'), '🇺🇸');
});

test('getLanguageFlag: handles filenames with embedded language codes', () => {
  assert.equal(getLanguageFlag('', 'Dune.Part.Two.2024.1080p.WEBRip.x264.eng.srt'), '🇬🇧');
  assert.equal(getLanguageFlag('', 'Movie.2024.720p.WEBRip.x264_spa.srt'), '🇪🇸');
  assert.equal(getLanguageFlag('', 'Avatar.2009.Extended.chi.sub'), '🇨🇳');
  assert.equal(getLanguageFlag('', 'film.es.vtt'), '🇪🇸');
  assert.equal(getLanguageFlag('', 'track_1_ita.srt'), '🇮🇹');
  assert.equal(getLanguageFlag('', 'Show.S01E01.1080p.pob.srt'), '🇧🇷');
  assert.equal(getLanguageFlag('', '2_Spanish.srt'), '🇪🇸');
  assert.equal(getLanguageFlag('', '3_English.srt'), '🇬🇧');
  assert.equal(getLanguageFlag('', 'Show - S01E01 - Hindi DD5.1'), '🇮🇳');
  assert.equal(getLanguageFlag('', 'Movie.2023.German.DL.1080p.mkv'), '🇩🇪');
  assert.equal(getLanguageFlag('', 'Avatar.The.Way.of.Water.2022.2160p.WEB-DL.DDP5.1.Atmos.H.265-FLUX.spa.srt'), '🇪🇸');
  assert.equal(getLanguageFlag('', 'track 2 [fre].vtt'), '🇫🇷');
  assert.equal(getLanguageFlag('', 'Film (French forced).srt'), '🇫🇷');
  assert.equal(getLanguageFlag('', 'Dune.2024.Tamil.srt'), '🇮🇳');
  assert.equal(getLanguageFlag('', 'Dune.2024.Telugu.srt'), '🇮🇳');
  assert.equal(getLanguageFlag('', 'Dune.2024.Malayalam.srt'), '🇮🇳');
  assert.equal(getLanguageFlag('', 'Spider-Man.2002.deu.vtt'), '🇩🇪');
});

test('getLanguageFlag: handles native endonyms', () => {
  assert.equal(getLanguageFlag('', '日本語'), '🇯🇵');
  assert.equal(getLanguageFlag('', '한국어'), '🇰🇷');
  assert.equal(getLanguageFlag('', '中文'), '🇨🇳');
  assert.equal(getLanguageFlag('', 'हिन्दी'), '🇮🇳');
  assert.equal(getLanguageFlag('', 'Русский'), '🇷🇺');
  assert.equal(getLanguageFlag('', 'Deutsch'), '🇩🇪');
  assert.equal(getLanguageFlag('', 'Français'), '🇫🇷');
  assert.equal(getLanguageFlag('', 'Italiano'), '🇮🇹');
  assert.equal(getLanguageFlag('', 'Português'), '🇵🇹');
  assert.equal(getLanguageFlag('', 'Türkçe'), '🇹🇷');
  assert.equal(getLanguageFlag('', 'Polski'), '🇵🇱');
  assert.equal(getLanguageFlag('', 'العربية'), '🇸🇦');
});

test('getLanguageFlag: falls back cleanly for unknown strings', () => {
  assert.equal(getLanguageFlag(''), '🌐');
  assert.equal(getLanguageFlag('', 'Off'), '🌐');
  assert.equal(getLanguageFlag('', 'Track 1'), '🌐');
  assert.equal(getLanguageFlag('und', 'Undetermined'), '🌐');
});
