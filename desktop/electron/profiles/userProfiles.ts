import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import {
  MAX_PROFILES,
  PROFILE_AVATAR_IDS,
  PROFILE_NAME_MAX,
  PROFILE_SECRET_MAX,
  PROFILE_SECRET_MIN,
  type ProfileActionResult,
  type ProfileAvatarId,
  type ProfileDraft,
  type ProfileFailureReason,
  type UserProfile,
  type UserProfilesState,
} from '../../src/types/profiles.ts';
import { DEFAULT_PROFILE_ID, LOCKED_PROFILE_ID, setActiveProfileId } from './profileContext.ts';

/**
 * The viewer profiles on this installation, and which one is in use.
 *
 * Optional by construction: every installation has the default profile, it
 * opens straight into it, and nothing here asks a single-profile viewer for a
 * name, a choice or a PIN. A lock exists only when somebody set one.
 *
 * A lock is a privacy screen, not a security boundary — the datastore on disk
 * is readable by anyone who can read the user's files, and the UI says
 * "lock", never "encrypt". What it does guarantee: a locked profile cannot be
 * entered, edited, copied or deleted from the app without its secret, and
 * while one is waiting for its PIN the app reads and records nothing of it
 * (`LOCKED_PROFILE_ID`). The secret is stored as a salted scrypt hash and
 * never leaves the main process.
 */

const PROFILES_KEY = 'cs3_user_profiles';
const ACTIVE_KEY = 'cs3_active_user_profile';

/** Installation keys this service owns — excluded from backups (they hold lock hashes). */
export const USER_PROFILE_KEYS = [PROFILES_KEY, ACTIVE_KEY] as const;

interface StoredLock {
  algorithm: 'scrypt';
  salt: string;
  hash: string;
  cost: number;
}

interface StoredProfile {
  id: string;
  name: string;
  avatar: ProfileAvatarId;
  createdAt: number;
  lock?: StoredLock;
}

interface StoredState {
  version: 1;
  profiles: StoredProfile[];
}

/** The accessors this service needs; its keys are installation keys, so any datastore view answers them. */
export interface ProfileStorage {
  getObject<T>(key: string, defaultValue?: T | null): T | null;
  setObject<T>(key: string, value: T): void;
  getString(key: string, defaultValue?: string): string;
  setString(key: string, value: string): void;
}

export interface UserProfileDeps {
  storage: ProfileStorage;
  /**
   * Runs before the active profile changes: stop playback, flush pending
   * writes. Awaited, so nothing the previous profile started is still writing
   * when the next one becomes active.
   */
  beforeSwitch?: () => Promise<void> | void;
  /** Durability point after a lock changes; a lost lock is worse than a lost preference. */
  flush?: () => Promise<void> | void;
  /** Removes everything a deleted profile stored. */
  onDeleted?: (profileId: string) => void;
  /** Copies preferences onto a new duplicate. */
  onDuplicated?: (from: string, to: string) => void;
  now?: () => number;
}

const SCRYPT_COST = 16384;
const SCRYPT_KEY_LENGTH = 32;
const DEFAULT_AVATAR: ProfileAvatarId = 'smile';
const DEFAULT_NAME = 'Default';

/**
 * Wrong guesses allowed before the profile pauses, and the first pause.
 * Each further run of failures doubles it, to {@link MAX_BACKOFF_MS}.
 */
const FREE_ATTEMPTS = 5;
const FIRST_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 5 * 60_000;

function derive(secret: string, salt: Buffer, cost: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(secret.normalize('NFC'), salt, SCRYPT_KEY_LENGTH, { N: cost, r: 8, p: 1 }, (error, key) =>
      error ? reject(error) : resolve(key)
    );
  });
}

export async function hashSecret(secret: string): Promise<StoredLock> {
  const salt = randomBytes(16);
  const hash = await derive(secret, salt, SCRYPT_COST);
  return { algorithm: 'scrypt', salt: salt.toString('base64'), hash: hash.toString('base64'), cost: SCRYPT_COST };
}

export async function secretMatches(secret: string, lock: StoredLock): Promise<boolean> {
  const expected = Buffer.from(lock.hash, 'base64');
  const actual = await derive(secret, Buffer.from(lock.salt, 'base64'), lock.cost || SCRYPT_COST);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function validateSecret(secret: unknown): string | null {
  if (typeof secret !== 'string') return 'Enter a PIN or password.';
  if (secret.length < PROFILE_SECRET_MIN) return `Use at least ${PROFILE_SECRET_MIN} characters.`;
  if (secret.length > PROFILE_SECRET_MAX) return `Use at most ${PROFILE_SECRET_MAX} characters.`;
  return null;
}

function cleanName(name: unknown): string {
  return typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, PROFILE_NAME_MAX) : '';
}

