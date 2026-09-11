/**
 * A link that names a piece of media, not a way to fetch it.
 *
 * Someone shares *Reacher S4E2* with a friend. The friend clicks it, CloudStream
 * opens on that exact page, resolves fresh sources and plays. No searching, no
 * repository hunting, no "which provider was it".
 *
 * ## What a link may carry, and why the list is short
 *
 * **Identity and display copy only.** A stream URL is a signed, expiring,
 * provider-specific thing — the repository already treats those as perishable
 * (`SourceCache` gives them deadlines; `PageSnapshot` deliberately stores none)
 * and a link pasted into a chat outlives them by months. So the link carries
 * what is durable — an IMDb id, a title, a year, a season and episode — and the
 * recipient's own app does the resolving, with their providers and their
 * settings.
 *
 * ## The security rule, stated plainly
 *
 * **This link arrives from an untrusted party.** It came through WhatsApp from
 * someone who got it from someone else. So the question is not "is it valid"
 * but "what is the worst thing a hostile one can do", and the answer has to be
 * *open the wrong page*.
 *
 * That is why the payload contains **no URLs at all** — not for the repository,
 * not for the provider, not for the poster. A repository travels as an `id`
 * that is looked up in the shipped catalogue, exactly as `ott:installSuggestion`
 * takes a repository id and never a URL, and for the same reason: accepting a
 * URL would turn "open this link" into "install code from wherever the sender
 * chose". A provider travels as a **name**, matched against what the recipient
 * already has installed; an unknown name is a preference that cannot be honoured
 * rather than something to go and fetch.
 *
 * ## On "signing"
 *
 * The PRD asks for signed links. An honest implementation has to say what that
 * can and cannot mean here: there is no server and no secret, so any key ships
 * inside the app and anyone can compute a valid tag. {@link INTEGRITY_NOTE}
 *
 * So {@link sign} is a **checksum, not an authentication**. It earns its place
 * against the failure that actually happens — chat clients truncate long links,
 * wrap them, strip trailing characters, and turn a payload into something that
 * decodes to *almost* the right media. A tag catches that and refuses, instead
 * of opening a page for a different film. It is deliberately not called a
 * signature anywhere in the code.
 *
 * What carries the real safety is the paragraph above: the payload cannot
 * express anything dangerous, so a forged one is no more powerful than an
 * honest one.
 *
 * ## Versioning
 *
 * `v` is the first field and is checked before anything else is read. A link
 * from a future version is refused with a message naming the app as the thing
 * to update — the alternative is reading unknown fields with today's meanings,
 * which is how a link opens confidently on the wrong content.
 */

/** Kept where the reasoning is, so it cannot drift from the code that relies on it. */
export const INTEGRITY_NOTE =
  'The tag detects corruption in transit, not tampering: a distributed app has ' +
  'no secret to sign with. Safety comes from the payload being unable to ' +
  'express anything dangerous — no URLs, repositories by catalogue id only.';

/** The scheme the desktop app registers. */
export const SHARE_SCHEME = 'cloudstream';

/**
 * The payload version.
 *
 * 1 — identity, display copy, season/episode, preferred provider by name,
 *     repository by catalogue id, language and quality preferences.
 */
export const SHARE_VERSION = 1;

export type ShareMediaType = 'movie' | 'series' | 'anime' | 'other';

export interface SharePayload {
  /** Payload version. Checked before any other field is read. */
  v: number;
  /**
   * The durable address of the work — `cs3meta://cinemeta/series/tt9288030`,
   * or a provider address for something only a provider knows about.
   *
   * Never a stream URL. `isShareableAddress` enforces that on the way in.
   */
  url: string;
  /** IMDb or equivalent, when known. Survives an address that stops working. */
  id?: string;
  title: string;
  originalTitle?: string;
  year?: number;
  type?: ShareMediaType;
  season?: number;
  episode?: number;
  /** Display only, so the recipient sees the page before anything resolves. */
  poster?: string;
  plot?: string;
  /** The provider the sender was watching on, by name. A preference, not a URL. */
  provider?: string;
  /** The repository that published it, by catalogue id. Never a URL. */
  repository?: string;
  /** Audio language the sender was using, as a hint for source ranking. */
  language?: string;
  /** e.g. `1080p`. A preference; absence means "whatever is best". */
  quality?: string;
}

/** What a decode can say, so a caller can tell a corrupt link from an old one. */
export type ShareDecodeResult =
  | { ok: true; payload: SharePayload }
  | { ok: false; reason: string; kind: 'malformed' | 'corrupt' | 'unsupported' };

/**
 * Addresses a share link may carry.
 *
 * The allow-list is the enforcement point for "no fetchable URLs". `cs3meta://`,
 * `cs3ext://` and `cs3native://` all name *something the app knows how to look
 * up*; `http(s)` and `magnet` name bytes to go and get, which is the thing a
 * link from a stranger must never be able to point at.
 */
export function isShareableAddress(url: string): boolean {
  return /^cs3(meta|ext|native):\/\//i.test(url.trim());
}

