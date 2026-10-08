import React from 'react';

/**
 * A country flag drawn as SVG, for language lists.
 *
 * Flag *emoji* do not render on Windows: Segoe UI Emoji has no regional-
 * indicator glyphs, so "🇮🇳" arrives as the letters "IN" and every subtitle
 * row reads as a code rather than a flag — which was the whole complaint. A
 * font that does have them would mean shipping or downloading one; these are
 * simplified vector drawings instead, small enough to sit beside a label and
 * recognisable at 20 px, which is all a picker needs.
 *
 * Simplified on purpose: emblems, coats of arms and fine detail are dropped
 * where they would be invisible at this size. A country with no drawing here
 * falls back to its two-letter code in a badge — the honest fallback, and the
 * same one used for a language that belongs to no single country.
 */

type Draw = () => React.ReactNode;

const W = 30;
const H = 20;

const hStripes = (colors: string[], weights?: number[]): Draw => () => {
  const total = (weights ?? colors.map(() => 1)).reduce((a, b) => a + b, 0);
  let y = 0;
  return colors.map((color, index) => {
    const height = ((weights?.[index] ?? 1) / total) * H;
    const rect = <rect key={index} x={0} y={y} width={W} height={height + 0.05} fill={color} />;
    y += height;
    return rect;
  });
};

const vStripes = (colors: string[]): Draw => () =>
  colors.map((color, index) => (
    <rect key={index} x={(index * W) / colors.length} y={0} width={W / colors.length + 0.05} height={H} fill={color} />
  ));

/** A Nordic cross: background, cross, optional inner cross. */
const nordic = (bg: string, cross: string, inner?: string): Draw => () => (
  <>
    <rect width={W} height={H} fill={bg} />
    <rect x={8} y={0} width={5} height={H} fill={cross} />
    <rect x={0} y={7.5} width={W} height={5} fill={cross} />
    {inner && (
      <>
        <rect x={9.25} y={0} width={2.5} height={H} fill={inner} />
        <rect x={0} y={8.75} width={W} height={2.5} fill={inner} />
      </>
    )}
  </>
);

const withDisc = (base: Draw, color: string, cx = W / 2, r = 5): Draw => () => (
  <>
    {base()}
    <circle cx={cx} cy={H / 2} r={r} fill={color} />
  </>
);

/** A five-pointed star centred at (cx, cy) with outer radius r. */
function starPath(cx: number, cy: number, r: number): string {
  const points: string[] = [];
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? r : r * 0.4;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    points.push(`${(cx + radius * Math.cos(angle)).toFixed(2)},${(cy + radius * Math.sin(angle)).toFixed(2)}`);
  }
  return `M${points.join('L')}Z`;
}