function isAvatar(value: unknown): value is ProfileAvatarId {
  return typeof value === 'string' && (PROFILE_AVATAR_IDS as readonly string[]).includes(value);
}

function failure(reason: ProfileFailureReason, error: string, retryAfterMs?: number): ProfileActionResult {
  return retryAfterMs === undefined ? { ok: false, reason, error } : { ok: false, reason, error, retryAfterMs };
}

export class UserProfileService {
  private readonly deps: UserProfileDeps;
  private readonly now: () => number;
  private profiles: StoredProfile[] = [];
  /** The profile the window shows, or the locked one it is waiting on. */
  private selectedId = DEFAULT_PROFILE_ID;
  private gated = false;
  private readonly attempts = new Map<string, { failures: number; pausedUntil: number; backoff: number }>();
  private readonly listeners = new Set<(state: UserProfilesState) => void>();
  /** One switch at a time: two overlapping ones could each stop the other's playback. */
  private switching: Promise<unknown> = Promise.resolve();

  constructor(deps: UserProfileDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
  }

  /**
   * Loads the profiles and opens the one last used.
   *
   * On an install that predates profiles this creates the default profile and
   * nothing else — its data is already in place (`profileKeys.ts`), so there is
   * nothing to move, and running this again finds it there and changes nothing.
   * A last-used profile that is locked opens gated, never unlocked.
   */
  public initialise(): UserProfilesState {
    const stored = this.deps.storage.getObject<StoredState>(PROFILES_KEY, null);
    const rows = Array.isArray(stored?.profiles) ? stored.profiles.filter((row) => row && typeof row.id === 'string') : [];
    const seen = new Set<string>();
    this.profiles = rows
      .filter((row) => (seen.has(row.id) ? false : (seen.add(row.id), true)))
      .map((row) => ({
        id: row.id,
        name: cleanName(row.name) || (row.id === DEFAULT_PROFILE_ID ? DEFAULT_NAME : 'Profile'),
        avatar: isAvatar(row.avatar) ? row.avatar : DEFAULT_AVATAR,
        createdAt: Number.isFinite(row.createdAt) ? row.createdAt : this.now(),
        ...(row.lock?.hash && row.lock.salt ? { lock: row.lock } : {}),
      }));
    if (!this.profiles.some((profile) => profile.id === DEFAULT_PROFILE_ID)) {
      this.profiles.unshift({ id: DEFAULT_PROFILE_ID, name: DEFAULT_NAME, avatar: DEFAULT_AVATAR, createdAt: this.now() });
    }
    if (!stored || this.profiles.length !== rows.length) this.persistProfiles();

    const last = this.deps.storage.getString(ACTIVE_KEY, DEFAULT_PROFILE_ID);
    const opening = this.find(last) ?? this.find(DEFAULT_PROFILE_ID)!;
    this.selectedId = opening.id;
    this.gated = Boolean(opening.lock);
    setActiveProfileId(this.gated ? LOCKED_PROFILE_ID : opening.id);
    return this.state();
  }

  public state(): UserProfilesState {
    return {
      profiles: this.profiles.map((profile) => this.summary(profile)),
      activeId: this.selectedId,
      gated: this.gated,
    };
  }