/** Base64url without padding, which survives chat clients and URLs intact. */
function toBase64Url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(input: string): string | null {
  try {
    const padded = input.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/**
 * An integrity tag over the encoded payload. See {@link INTEGRITY_NOTE}.
 *
 * FNV-1a, because what this must catch is truncation and mangling by chat
 * clients, and eight hex characters of it do that while keeping the link short
 * enough that those clients do not wrap it in the first place. A cryptographic
 * digest would be longer, no more protective in a keyless setting, and would
 * invite exactly the misreading this function is named to avoid.
 */
export function sign(encoded: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < encoded.length; i++) {
    hash ^= encoded.charCodeAt(i);
    // `Math.imul` keeps this in 32-bit space; `*` would lose precision above 2^53.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** Builds the shareable link for a payload. */
export function encodeShareLink(payload: Omit<SharePayload, 'v'>): string {
  const full: SharePayload = { v: SHARE_VERSION, ...payload };
  const body = toBase64Url(JSON.stringify(full));
  return `${SHARE_SCHEME}://media/${body}.${sign(body)}`;
}

/**
 * Reads a link, refusing anything it cannot vouch for.
 *
 * Order matters: shape, then integrity, then version, then contents. A
 * truncated link from a future version should be reported as truncated, because
 * that is the one the sender can fix by sending it again.
 */
export function decodeShareLink(link: string): ShareDecodeResult {
  const trimmed = link.trim();

  /**
   * Whether this is ours is judged on the prefix alone, before anything else.
   *
   * Matching the whole shape in one pattern conflated two different answers: a
   * link truncated *inside its tag* failed the pattern and was reported as "not
   * a CloudStream link" — when it plainly is one, and the sender can fix it by
   * sending it again. Ours-or-not first, then damaged-or-not.
   */
  const prefix = `${SHARE_SCHEME}://media/`;
  if (!trimmed.toLowerCase().startsWith(prefix)) {
    return { ok: false, kind: 'malformed', reason: 'That is not a CloudStream link.' };
  }

  const match = /^([A-Za-z0-9\-_]+)\.([0-9a-f]{8})$/i.exec(trimmed.slice(prefix.length));
  if (!match) {
    return {
      ok: false,
      kind: 'corrupt',
      reason: 'This link arrived damaged — ask for it to be sent again.',
    };
  }

  const [, body, tag] = match;
  if (sign(body) !== tag.toLowerCase()) {
    return {
      ok: false,
      kind: 'corrupt',
      reason: 'This link arrived damaged — ask for it to be sent again.',
    };
  }

  const json = fromBase64Url(body);
  if (json === null) {
    return { ok: false, kind: 'corrupt', reason: 'This link could not be read.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, kind: 'corrupt', reason: 'This link could not be read.' };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, kind: 'corrupt', reason: 'This link could not be read.' };
  }
  const candidate = parsed as Partial<SharePayload>;

  if (typeof candidate.v !== 'number' || candidate.v < 1) {
    return { ok: false, kind: 'corrupt', reason: 'This link could not be read.' };
  }
  if (candidate.v > SHARE_VERSION) {
    return {
      ok: false,
      kind: 'unsupported',
      reason: 'This link was made by a newer version of CloudStream. Update to open it.',
    };
  }

  if (typeof candidate.url !== 'string' || !isShareableAddress(candidate.url)) {
    /**
     * Also the guard against a hostile link. A payload naming an `http://`
     * address would otherwise be handed to the resolver, which is the one thing
     * a link from a stranger must not be able to do.
     */
    return {
      ok: false,
      kind: 'malformed',
      reason: 'This link does not point at anything this app can open.',
    };
  }
  if (typeof candidate.title !== 'string' || candidate.title.trim() === '') {
    return { ok: false, kind: 'malformed', reason: 'This link is missing its title.' };
  }

  return { ok: true, payload: normalise(candidate as SharePayload) };
}

/**
 * Drops anything that is not the type it claims to be.
 *
 * A decoded payload is attacker-shaped JSON, so every optional field is checked
 * rather than trusted — a `season` of `"drop table"` reaches `SourceQuery` and
 * then a provider, and a `poster` that is not a string reaches an `<img>`.
 * Unknown fields are dropped entirely, which is also what makes a version-1 app
 * safe to point at a version-1 link written by a later build.
 */
function normalise(payload: SharePayload): SharePayload {
  const text = (value: unknown, max = 300): string | undefined =>
    typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, max) : undefined;
  const count = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 10_000
      ? Math.floor(value)
      : undefined;
  const types: ShareMediaType[] = ['movie', 'series', 'anime', 'other'];

  return {
    v: payload.v,
    url: payload.url.trim(),
    id: text(payload.id, 64),
    title: payload.title.trim().slice(0, 300),
    originalTitle: text(payload.originalTitle),
    year: count(payload.year),
    type: types.includes(payload.type as ShareMediaType) ? payload.type : undefined,
    season: count(payload.season),
    episode: count(payload.episode),
    // Display-only, and still restricted to image schemes the app already
    // renders: a `javascript:` or `data:` poster is an attack, not a picture.
    poster: /^https?:\/\//i.test(payload.poster ?? '') ? text(payload.poster, 600) : undefined,
    plot: text(payload.plot, 900),
    provider: text(payload.provider, 120),
    repository: text(payload.repository, 120),
    language: text(payload.language, 24),
    quality: text(payload.quality, 16),
  };
}

/**
 * A one-line description for the share sheet and for the page that opens.
 *
 * Built here rather than at each call site so "Reacher — S4E2 (2026)" reads the
 * same in the share dialog, the recipient's banner and the clipboard toast.
 */
export function describeShare(payload: Pick<SharePayload, 'title' | 'year' | 'season' | 'episode'>): string {
  const episode =
    payload.season !== undefined && payload.episode !== undefined
      ? ` — S${payload.season}E${payload.episode}`
      : '';
  const year = payload.year ? ` (${payload.year})` : '';
  return `${payload.title}${episode}${year}`;
}