const FLAGS: Record<string, Draw> = {
  IN: () => (
    <>
      {hStripes(['#FF9933', '#FFFFFF', '#138808'])()}
      <circle cx={15} cy={10} r={2.6} fill="none" stroke="#000080" strokeWidth={0.7} />
      <circle cx={15} cy={10} r={0.6} fill="#000080" />
    </>
  ),
  GB: () => (
    <>
      <rect width={W} height={H} fill="#012169" />
      <path d="M0,0 L30,20 M30,0 L0,20" stroke="#FFFFFF" strokeWidth={4} />
      <path d="M0,0 L30,20 M30,0 L0,20" stroke="#C8102E" strokeWidth={1.4} />
      <path d="M15,0 V20 M0,10 H30" stroke="#FFFFFF" strokeWidth={6} />
      <path d="M15,0 V20 M0,10 H30" stroke="#C8102E" strokeWidth={3.4} />
    </>
  ),
  US: () => (
    <>
      {hStripes(Array.from({ length: 13 }, (_, i) => (i % 2 === 0 ? '#B22234' : '#FFFFFF')))()}
      <rect width={12} height={10.8} fill="#3C3B6E" />
      {Array.from({ length: 12 }, (_, i) => (
        <circle key={i} cx={1.6 + (i % 4) * 2.9} cy={1.8 + Math.floor(i / 4) * 3.4} r={0.55} fill="#FFFFFF" />
      ))}
    </>
  ),
  CA: () => (
    <>
      <rect width={W} height={H} fill="#FFFFFF" />
      <rect width={7.5} height={H} fill="#D80621" />
      <rect x={22.5} width={7.5} height={H} fill="#D80621" />
      <path d="M15,4 L16.2,7 L18.5,6.3 L17.6,9.5 L19.5,10 L16.3,12.3 L16.6,14.2 L15.2,13.4 V16 H14.8 V13.4 L13.4,14.2 L13.7,12.3 L10.5,10 L12.4,9.5 L11.5,6.3 L13.8,7 Z" fill="#D80621" />
    </>
  ),
  FR: vStripes(['#002395', '#FFFFFF', '#ED2939']),
  IT: vStripes(['#009246', '#FFFFFF', '#CE2B37']),
  IE: vStripes(['#169B62', '#FFFFFF', '#FF883E']),
  RO: vStripes(['#002B7F', '#FCD116', '#CE1126']),
  BE: vStripes(['#000000', '#FDDA24', '#EF3340']),
  DE: hStripes(['#000000', '#DD0000', '#FFCE00']),
  RU: hStripes(['#FFFFFF', '#0039A6', '#D52B1E']),
  NL: hStripes(['#AE1C28', '#FFFFFF', '#21468B']),
  HU: hStripes(['#CD2A3E', '#FFFFFF', '#436F4D']),
  BG: hStripes(['#FFFFFF', '#00966E', '#D62612']),
  EE: hStripes(['#0072CE', '#000000', '#FFFFFF']),
  LT: hStripes(['#FDB913', '#006A44', '#C1272D']),
  LV: hStripes(['#9E3039', '#FFFFFF', '#9E3039'], [2, 1, 2]),
  UA: hStripes(['#0057B7', '#FFD700']),
  PL: hStripes(['#FFFFFF', '#DC143C']),
  ID: hStripes(['#CE1126', '#FFFFFF']),
  AM: hStripes(['#D90012', '#0033A0', '#F2A800']),
  AZ: hStripes(['#00B5E2', '#EF3340', '#509E2F']),
  IR: hStripes(['#239F40', '#FFFFFF', '#DA0000']),
  SI: hStripes(['#FFFFFF', '#005DA4', '#ED1C24']),
  SK: hStripes(['#FFFFFF', '#0B4EA2', '#EE1C25']),
  HR: hStripes(['#FF0000', '#FFFFFF', '#171796']),
  RS: hStripes(['#C6363C', '#0C4076', '#FFFFFF']),
  BY: hStripes(['#CE1720', '#007C30'], [2, 1]),
  TH: hStripes(['#A51931', '#F4F5F8', '#2D2A4A', '#F4F5F8', '#A51931'], [1, 1, 2, 1, 1]),
  ES: hStripes(['#AA151B', '#F1BF00', '#AA151B'], [1, 2, 1]),
  SE: nordic('#006AA7', '#FECC00'),
  DK: nordic('#C8102E', '#FFFFFF'),
  FI: nordic('#FFFFFF', '#003580'),
  NO: nordic('#BA0C2F', '#FFFFFF', '#00205B'),
  IS: nordic('#02529C', '#FFFFFF', '#DC1E35'),
  JP: withDisc(() => <rect width={W} height={H} fill="#FFFFFF" />, '#BC002D', 15, 5.5),
  BD: withDisc(() => <rect width={W} height={H} fill="#006A4E" />, '#F42A41', 13.5, 5.5),
  LA: withDisc(hStripes(['#CE1126', '#002868', '#CE1126'], [1, 2, 1]), '#FFFFFF', 15, 3.8),
  KZ: withDisc(() => <rect width={W} height={H} fill="#00AFCA" />, '#FEC50C', 15, 4.5),
  KR: () => (
    <>
      <rect width={W} height={H} fill="#FFFFFF" />
      <path d="M10,10 A5,5 0 0 1 20,10 Z" fill="#CD2E3A" />
      <path d="M10,10 A5,5 0 0 0 20,10 Z" fill="#0047A0" />
      <circle cx={12.5} cy={10} r={2.5} fill="#CD2E3A" />
      <circle cx={17.5} cy={10} r={2.5} fill="#0047A0" />
      {[[4, 4], [26, 4], [4, 16], [26, 16]].map(([x, y]) => (
        <rect key={`${x}${y}`} x={x - 1.5} y={y - 1.5} width={3} height={3} fill="#000000" opacity={0.85} />
      ))}
    </>
  ),
  CN: () => (
    <>
      <rect width={W} height={H} fill="#EE1C25" />
      <path d={starPath(5, 5, 3)} fill="#FFFF00" />
      {[[10, 2], [12, 4], [12, 7], [10, 9]].map(([x, y]) => (
        <path key={`${x}${y}`} d={starPath(x, y, 1)} fill="#FFFF00" />
      ))}
    </>
  ),
  TW: () => (
    <>
      <rect width={W} height={H} fill="#FE0000" />
      <rect width={15} height={10} fill="#000095" />
      <circle cx={7.5} cy={5} r={2.6} fill="#FFFFFF" />
    </>
  ),
  HK: withDisc(() => <rect width={W} height={H} fill="#DE2910" />, '#FFFFFF', 15, 4),
  VN: () => (
    <>
      <rect width={W} height={H} fill="#DA251D" />
      <path d={starPath(15, 10.5, 6)} fill="#FFFF00" />
    </>
  ),
  MM: () => (
    <>
      {hStripes(['#FECB00', '#34B233', '#EA2839'])()}
      <path d={starPath(15, 10.8, 7)} fill="#FFFFFF" />
    </>
  ),
  TR: () => (
    <>
      <rect width={W} height={H} fill="#E30A17" />
      <circle cx={11.5} cy={10} r={5} fill="#FFFFFF" />
      <circle cx={12.8} cy={10} r={4} fill="#E30A17" />
      <path d={starPath(18, 10, 2.3)} fill="#FFFFFF" />
    </>
  ),
  PK: () => (
    <>
      <rect width={W} height={H} fill="#01411C" />
      <rect width={7.5} height={H} fill="#FFFFFF" />
      <circle cx={19} cy={10} r={5} fill="#FFFFFF" />
      <circle cx={20.4} cy={8.9} r={4.2} fill="#01411C" />
      <path d={starPath(22.5, 7.5, 1.6)} fill="#FFFFFF" />
    </>
  ),
  SA: () => (
    <>
      <rect width={W} height={H} fill="#006C35" />
      <rect x={7} y={6} width={16} height={2.2} rx={1} fill="#FFFFFF" />
      <rect x={8} y={12.5} width={14} height={1.2} fill="#FFFFFF" />
    </>
  ),
  IL: () => (
    <>
      <rect width={W} height={H} fill="#FFFFFF" />
      <rect y={2} width={W} height={2.6} fill="#0038B8" />
      <rect y={15.4} width={W} height={2.6} fill="#0038B8" />
      <path d="M15,6.3 L18.2,11.8 H11.8 Z M15,13.7 L11.8,8.2 H18.2 Z" fill="none" stroke="#0038B8" strokeWidth={0.8} />
    </>
  ),
  GR: () => (
    <>
      {hStripes(Array.from({ length: 9 }, (_, i) => (i % 2 === 0 ? '#0D5EAF' : '#FFFFFF')))()}
      <rect width={11.1} height={11.1} fill="#0D5EAF" />
      <rect x={4.45} width={2.2} height={11.1} fill="#FFFFFF" />
      <rect y={4.45} width={11.1} height={2.2} fill="#FFFFFF" />
    </>
  ),
  CZ: () => (
    <>
      {hStripes(['#FFFFFF', '#D7141A'])()}
      <path d="M0,0 L15,10 L0,20 Z" fill="#11457E" />
    </>
  ),
  PH: () => (
    <>
      {hStripes(['#0038A8', '#CE1126'])()}
      <path d="M0,0 L17,10 L0,20 Z" fill="#FFFFFF" />
      <circle cx={5.5} cy={10} r={2} fill="#FCD116" />
    </>
  ),
  BA: () => (
    <>
      <rect width={W} height={H} fill="#002395" />
      <path d="M8,0 H24 V20 Z" fill="#FECB00" />
    </>
  ),
  PT: () => (
    <>
      <rect width={W} height={H} fill="#FF0000" />
      <rect width={12} height={H} fill="#006600" />
      <circle cx={12} cy={10} r={3.6} fill="#FFFF00" />
      <circle cx={12} cy={10} r={2.2} fill="#FF0000" />
    </>
  ),
  BR: () => (
    <>
      <rect width={W} height={H} fill="#009C3B" />
      <path d="M15,2.2 L27.5,10 L15,17.8 L2.5,10 Z" fill="#FFDF00" />
      <circle cx={15} cy={10} r={4.3} fill="#002776" />
    </>
  ),
  MX: () => (
    <>
      {vStripes(['#006847', '#FFFFFF', '#CE1126'])()}
      <circle cx={15} cy={10} r={2} fill="#8C5A2B" />
    </>
  ),
  MY: () => (
    <>
      {hStripes(Array.from({ length: 14 }, (_, i) => (i % 2 === 0 ? '#CC0001' : '#FFFFFF')))()}
      <rect width={15} height={11.4} fill="#010066" />
      <circle cx={6} cy={5.7} r={3.4} fill="#FFCC00" />
      <circle cx={7.2} cy={5.7} r={2.8} fill="#010066" />
      <path d={starPath(11, 5.7, 2.2)} fill="#FFCC00" />
    </>
  ),
  KH: () => (
    <>
      {hStripes(['#032EA1', '#E00025', '#032EA1'], [1, 2, 1])()}
      <rect x={11} y={7.5} width={8} height={5} fill="#FFFFFF" />
    </>
  ),
  GE: () => (
    <>
      <rect width={W} height={H} fill="#FFFFFF" />
      <rect x={12.5} width={5} height={H} fill="#FF0000" />
      <rect y={7.5} width={W} height={5} fill="#FF0000" />
    </>
  ),
  KE: () => (
    <>
      {hStripes(['#000000', '#FFFFFF', '#BB0000', '#FFFFFF', '#006600'], [6, 1, 6, 1, 6])()}
      <ellipse cx={15} cy={10} rx={2.6} ry={5.5} fill="#BB0000" stroke="#000000" strokeWidth={0.6} />
    </>
  ),
  ZA: () => (
    <>
      <rect width={W} height={H} fill="#FFFFFF" />
      <path d="M0,0 H30 V6.7 H13 Z" fill="#E03C31" />
      <path d="M0,20 H30 V13.3 H13 Z" fill="#001489" />
      <path d="M0,2 L11,10 L0,18 Z" fill="#000000" stroke="#FFB612" strokeWidth={1.2} />
      <path d="M11.5,10 H30" stroke="#007749" strokeWidth={4} />
    </>
  ),
  AL: () => (
    <>
      <rect width={W} height={H} fill="#E41E20" />
      <path d="M15,5 L19,10 L15,15 L11,10 Z" fill="#000000" />
    </>
  ),
  MK: () => (
    <>
      <rect width={W} height={H} fill="#D20000" />
      <path d="M15,10 L0,0 H4 Z M15,10 L30,0 H26 Z M15,10 L0,20 H4 Z M15,10 L30,20 H26 Z M15,10 L13,0 H17 Z M15,10 L13,20 H17 Z M15,10 L0,8.5 V11.5 Z M15,10 L30,8.5 V11.5 Z" fill="#FFE600" />
      <circle cx={15} cy={10} r={3} fill="#FFE600" stroke="#D20000" strokeWidth={0.6} />
    </>
  ),
};

