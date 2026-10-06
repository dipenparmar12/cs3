/**
 * Detects flag emojis for subtitle language codes, language names, native endonyms,
 * and release filenames (e.g. `dune.2024.1080p.eng.srt`, `2_Spanish.srt`).
 */

function matchToken(text: string, tokens: string[]): boolean {
  for (const token of tokens) {
    const escaped = token.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, 'i');
    if (regex.test(text)) return true;
  }
  return false;
}

function matchFileExtCode(text: string, code: string): boolean {
  const escaped = code.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const regex = new RegExp(
    `(?:^|[^a-z0-9])${escaped}(?:\\.(?:srt|vtt|sub|ass|ssa|idx)|[\\]\\)\\s_\\-]|$)`,
    'i'
  );
  return regex.test(text);
}

export function getLanguageFlag(code: string, name?: string): string {
  const c = (code || '').toLowerCase().trim();
  const n = (name || '').toLowerCase().trim();
  const text = `${c} ${n}`;

  // 1. Regional / Variant distinctions first:

  // Brazilian Portuguese (pob, pt-br, brazil, brasil) vs European Portuguese
  if (
    c === 'pob' ||
    c === 'pt-br' ||
    matchToken(text, ['brazil', 'brasil', 'brazilian', 'pt-br', 'pob', 'br']) ||
    text.includes('portuguese (br)') ||
    text.includes('português (br)') ||
    text.includes('portugues (br)')
  ) {
    return '🇧🇷';
  }

  // Latin American Spanish / Mexican Spanish (es-419, latino, mexican)
  if (
    c === 'es-419' ||
    c === 'es-la' ||
    matchToken(text, ['latino', 'latinoamérica', 'latinoamerica', 'latin america', 'mexican', 'mexico', 'es-419', 'es-la'])
  ) {
    return '🇲🇽';
  }

  // Canadian French
  if (
    c === 'fr-ca' ||
    matchToken(text, ['canadian french', 'québécois', 'quebecois', 'quebec', 'fr-ca'])
  ) {
    return '🇨🇦';
  }

  // Traditional Chinese / Taiwan / Hong Kong
  if (
    c === 'zht' ||
    c === 'zh-tw' ||
    matchToken(text, ['traditional', 'taiwan', 'zh-tw', 'zht']) ||
    text.includes('繁體') ||
    text.includes('繁体')
  ) {
    return '🇹🇼';
  }
  if (
    c === 'zh-hk' ||
    matchToken(text, ['hong kong', 'cantonese', 'zh-hk']) ||
    text.includes('粵語') ||
    text.includes('粤语')
  ) {
    return '🇭🇰';
  }

  // American English (specific tag)
  if (
    c === 'en-us' ||
    matchToken(text, ['american english', 'en-us'])
  ) {
    return '🇺🇸';
  }

  // 2. Core languages (Code match, endonym match, or token boundary in filename/name):

  // English
  if (
    c === 'eng' ||
    c === 'en' ||
    c === 'en-gb' ||
    matchToken(text, ['english', 'eng']) ||
    matchFileExtCode(text, 'en')
  ) {
    return '🇬🇧';
  }

  // Spanish / Español / Castellano
  if (
    c === 'spa' ||
    c === 'es' ||
    c === 'esp' ||
    matchToken(text, ['spanish', 'español', 'espanol', 'castellano', 'spa', 'esp']) ||
    matchFileExtCode(text, 'es')
  ) {
    return '🇪🇸';
  }

  // Portuguese / Português
  if (
    c === 'por' ||
    c === 'pt' ||
    matchToken(text, ['portuguese', 'português', 'portugues', 'por']) ||
    matchFileExtCode(text, 'pt')
  ) {
    return '🇵🇹';
  }

  // French / Français
  if (
    c === 'fre' ||
    c === 'fra' ||
    c === 'fr' ||
    matchToken(text, ['french', 'français', 'francais', 'fra', 'fre']) ||
    matchFileExtCode(text, 'fr')
  ) {
    return '🇫🇷';
  }

  // German / Deutsch
  if (
    c === 'ger' ||
    c === 'deu' ||
    c === 'de' ||
    matchToken(text, ['german', 'deutsch', 'deu', 'ger']) ||
    matchFileExtCode(text, 'de')
  ) {
    return '🇩🇪';
  }

  // Italian / Italiano
  if (
    c === 'ita' ||
    c === 'it' ||
    matchToken(text, ['italian', 'italiano', 'ita']) ||
    matchFileExtCode(text, 'it')
  ) {
    return '🇮🇹';
  }

  // Japanese / 日本語
  if (
    c === 'jpn' ||
    c === 'ja' ||
    c === 'jap' ||
    matchToken(text, ['japanese', 'nihongo', 'jpn', 'jap']) ||
    matchFileExtCode(text, 'ja') ||
    text.includes('日本語')
  ) {
    return '🇯🇵';
  }

  // Korean / 한국어
  if (
    c === 'kor' ||
    c === 'ko' ||
    matchToken(text, ['korean', 'hangul', 'kor']) ||
    matchFileExtCode(text, 'ko') ||
    text.includes('한국어')
  ) {
    return '🇰🇷';
  }

  // Chinese / 中文 / 简体中文
  if (
    c === 'zho' ||
    c === 'chi' ||
    c === 'zh' ||
    c === 'zh-cn' ||
    matchToken(text, ['chinese', 'mandarin', 'zho', 'chi']) ||
    matchFileExtCode(text, 'zh') ||
    text.includes('中文') ||
    text.includes('汉语') ||
    text.includes('漢語') ||
    text.includes('普通话')
  ) {
    return '🇨🇳';
  }

  // Russian / Русский
  if (
    c === 'rus' ||
    c === 'ru' ||
    matchToken(text, ['russian', 'русский', 'rus']) ||
    matchFileExtCode(text, 'ru') ||
    text.includes('русский')
  ) {
    return '🇷🇺';
  }

  // Arabic / العربية
  if (
    c === 'ara' ||
    c === 'ar' ||
    matchToken(text, ['arabic', 'ara']) ||
    matchFileExtCode(text, 'ar') ||
    text.includes('العربية') ||
    text.includes('عربي')
  ) {
    return '🇸🇦';
  }

  // Turkish / Türkçe
  if (
    c === 'tur' ||
    c === 'tr' ||
    matchToken(text, ['turkish', 'türkçe', 'turkce', 'tur']) ||
    matchFileExtCode(text, 'tr')
  ) {
    return '🇹🇷';
  }

  // Polish / Polski
  if (
    c === 'pol' ||
    c === 'pl' ||
    matchToken(text, ['polish', 'polski', 'pol']) ||
    matchFileExtCode(text, 'pl')
  ) {
    return '🇵🇱';
  }

  // Dutch / Nederlands / Flemish
  if (
    c === 'dut' ||
    c === 'nld' ||
    c === 'nl' ||
    matchToken(text, ['dutch', 'nederlands', 'flemish', 'vlaams', 'nld', 'dut']) ||
    matchFileExtCode(text, 'nl')
  ) {
    return '🇳🇱';
  }

  // Swedish / Svenska
  if (
    c === 'swe' ||
    c === 'sv' ||
    matchToken(text, ['swedish', 'svenska', 'swe']) ||
    matchFileExtCode(text, 'sv')
  ) {
    return '🇸🇪';
  }

  // Norwegian / Norsk
  if (
    c === 'nor' ||
    c === 'no' ||
    c === 'nob' ||
    c === 'nno' ||
    matchToken(text, ['norwegian', 'norsk', 'nor', 'nob', 'nno']) ||
    matchFileExtCode(text, 'no')
  ) {
    return '🇳🇴';
  }

  // Danish / Dansk
  if (
    c === 'dan' ||
    c === 'da' ||
    matchToken(text, ['danish', 'dansk', 'dan']) ||
    matchFileExtCode(text, 'da')
  ) {
    return '🇩🇰';
  }

  // Finnish / Suomi
  if (
    c === 'fin' ||
    c === 'fi' ||
    matchToken(text, ['finnish', 'suomi', 'fin']) ||
    matchFileExtCode(text, 'fi')
  ) {
    return '🇫🇮';
  }

  // Greek / Ελληνικά
  if (
    c === 'gre' ||
    c === 'ell' ||
    c === 'el' ||
    matchToken(text, ['greek', 'ελληνικά', 'ellinika', 'ell', 'gre']) ||
    matchFileExtCode(text, 'el') ||
    text.includes('ελληνικά')
  ) {
    return '🇬🇷';
  }

  // Hebrew / עברית
  if (
    c === 'heb' ||
    c === 'he' ||
    matchToken(text, ['hebrew', 'ivrit', 'heb']) ||
    matchFileExtCode(text, 'he') ||
    text.includes('עברית')
  ) {
    return '🇮🇱';
  }

  // Vietnamese / Tiếng Việt
  if (
    c === 'vie' ||
    c === 'vi' ||
    matchToken(text, ['vietnamese', 'tiếng việt', 'tieng viet', 'vie']) ||
    matchFileExtCode(text, 'vi')
  ) {
    return '🇻🇳';
  }

  // Indonesian / Bahasa Indonesia
  if (
    c === 'ind' ||
    c === 'id' ||
    matchToken(text, ['indonesian', 'bahasa indonesia', 'ind']) ||
    matchFileExtCode(text, 'id')
  ) {
    return '🇮🇩';
  }

  // Malay / Bahasa Melayu
  if (
    c === 'msa' ||
    c === 'may' ||
    c === 'ms' ||
    matchToken(text, ['malay', 'bahasa melayu', 'msa', 'may']) ||
    matchFileExtCode(text, 'ms')
  ) {
    return '🇲🇾';
  }

  // Thai / ไทย
  if (
    c === 'tha' ||
    c === 'th' ||
    matchToken(text, ['thai', 'tha']) ||
    matchFileExtCode(text, 'th') ||
    text.includes('ไทย')
  ) {
    return '🇹🇭';
  }

  // Filipino / Tagalog
  if (
    c === 'tgl' ||
    c === 'fil' ||
    c === 'tl' ||
    matchToken(text, ['tagalog', 'filipino', 'pilipino', 'tgl', 'fil']) ||
    matchFileExtCode(text, 'tl')
  ) {
    return '🇵🇭';
  }

  // Persian / Farsi / فارسی
  if (
    c === 'fas' ||
    c === 'per' ||
    c === 'fa' ||
    matchToken(text, ['persian', 'farsi', 'fas', 'per']) ||
    matchFileExtCode(text, 'fa') ||
    text.includes('فارسی')
  ) {
    return '🇮🇷';
  }

  // Ukrainian / Українська
  if (
    c === 'ukr' ||
    c === 'uk' ||
    matchToken(text, ['ukrainian', 'українська', 'ukr']) ||
    matchFileExtCode(text, 'uk') ||
    text.includes('українська')
  ) {
    return '🇺🇦';
  }

  // Romanian / Română
  if (
    c === 'ron' ||
    c === 'rum' ||
    c === 'ro' ||
    matchToken(text, ['romanian', 'română', 'romana', 'ron', 'rum']) ||
    matchFileExtCode(text, 'ro')
  ) {
    return '🇷🇴';
  }

  // Czech / Čeština
  if (
    c === 'ces' ||
    c === 'cze' ||
    c === 'cs' ||
    matchToken(text, ['czech', 'čeština', 'cestina', 'cze', 'ces']) ||
    matchFileExtCode(text, 'cs')
  ) {
    return '🇨🇿';
  }

  // Hungarian / Magyar
  if (
    c === 'hun' ||
    c === 'hu' ||
    matchToken(text, ['hungarian', 'magyar', 'hun']) ||
    matchFileExtCode(text, 'hu')
  ) {
    return '🇭🇺';
  }

  // Bulgarian / Български
  if (
    c === 'bul' ||
    c === 'bg' ||
    matchToken(text, ['bulgarian', 'български', 'bul']) ||
    matchFileExtCode(text, 'bg') ||
    text.includes('български')
  ) {
    return '🇧🇬';
  }

  // Croatian / Hrvatski
  if (
    c === 'hrv' ||
    c === 'hr' ||
    matchToken(text, ['croatian', 'hrvatski', 'hrv']) ||
    matchFileExtCode(text, 'hr')
  ) {
    return '🇭🇷';
  }

  // Serbian / Srpski
  if (
    c === 'srp' ||
    c === 'sr' ||
    matchToken(text, ['serbian', 'srpski', 'srp']) ||
    matchFileExtCode(text, 'sr') ||
    text.includes('српски')
  ) {
    return '🇷🇸';
  }

  // Slovak / Slovenčina
  if (
    c === 'slk' ||
    c === 'slo' ||
    c === 'sk' ||
    matchToken(text, ['slovak', 'slovenčina', 'slovencina', 'slk', 'slo']) ||
    matchFileExtCode(text, 'sk')
  ) {
    return '🇸🇰';
  }

  // Slovenian / Slovenščina
  if (
    c === 'slv' ||
    c === 'sl' ||
    matchToken(text, ['slovenian', 'slovenski', 'slovenščina', 'slovenscina', 'slv']) ||
    matchFileExtCode(text, 'sl')
  ) {
    return '🇸🇮';
  }

  // Estonian / Eesti
  if (
    c === 'est' ||
    c === 'et' ||
    matchToken(text, ['estonian', 'eesti', 'est']) ||
    matchFileExtCode(text, 'et')
  ) {
    return '🇪🇪';
  }

  // Latvian / Latviešu
  if (
    c === 'lav' ||
    c === 'lv' ||
    matchToken(text, ['latvian', 'latviešu', 'latviesu', 'lav']) ||
    matchFileExtCode(text, 'lv')
  ) {
    return '🇱🇻';
  }

  // Lithuanian / Lietuvių
  if (
    c === 'lit' ||
    c === 'lt' ||
    matchToken(text, ['lithuanian', 'lietuvių', 'lietuviu', 'lit']) ||
    matchFileExtCode(text, 'lt')
  ) {
    return '🇱🇹';
  }

  // Albanian / Shqip
  if (
    c === 'alb' ||
    c === 'sqi' ||
    c === 'sq' ||
    matchToken(text, ['albanian', 'shqip', 'sqi', 'alb']) ||
    matchFileExtCode(text, 'sq')
  ) {
    return '🇦🇱';
  }

  // Macedonian / Македонски
  if (
    c === 'mac' ||
    c === 'mkd' ||
    c === 'mk' ||
    matchToken(text, ['macedonian', 'македонски', 'mkd', 'mac']) ||
    matchFileExtCode(text, 'mk') ||
    text.includes('македонски')
  ) {
    return '🇲🇰';
  }

  // Icelandic / Íslenska
  if (
    c === 'isl' ||
    c === 'ice' ||
    c === 'is' ||
    matchToken(text, ['icelandic', 'íslenska', 'islenska', 'isl', 'ice']) ||
    matchFileExtCode(text, 'is')
  ) {
    return '🇮🇸';
  }

  // Indian Languages:
  // Hindi
  if (
    c === 'hin' ||
    c === 'hi' ||
    matchToken(text, ['hindi', 'hin']) ||
    matchFileExtCode(text, 'hi') ||
    text.includes('हिन्दी') ||
    text.includes('हिंदी')
  ) {
    return '🇮🇳';
  }

  // Tamil
  if (
    c === 'tam' ||
    c === 'ta' ||
    matchToken(text, ['tamil', 'tam']) ||
    matchFileExtCode(text, 'ta') ||
    text.includes('தமிழ்')
  ) {
    return '🇮🇳';
  }

  // Telugu
  if (
    c === 'tel' ||
    c === 'te' ||
    matchToken(text, ['telugu', 'tel']) ||
    matchFileExtCode(text, 'te') ||
    text.includes('తెలుగు')
  ) {
    return '🇮🇳';
  }

  // Malayalam
  if (
    c === 'mal' ||
    c === 'ml' ||
    matchToken(text, ['malayalam', 'mal']) ||
    matchFileExtCode(text, 'ml') ||
    text.includes('മലയാളം')
  ) {
    return '🇮🇳';
  }

  // Kannada
  if (
    c === 'kan' ||
    c === 'kn' ||
    matchToken(text, ['kannada', 'kan']) ||
    matchFileExtCode(text, 'kn') ||
    text.includes('ಕನ್ನಡ')
  ) {
    return '🇮🇳';
  }

  // Bengali / Bangla
  if (
    c === 'ben' ||
    c === 'bn' ||
    matchToken(text, ['bengali', 'bangla', 'ben']) ||
    matchFileExtCode(text, 'bn') ||
    text.includes('বাংলা')
  ) {
    return '🇧🇩';
  }

  // Marathi
  if (
    c === 'mar' ||
    c === 'mr' ||
    matchToken(text, ['marathi', 'mar']) ||
    matchFileExtCode(text, 'mr') ||
    text.includes('मराठी')
  ) {
    return '🇮🇳';
  }

  // Gujarati
  if (
    c === 'guj' ||
    c === 'gu' ||
    matchToken(text, ['gujarati', 'guj']) ||
    matchFileExtCode(text, 'gu') ||
    text.includes('ગુજરાતી')
  ) {
    return '🇮🇳';
  }

  // Punjabi
  if (
    c === 'pan' ||
    c === 'pa' ||
    matchToken(text, ['punjabi', 'pan']) ||
    matchFileExtCode(text, 'pa') ||
    text.includes('ਪੰਜਾਬੀ')
  ) {
    return '🇮🇳';
  }

  // Urdu
  if (
    c === 'urd' ||
    c === 'ur' ||
    matchToken(text, ['urdu', 'urd']) ||
    matchFileExtCode(text, 'ur') ||
    text.includes('اردو')
  ) {
    return '🇵🇰';
  }

  // Nepali
  if (
    c === 'nep' ||
    c === 'ne' ||
    matchToken(text, ['nepali', 'nep']) ||
    matchFileExtCode(text, 'ne') ||
    text.includes('नेपाली')
  ) {
    return '🇳🇵';
  }

  // Sinhala / Sinhalese
  if (
    c === 'sin' ||
    c === 'si' ||
    matchToken(text, ['sinhala', 'sinhalese', 'sin']) ||
    matchFileExtCode(text, 'si') ||
    text.includes('සිංහල')
  ) {
    return '🇱🇰';
  }

  // Armenian
  if (
    c === 'hye' ||
    c === 'arm' ||
    c === 'hy' ||
    matchToken(text, ['armenian', 'hye', 'arm']) ||
    matchFileExtCode(text, 'hy') ||
    text.includes('հայերեն')
  ) {
    return '🇦🇲';
  }

  // Georgian
  if (
    c === 'kat' ||
    c === 'geo' ||
    c === 'ka' ||
    matchToken(text, ['georgian', 'kat', 'geo']) ||
    matchFileExtCode(text, 'ka') ||
    text.includes('ქართული')
  ) {
    return '🇬🇪';
  }

  // Azerbaijani
  if (
    c === 'aze' ||
    c === 'az' ||
    matchToken(text, ['azerbaijani', 'aze']) ||
    matchFileExtCode(text, 'az') ||
    text.includes('azərbaycan')
  ) {
    return '🇦🇿';
  }

  // Kazakh
  if (
    c === 'kaz' ||
    c === 'kk' ||
    matchToken(text, ['kazakh', 'kaz']) ||
    matchFileExtCode(text, 'kk') ||
    text.includes('қазақ')
  ) {
    return '🇰🇿';
  }

  // Belarusian
  if (
    c === 'bel' ||
    c === 'be' ||
    matchToken(text, ['belarusian', 'bel']) ||
    matchFileExtCode(text, 'be') ||
    text.includes('беларуская')
  ) {
    return '🇧🇾';
  }

  // Bosnian
  if (
    c === 'bos' ||
    c === 'bs' ||
    matchToken(text, ['bosnian', 'bos']) ||
    matchFileExtCode(text, 'bs')
  ) {
    return '🇧🇦';
  }

  // Basque
  if (
    c === 'eus' ||
    c === 'baq' ||
    c === 'eu' ||
    matchToken(text, ['basque', 'euskara', 'eus', 'baq']) ||
    matchFileExtCode(text, 'eu')
  ) {
    return '🇪🇸';
  }

  // Catalan
  if (
    c === 'cat' ||
    c === 'ca' ||
    matchToken(text, ['catalan', 'català', 'cat']) ||
    matchFileExtCode(text, 'ca')
  ) {
    return '🇪🇸';
  }

  // Irish
  if (
    c === 'gle' ||
    c === 'ga' ||
    matchToken(text, ['irish', 'gaeilge', 'gle']) ||
    matchFileExtCode(text, 'ga')
  ) {
    return '🇮🇪';
  }

  // Welsh
  if (
    c === 'cym' ||
    c === 'wel' ||
    c === 'cy' ||
    matchToken(text, ['welsh', 'cymraeg', 'cym', 'wel']) ||
    matchFileExtCode(text, 'cy')
  ) {
    return '🏴󠁧󠁢󠁷󠁬󠁳󠁿';
  }

  // Swahili
  if (
    c === 'swa' ||
    c === 'sw' ||
    matchToken(text, ['swahili', 'kiswahili', 'swa']) ||
    matchFileExtCode(text, 'sw')
  ) {
    return '🇰🇪';
  }

  // Afrikaans
  if (
    c === 'afr' ||
    c === 'af' ||
    matchToken(text, ['afrikaans', 'afr']) ||
    matchFileExtCode(text, 'af')
  ) {
    return '🇿🇦';
  }

  // Burmese
  if (
    c === 'mya' ||
    c === 'bur' ||
    c === 'my' ||
    matchToken(text, ['burmese', 'myanmar', 'mya', 'bur']) ||
    matchFileExtCode(text, 'my')
  ) {
    return '🇲🇲';
  }

  // Khmer
  if (
    c === 'khm' ||
    c === 'km' ||
    matchToken(text, ['khmer', 'cambodian', 'khm']) ||
    matchFileExtCode(text, 'km')
  ) {
    return '🇰🇭';
  }

  // Lao
  if (
    c === 'lao' ||
    c === 'lo' ||
    matchToken(text, ['laotian', 'lao']) ||
    matchFileExtCode(text, 'lo')
  ) {
    return '🇱🇦';
  }

  return '🌐';
}
