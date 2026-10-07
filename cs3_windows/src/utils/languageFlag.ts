/**
 * Detects flag emojis and clean display names for subtitle language codes,
 * language names, native endonyms, and release filenames (e.g. `dune.2024.1080p.eng.srt`, `2_Spanish.srt`).
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

interface LanguageDef {
  name: string;
  flag: string;
  codes?: string[];
  tokens?: string[];
  fileExtCodes?: string[];
  custom?: (text: string, c: string) => boolean;
}

const LANGUAGES: LanguageDef[] = [
  // 1. Regional / Variant distinctions first:
  {
    name: 'Portuguese (BR)',
    flag: '🇧🇷',
    codes: ['pob', 'pt-br'],
    tokens: ['brazil', 'brasil', 'brazilian', 'pt-br', 'pob', 'br'],
    custom: (text) =>
      text.includes('portuguese (br)') ||
      text.includes('português (br)') ||
      text.includes('portugues (br)'),
  },
  {
    name: 'Spanish (Latin America)',
    flag: '🇲🇽',
    codes: ['es-419', 'es-la'],
    tokens: [
      'latino',
      'latinoamérica',
      'latinoamerica',
      'latin america',
      'mexican',
      'mexico',
      'es-419',
      'es-la',
    ],
  },
  {
    name: 'French (Canadian)',
    flag: '🇨🇦',
    codes: ['fr-ca'],
    tokens: ['canadian french', 'québécois', 'quebecois', 'quebec', 'fr-ca'],
  },
  {
    name: 'Chinese (Traditional)',
    flag: '🇹🇼',
    codes: ['zht', 'zh-tw'],
    tokens: ['traditional', 'taiwan', 'zh-tw', 'zht'],
    custom: (text) => text.includes('繁體') || text.includes('繁体'),
  },
  {
    name: 'Cantonese',
    flag: '🇭🇰',
    codes: ['zh-hk'],
    tokens: ['hong kong', 'cantonese', 'zh-hk'],
    custom: (text) => text.includes('粵語') || text.includes('粤语'),
  },
  {
    name: 'English (US)',
    flag: '🇺🇸',
    codes: ['en-us'],
    tokens: ['american english', 'en-us'],
  },

  // 2. Core languages:
  {
    name: 'English',
    flag: '🇬🇧',
    codes: ['eng', 'en', 'en-gb'],
    tokens: ['english', 'eng'],
    fileExtCodes: ['en'],
  },
  {
    name: 'Spanish',
    flag: '🇪🇸',
    codes: ['spa', 'es', 'esp'],
    tokens: ['spanish', 'español', 'espanol', 'castellano', 'spa', 'esp'],
    fileExtCodes: ['es'],
  },
  {
    name: 'Portuguese',
    flag: '🇵🇹',
    codes: ['por', 'pt'],
    tokens: ['portuguese', 'português', 'portugues', 'por'],
    fileExtCodes: ['pt'],
  },
  {
    name: 'French',
    flag: '🇫🇷',
    codes: ['fre', 'fra', 'fr'],
    tokens: ['french', 'français', 'francais', 'fra', 'fre'],
    fileExtCodes: ['fr'],
  },
  {
    name: 'German',
    flag: '🇩🇪',
    codes: ['ger', 'deu', 'de'],
    tokens: ['german', 'deutsch', 'deu', 'ger'],
    fileExtCodes: ['de'],
  },
  {
    name: 'Italian',
    flag: '🇮🇹',
    codes: ['ita', 'it'],
    tokens: ['italian', 'italiano', 'ita'],
    fileExtCodes: ['it'],
  },
  {
    name: 'Japanese',
    flag: '🇯🇵',
    codes: ['jpn', 'ja', 'jap'],
    tokens: ['japanese', 'nihongo', 'jpn', 'jap'],
    fileExtCodes: ['ja'],
    custom: (text) => text.includes('日本語'),
  },
  {
    name: 'Korean',
    flag: '🇰🇷',
    codes: ['kor', 'ko'],
    tokens: ['korean', 'hangul', 'kor'],
    fileExtCodes: ['ko'],
    custom: (text) => text.includes('한국어'),
  },
  {
    name: 'Chinese',
    flag: '🇨🇳',
    codes: ['zho', 'chi', 'zh', 'zh-cn'],
    tokens: ['chinese', 'mandarin', 'zho', 'chi'],
    fileExtCodes: ['zh'],
    custom: (text) =>
      text.includes('中文') ||
      text.includes('汉语') ||
      text.includes('漢語') ||
      text.includes('普通话'),
  },
  {
    name: 'Russian',
    flag: '🇷🇺',
    codes: ['rus', 'ru'],
    tokens: ['russian', 'русский', 'rus'],
    fileExtCodes: ['ru'],
    custom: (text) => text.includes('русский'),
  },
  {
    name: 'Arabic',
    flag: '🇸🇦',
    codes: ['ara', 'ar'],
    tokens: ['arabic', 'ara'],
    fileExtCodes: ['ar'],
    custom: (text) => text.includes('العربية') || text.includes('عربي'),
  },
  {
    name: 'Turkish',
    flag: '🇹🇷',
    codes: ['tur', 'tr'],
    tokens: ['turkish', 'türkçe', 'turkce', 'tur'],
    fileExtCodes: ['tr'],
  },
  {
    name: 'Polish',
    flag: '🇵🇱',
    codes: ['pol', 'pl'],
    tokens: ['polish', 'polski', 'pol'],
    fileExtCodes: ['pl'],
  },
  {
    name: 'Dutch',
    flag: '🇳🇱',
    codes: ['dut', 'nld', 'nl'],
    tokens: ['dutch', 'nederlands', 'flemish', 'vlaams', 'nld', 'dut'],
    fileExtCodes: ['nl'],
  },
  {
    name: 'Swedish',
    flag: '🇸🇪',
    codes: ['swe', 'sv'],
    tokens: ['swedish', 'svenska', 'swe'],
    fileExtCodes: ['sv'],
  },
  {
    name: 'Norwegian',
    flag: '🇳🇴',
    codes: ['nor', 'no', 'nob', 'nno'],
    tokens: ['norwegian', 'norsk', 'nor', 'nob', 'nno'],
    fileExtCodes: ['no'],
  },
  {
    name: 'Danish',
    flag: '🇩🇰',
    codes: ['dan', 'da'],
    tokens: ['danish', 'dansk', 'dan'],
    fileExtCodes: ['da'],
  },
  {
    name: 'Finnish',
    flag: '🇫🇮',
    codes: ['fin', 'fi'],
    tokens: ['finnish', 'suomi', 'fin'],
    fileExtCodes: ['fi'],
  },
  {
    name: 'Greek',
    flag: '🇬🇷',
    codes: ['gre', 'ell', 'el'],
    tokens: ['greek', 'ελληνικά', 'ellinika', 'ell', 'gre'],
    fileExtCodes: ['el'],
    custom: (text) => text.includes('ελληνικά'),
  },
  {
    name: 'Hebrew',
    flag: '🇮🇱',
    codes: ['heb', 'he'],
    tokens: ['hebrew', 'ivrit', 'heb'],
    fileExtCodes: ['he'],
    custom: (text) => text.includes('עברית'),
  },
  {
    name: 'Vietnamese',
    flag: '🇻🇳',
    codes: ['vie', 'vi'],
    tokens: ['vietnamese', 'tiếng việt', 'tieng viet', 'vie'],
    fileExtCodes: ['vi'],
  },
  {
    name: 'Indonesian',
    flag: '🇮🇩',
    codes: ['ind', 'id'],
    tokens: ['indonesian', 'bahasa indonesia', 'ind'],
    fileExtCodes: ['id'],
  },
  {
    name: 'Malay',
    flag: '🇲🇾',
    codes: ['msa', 'may', 'ms'],
    tokens: ['malay', 'bahasa melayu', 'msa', 'may'],
    fileExtCodes: ['ms'],
  },
  {
    name: 'Thai',
    flag: '🇹🇭',
    codes: ['tha', 'th'],
    tokens: ['thai', 'tha'],
    fileExtCodes: ['th'],
    custom: (text) => text.includes('ไทย'),
  },
  {
    name: 'Filipino',
    flag: '🇵🇭',
    codes: ['tgl', 'fil', 'tl'],
    tokens: ['tagalog', 'filipino', 'pilipino', 'tgl', 'fil'],
    fileExtCodes: ['tl'],
  },
  {
    name: 'Persian',
    flag: '🇮🇷',
    codes: ['fas', 'per', 'fa'],
    tokens: ['persian', 'farsi', 'fas', 'per'],
    fileExtCodes: ['fa'],
    custom: (text) => text.includes('فارسی'),
  },
  {
    name: 'Ukrainian',
    flag: '🇺🇦',
    codes: ['ukr', 'uk'],
    tokens: ['ukrainian', 'українська', 'ukr'],
    fileExtCodes: ['uk'],
    custom: (text) => text.includes('українська'),
  },
  {
    name: 'Romanian',
    flag: '🇷🇴',
    codes: ['ron', 'rum', 'ro'],
    tokens: ['romanian', 'română', 'romana', 'ron', 'rum'],
    fileExtCodes: ['ro'],
  },
  {
    name: 'Czech',
    flag: '🇨🇿',
    codes: ['ces', 'cze', 'cs'],
    tokens: ['czech', 'čeština', 'cestina', 'cze', 'ces'],
    fileExtCodes: ['cs'],
  },
  {
    name: 'Hungarian',
    flag: '🇭🇺',
    codes: ['hun', 'hu'],
    tokens: ['hungarian', 'magyar', 'hun'],
    fileExtCodes: ['hu'],
  },
  {
    name: 'Bulgarian',
    flag: '🇧🇬',
    codes: ['bul', 'bg'],
    tokens: ['bulgarian', 'български', 'bul'],
    fileExtCodes: ['bg'],
    custom: (text) => text.includes('български'),
  },
  {
    name: 'Croatian',
    flag: '🇭🇷',
    codes: ['hrv', 'hr'],
    tokens: ['croatian', 'hrvatski', 'hrv'],
    fileExtCodes: ['hr'],
  },
  {
    name: 'Serbian',
    flag: '🇷🇸',
    codes: ['srp', 'sr'],
    tokens: ['serbian', 'srpski', 'srp'],
    fileExtCodes: ['sr'],
    custom: (text) => text.includes('српски'),
  },
  {
    name: 'Slovak',
    flag: '🇸🇰',
    codes: ['slk', 'slo', 'sk'],
    tokens: ['slovak', 'slovenčina', 'slovencina', 'slk', 'slo'],
    fileExtCodes: ['sk'],
  },
  {
    name: 'Slovenian',
    flag: '🇸🇮',
    codes: ['slv', 'sl'],
    tokens: ['slovenian', 'slovenski', 'slovenščina', 'slovenscina', 'slv'],
    fileExtCodes: ['sl'],
  },
  {
    name: 'Estonian',
    flag: '🇪🇪',
    codes: ['est', 'et'],
    tokens: ['estonian', 'eesti', 'est'],
    fileExtCodes: ['et'],
  },
  {
    name: 'Latvian',
    flag: '🇱🇻',
    codes: ['lav', 'lv'],
    tokens: ['latvian', 'latviešu', 'latviesu', 'lav'],
    fileExtCodes: ['lv'],
  },
  {
    name: 'Lithuanian',
    flag: '🇱🇹',
    codes: ['lit', 'lt'],
    tokens: ['lithuanian', 'lietuvių', 'lietuviu', 'lit'],
    fileExtCodes: ['lt'],
  },
  {
    name: 'Albanian',
    flag: '🇦🇱',
    codes: ['alb', 'sqi', 'sq'],
    tokens: ['albanian', 'shqip', 'sqi', 'alb'],
    fileExtCodes: ['sq'],
  },
  {
    name: 'Macedonian',
    flag: '🇲🇰',
    codes: ['mac', 'mkd', 'mk'],
    tokens: ['macedonian', 'македонски', 'mkd', 'mac'],
    fileExtCodes: ['mk'],
    custom: (text) => text.includes('македонски'),
  },
  {
    name: 'Icelandic',
    flag: '🇮🇸',
    codes: ['isl', 'ice', 'is'],
    tokens: ['icelandic', 'íslenska', 'islenska', 'isl', 'ice'],
    fileExtCodes: ['is'],
  },
  {
    name: 'Hindi',
    flag: '🇮🇳',
    codes: ['hin', 'hi'],
    tokens: ['hindi', 'hin'],
    fileExtCodes: ['hi'],
    custom: (text) => text.includes('हिन्दी') || text.includes('हिंदी'),
  },
  {
    name: 'Tamil',
    flag: '🇮🇳',
    codes: ['tam', 'ta'],
    tokens: ['tamil', 'tam'],
    fileExtCodes: ['ta'],
    custom: (text) => text.includes('தமிழ்'),
  },
  {
    name: 'Telugu',
    flag: '🇮🇳',
    codes: ['tel', 'te'],
    tokens: ['telugu', 'tel'],
    fileExtCodes: ['te'],
    custom: (text) => text.includes('తెలుగు'),
  },
  {
    name: 'Malayalam',
    flag: '🇮🇳',
    codes: ['mal', 'ml'],
    tokens: ['malayalam', 'mal'],
    fileExtCodes: ['ml'],
    custom: (text) => text.includes('മലയാളം'),
  },
  {
    name: 'Kannada',
    flag: '🇮🇳',
    codes: ['kan', 'kn'],
    tokens: ['kannada', 'kan'],
    fileExtCodes: ['kn'],
    custom: (text) => text.includes('ಕನ್ನಡ'),
  },
  {
    name: 'Bengali',
    flag: '🇧🇩',
    codes: ['ben', 'bn'],
    tokens: ['bengali', 'bangla', 'ben'],
    fileExtCodes: ['bn'],
    custom: (text) => text.includes('বাংলা'),
  },
  {
    name: 'Marathi',
    flag: '🇮🇳',
    codes: ['mar', 'mr'],
    tokens: ['marathi', 'mar'],
    fileExtCodes: ['mr'],
    custom: (text) => text.includes('मराठी'),
  },
  {
    name: 'Gujarati',
    flag: '🇮🇳',
    codes: ['guj', 'gu'],
    tokens: ['gujarati', 'guj'],
    fileExtCodes: ['gu'],
    custom: (text) => text.includes('ગુજરાતી'),
  },
  {
    name: 'Punjabi',
    flag: '🇮🇳',
    codes: ['pan', 'pa'],
    tokens: ['punjabi', 'pan'],
    fileExtCodes: ['pa'],
    custom: (text) => text.includes('ਪੰਜਾਬੀ'),
  },
  {
    name: 'Urdu',
    flag: '🇵🇰',
    codes: ['urd', 'ur'],
    tokens: ['urdu', 'urd'],
    fileExtCodes: ['ur'],
    custom: (text) => text.includes('اردو'),
  },
  {
    name: 'Nepali',
    flag: '🇳🇵',
    codes: ['nep', 'ne'],
    tokens: ['nepali', 'nep'],
    fileExtCodes: ['ne'],
    custom: (text) => text.includes('नेपाली'),
  },
  {
    name: 'Sinhala',
    flag: '🇱🇰',
    codes: ['sin', 'si'],
    tokens: ['sinhala', 'sinhalese', 'sin'],
    fileExtCodes: ['si'],
    custom: (text) => text.includes('සිංහල'),
  },
  {
    name: 'Armenian',
    flag: '🇦🇲',
    codes: ['hye', 'arm', 'hy'],
    tokens: ['armenian', 'hye', 'arm'],
    fileExtCodes: ['hy'],
    custom: (text) => text.includes('հայերեն'),
  },
  {
    name: 'Georgian',
    flag: '🇬🇪',
    codes: ['kat', 'geo', 'ka'],
    tokens: ['georgian', 'kat', 'geo'],
    fileExtCodes: ['ka'],
    custom: (text) => text.includes('ქართული'),
  },
  {
    name: 'Azerbaijani',
    flag: '🇦🇿',
    codes: ['aze', 'az'],
    tokens: ['azerbaijani', 'aze'],
    fileExtCodes: ['az'],
    custom: (text) => text.includes('azərbaycan'),
  },
  {
    name: 'Kazakh',
    flag: '🇰🇿',
    codes: ['kaz', 'kk'],
    tokens: ['kazakh', 'kaz'],
    fileExtCodes: ['kk'],
    custom: (text) => text.includes('қазақ'),
  },
  {
    name: 'Belarusian',
    flag: '🇧🇾',
    codes: ['bel', 'be'],
    tokens: ['belarusian', 'bel'],
    fileExtCodes: ['be'],
    custom: (text) => text.includes('беларуская'),
  },
  {
    name: 'Bosnian',
    flag: '🇧🇦',
    codes: ['bos', 'bs'],
    tokens: ['bosnian', 'bos'],
    fileExtCodes: ['bs'],
  },
  {
    name: 'Basque',
    flag: '🇪🇸',
    codes: ['eus', 'baq', 'eu'],
    tokens: ['basque', 'euskara', 'eus', 'baq'],
    fileExtCodes: ['eu'],
  },
  {
    name: 'Catalan',
    flag: '🇪🇸',
    codes: ['cat', 'ca'],
    tokens: ['catalan', 'català', 'cat'],
    fileExtCodes: ['ca'],
  },
  {
    name: 'Irish',
    flag: '🇮🇪',
    codes: ['gle', 'ga'],
    tokens: ['irish', 'gaeilge', 'gle'],
    fileExtCodes: ['ga'],
  },
  {
    name: 'Welsh',
    flag: '🏴󠁧󠁢󠁷󠁬󠁳󠁿',
    codes: ['cym', 'wel', 'cy'],
    tokens: ['welsh', 'cymraeg', 'cym', 'wel'],
    fileExtCodes: ['cy'],
  },
  {
    name: 'Swahili',
    flag: '🇰🇪',
    codes: ['swa', 'sw'],
    tokens: ['swahili', 'kiswahili', 'swa'],
    fileExtCodes: ['sw'],
  },
  {
    name: 'Afrikaans',
    flag: '🇿🇦',
    codes: ['afr', 'af'],
    tokens: ['afrikaans', 'afr'],
    fileExtCodes: ['af'],
  },
  {
    name: 'Burmese',
    flag: '🇲🇲',
    codes: ['mya', 'bur', 'my'],
    tokens: ['burmese', 'myanmar', 'mya', 'bur'],
    fileExtCodes: ['my'],
  },
  {
    name: 'Khmer',
    flag: '🇰🇭',
    codes: ['khm', 'km'],
    tokens: ['khmer', 'cambodian', 'khm'],
    fileExtCodes: ['km'],
  },
  {
    name: 'Lao',
    flag: '🇱🇦',
    codes: ['lao', 'lo'],
    tokens: ['laotian', 'lao'],
    fileExtCodes: ['lo'],
  },
];

function findLanguage(code: string, name?: string): LanguageDef | null {
  const c = (code || '').toLowerCase().trim();
  const n = (name || '').toLowerCase().trim();
  const text = `${c} ${n}`;

  for (const lang of LANGUAGES) {
    if (lang.codes?.includes(c)) return lang;
    if (lang.tokens && matchToken(text, lang.tokens)) return lang;
    if (lang.fileExtCodes) {
      for (const fec of lang.fileExtCodes) {
        if (matchFileExtCode(text, fec)) return lang;
      }
    }
    if (lang.custom?.(text, c)) return lang;
  }
  return null;
}

export function getLanguageFlag(code: string, name?: string): string {
  const match = findLanguage(code, name);
  return match ? match.flag : '🌐';
}

export function getLanguageName(code: string, name?: string): string {
  const match = findLanguage(code, name);
  return match ? match.name : '';
}