/** `🇮🇳` → `IN`. Non-flag emoji (🌐, subdivision tags) → undefined. */
export function countryFromFlagEmoji(flag: string | undefined): string | undefined {
  if (!flag) return undefined;
  const points = [...flag].map((char) => char.codePointAt(0) ?? 0);
  if (points.length !== 2 || points.some((point) => point < 0x1f1e6 || point > 0x1f1ff)) return undefined;
  return String.fromCharCode(...points.map((point) => point - 0x1f1e6 + 65));
}

export const FlagIcon: React.FC<{
  /** ISO 3166 country code, or a flag emoji to read one from. */
  country?: string;
  flag?: string;
  /** Shown when there is no drawing: a language or country code. */
  fallback?: string;
  size?: number;
  className?: string;
  title?: string;
}> = ({ country, flag, fallback, size = 18, className, title }) => {
  const code = (country ?? countryFromFlagEmoji(flag))?.toUpperCase();
  const draw = code ? FLAGS[code] : undefined;
  const height = Math.round((size * H) / W);
  if (!draw) {
    const text = (fallback ?? code ?? '').slice(0, 3).toUpperCase();
    if (!text) return null;
    return (
      <span className={`flag-icon flag-icon--code${className ? ` ${className}` : ''}`} title={title} aria-hidden={title ? undefined : true}>
        {text}
      </span>
    );
  }
  return (
    <svg
      className={`flag-icon${className ? ` ${className}` : ''}`}
      width={size}
      height={height}
      viewBox={`0 0 ${W} ${H}`}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {title && <title>{title}</title>}
      <defs>
        <clipPath id="flag-clip">
          <rect width={W} height={H} rx={2.5} />
        </clipPath>
      </defs>
      <g clipPath="url(#flag-clip)">{draw()}</g>
      <rect width={W} height={H} rx={2.5} fill="none" stroke="rgba(0,0,0,0.25)" strokeWidth={0.6} />
    </svg>
  );
};

/** Every drawn country, for the test that pins the table. */
export const DRAWN_COUNTRIES = Object.keys(FLAGS);