  public onChange(listener: (state: UserProfilesState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Checks a secret without switching — so the window can tear down only once it is known to be right. */
  public async verify(profileId: string, secret: string): Promise<ProfileActionResult> {
    const profile = this.find(profileId);
    if (!profile) return failure('not-found', 'That profile no longer exists.');
    const denied = await this.checkSecret(profile, secret);
    return denied ?? { ok: true, state: this.state(), profileId };
  }

  public activate(profileId: string, secret?: string): Promise<ProfileActionResult> {
    return this.serialised(async () => {
      const profile = this.find(profileId);
      if (!profile) return failure('not-found', 'That profile no longer exists.');
      if (profile.id === this.selectedId && !this.gated) return { ok: true, state: this.state(), profileId };
      if (profile.lock) {
        const denied = await this.checkSecret(profile, secret);
        if (denied) return denied;
      }
      await this.switchTo(profile.id, false);
      return { ok: true, state: this.state(), profileId };
    });
  }

  public async create(draft: ProfileDraft): Promise<ProfileActionResult> {
    if (this.profiles.length >= MAX_PROFILES) {
      return failure('invalid', `An installation can have up to ${MAX_PROFILES} profiles.`);
    }
    const name = cleanName(draft?.name);
    const invalid = this.nameProblem(name);
    if (invalid) return failure('invalid', invalid);
    let lock: StoredLock | undefined;
    if (draft.secret !== undefined && draft.secret !== '') {
      const problem = validateSecret(draft.secret);
      if (problem) return failure('invalid', problem);
      lock = await hashSecret(draft.secret);
    }
    const profile: StoredProfile = {
      id: this.newId(),
      name,
      avatar: isAvatar(draft.avatar) ? draft.avatar : DEFAULT_AVATAR,
      createdAt: this.now(),
      ...(lock ? { lock } : {}),
    };
    this.profiles.push(profile);
    this.persistProfiles();
    if (lock) await this.deps.flush?.();
    this.emit();
    return { ok: true, state: this.state(), profileId: profile.id };
  }

  public async update(
    profileId: string,
    patch: { name?: string; avatar?: ProfileAvatarId },
    secret?: string
  ): Promise<ProfileActionResult> {
    const profile = this.find(profileId);
    if (!profile) return failure('not-found', 'That profile no longer exists.');
    const denied = await this.authorise(profile, secret);
    if (denied) return denied;
    if (patch.name !== undefined) {
      const name = cleanName(patch.name);
      const invalid = this.nameProblem(name, profile.id);
      if (invalid) return failure('invalid', invalid);
      profile.name = name;
    }
    if (patch.avatar !== undefined) {
      if (!isAvatar(patch.avatar)) return failure('invalid', 'Choose one of the avatars.');
      profile.avatar = patch.avatar;
    }
    this.persistProfiles();
    this.emit();
    return { ok: true, state: this.state(), profileId };
  }

  /** Sets or changes a lock. Changing an existing one needs the current secret. */
  public async setLock(profileId: string, secret: string, currentSecret?: string): Promise<ProfileActionResult> {
    const profile = this.find(profileId);
    if (!profile) return failure('not-found', 'That profile no longer exists.');
    if (profile.lock) {
      const denied = await this.checkSecret(profile, currentSecret);
      if (denied) return denied;
    } else {
      const denied = await this.authorise(profile, currentSecret);
      if (denied) return denied;
    }
    const problem = validateSecret(secret);
    if (problem) return failure('invalid', problem);
    profile.lock = await hashSecret(secret);
    this.persistProfiles();
    await this.deps.flush?.();
    this.emit();
    return { ok: true, state: this.state(), profileId };
  }

  public async removeLock(profileId: string, currentSecret: string): Promise<ProfileActionResult> {
    const profile = this.find(profileId);
    if (!profile) return failure('not-found', 'That profile no longer exists.');
    if (!profile.lock) return { ok: true, state: this.state(), profileId };
    const denied = await this.checkSecret(profile, currentSecret);
    if (denied) return denied;
    delete profile.lock;
    this.persistProfiles();
    await this.deps.flush?.();
    this.emit();
    return { ok: true, state: this.state(), profileId };
  }

  /**
   * A new profile with this one's preferences.
   *
   * Only how the app is set up is copied — player, subtitles, sidebar, search
   * set-ups (`PREFERENCE_KEYS`). What somebody watched, saved and searched is
   * theirs, and the lock is not copied either.
   */
  public async duplicate(profileId: string, secret?: string): Promise<ProfileActionResult> {
    const source = this.find(profileId);
    if (!source) return failure('not-found', 'That profile no longer exists.');
    if (this.profiles.length >= MAX_PROFILES) {
      return failure('invalid', `An installation can have up to ${MAX_PROFILES} profiles.`);
    }
    const denied = await this.authorise(source, secret);
    if (denied) return denied;
    const copy: StoredProfile = {
      id: this.newId(),
      name: this.copyName(source.name),
      avatar: source.avatar,
      createdAt: this.now(),
    };
    this.profiles.push(copy);
    this.deps.onDuplicated?.(source.id, copy.id);
    this.persistProfiles();
    this.emit();
    return { ok: true, state: this.state(), profileId: copy.id };
  }

  /**
   * Deletes a profile and everything it stored.
   *
   * The default profile cannot be deleted — there is always somewhere to open
   * into. Deleting the profile in use moves the window to the default one,
   * gated if that one is locked.
   */
  public remove(profileId: string, secret?: string): Promise<ProfileActionResult> {
    return this.serialised(async () => {
      const profile = this.find(profileId);
      if (!profile) return failure('not-found', 'That profile no longer exists.');
      if (profile.id === DEFAULT_PROFILE_ID) return failure('invalid', 'The default profile cannot be deleted.');
      const denied = await this.authorise(profile, secret);
      if (denied) return denied;
      if (profile.id === this.selectedId) {
        const fallback = this.find(DEFAULT_PROFILE_ID)!;
        await this.switchTo(fallback.id, Boolean(fallback.lock));
      }
      this.profiles = this.profiles.filter((entry) => entry.id !== profile.id);
      this.attempts.delete(profile.id);
      this.persistProfiles();
      this.deps.onDeleted?.(profile.id);
      this.emit();
      return { ok: true, state: this.state(), profileId };
    });
  }

  // --- internals -------------------------------------------------------------

  private summary(profile: StoredProfile): UserProfile {
    return {
      id: profile.id,
      name: profile.name,
      avatar: profile.avatar,
      isDefault: profile.id === DEFAULT_PROFILE_ID,
      locked: Boolean(profile.lock),
      createdAt: profile.createdAt,
    };
  }

  private find(profileId: string): StoredProfile | undefined {
    return this.profiles.find((profile) => profile.id === profileId);
  }

  /** The profile in use may be changed freely; any other locked one needs its secret. */
  private async authorise(profile: StoredProfile, secret: string | undefined): Promise<ProfileActionResult | null> {
    if (!profile.lock) return null;
    if (profile.id === this.selectedId && !this.gated) return null;
    return this.checkSecret(profile, secret);
  }

  private async checkSecret(profile: StoredProfile, secret: string | undefined): Promise<ProfileActionResult | null> {
    if (!profile.lock) return null;
    if (typeof secret !== 'string' || secret === '') {
      return failure('locked', `${profile.name} is locked. Enter its PIN or password.`);
    }
    const record = this.attempts.get(profile.id) ?? { failures: 0, pausedUntil: 0, backoff: FIRST_BACKOFF_MS };
    const wait = record.pausedUntil - this.now();
    if (wait > 0) {
      return failure('throttled', `Too many attempts. Try again in ${Math.ceil(wait / 1000)} seconds.`, wait);
    }
    if (await secretMatches(secret, profile.lock)) {
      this.attempts.delete(profile.id);
      return null;
    }
    record.failures += 1;
    if (record.failures >= FREE_ATTEMPTS) {
      record.pausedUntil = this.now() + record.backoff;
      record.backoff = Math.min(record.backoff * 2, MAX_BACKOFF_MS);
      record.failures = 0;
    }
    this.attempts.set(profile.id, record);
    return failure('wrong-secret', 'That PIN or password is not right.');
  }

  private async switchTo(profileId: string, gated: boolean): Promise<void> {
    await this.deps.beforeSwitch?.();
    this.selectedId = profileId;
    this.gated = gated;
    setActiveProfileId(gated ? LOCKED_PROFILE_ID : profileId);
    this.deps.storage.setString(ACTIVE_KEY, profileId);
    this.emit();
  }

  private serialised<T>(work: () => Promise<T>): Promise<T> {
    const run = this.switching.then(work, work);
    this.switching = run.catch(() => undefined);
    return run;
  }

  private nameProblem(name: string, exceptId?: string): string | null {
    if (!name) return 'Give the profile a name.';
    const folded = name.toLocaleLowerCase();
    if (this.profiles.some((profile) => profile.id !== exceptId && profile.name.toLocaleLowerCase() === folded)) {
      return 'Another profile already has that name.';
    }
    return null;
  }

  private copyName(name: string): string {
    const base = `${name} copy`.slice(0, PROFILE_NAME_MAX);
    for (let n = 1; ; n++) {
      const candidate = n === 1 ? base : `${base.slice(0, PROFILE_NAME_MAX - String(n).length - 1)} ${n}`;
      if (!this.nameProblem(candidate)) return candidate;
    }
  }

  private newId(): string {
    let id: string;
    do id = `p${randomBytes(5).toString('hex')}`;
    while (this.find(id));
    return id;
  }

  private persistProfiles(): void {
    const stored: StoredState = { version: 1, profiles: this.profiles };
    this.deps.storage.setObject(PROFILES_KEY, stored);
  }

  private emit(): void {
    const state = this.state();
    for (const listener of this.listeners) listener(state);
  }
}
