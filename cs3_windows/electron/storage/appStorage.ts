/**
 * Where CS3 keeps things on disk — the one source of truth.
 *
 *   <userData>/                 persistent: datastore, library, history, profiles,
 *   │                            extensions, runtime copy, logs, backups (unchanged)
 *   ├── cache/                  re-creatable; anything here may be deleted
 *   │   ├── torrent-pieces/     streaming piece cache (unless the viewer chose a folder)
 *   │   ├── torrent-state/      .torrent metadata and DHT contacts
 *   │   └── cs3-*.json          catalogue, details, metadata, ratings … caches
 *   └── temp/                   short-lived working files
 *       ├── session-<t>-<pid>/  this launch's files; removed on quit
 *       └── jvm/                the extension runtime's java.io.tmpdir
 *   Downloads                   the viewer's chosen folder — never cleaned
 *
 * `userData` is Electron's per-platform application-data directory (beside the
 * exe for the portable build), so nothing here names `%TEMP%`, a drive letter
 * or a home-directory layout. The root is passed in and this module does not
 * import `electron`, which is what lets its tests run under Node.
 *
 * **Ownership is written down, never inferred from a name.** Every directory
 * this module creates under `cache/` and `temp/` carries a `.cs3-owned.json`
 * marker, and cleanup (`storageCleanup.ts`) only ever deletes inside a
 * directory that has one. Something it did not create — a file a person put
 * there, a folder from another program — is left alone.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const OWNER_MARKER = '.cs3-owned.json';
export const OWNER_APP = 'cloudstream-desktop';

export type MarkerKind = 'cache-root' | 'temp-root' | 'temp-session' | 'temp-area';

export interface OwnerMarker {
  app: typeof OWNER_APP;
  kind: MarkerKind;
  createdAt: number;
  /** For a session: the process that owns it. Cleanup leaves it while that process lives. */
  pid?: number;
}

/** A re-creatable cache the storage report and cleanup know about. */
export interface CacheArea {
  id: string;
  label: string;
  /** Absolute. A directory, or a single file for a self-managed JSON store. */
  path: string;
  /**
   * `dir`: swept by age/size, entry by entry. `self-managed`: a store that keeps
   * its own expiry (TTL per entry, in memory) — reported and cleared through its
   * own `clear`, never swept from under it.
   */
  kind: 'dir' | 'self-managed';
  /** Entries untouched for longer than this are removed by the automatic sweep. */
  maxAgeMs?: number;
  /** After the age sweep, the oldest entries go until the area fits. */
  maxBytes?: number;
  /** An entry in use right now (a torrent being streamed). Never removed while true. */
  isActive?: (entryPath: string) => boolean;
  /** A safe way to empty it on request — the owning service's own clear. */
  clear?: () => Promise<unknown> | unknown;
  /** False when the viewer pointed it outside `cache/`: shown, never swept automatically. */
  managed: boolean;
}

export interface AppStorageOptions {
  /** The application-data directory (`app.getPath('userData')`). */
  root: string;
  /** The viewer's download folder, resolved when asked (it is a setting). */
  downloads?: () => string;
  pid?: number;
  now?: () => number;
}

export class AppStorage {
  readonly root: string;
  readonly dataDir: string;
  readonly cacheRoot: string;
  readonly tempRoot: string;
  readonly logsDir: string;

  private readonly downloads: () => string;
  private readonly pid: number;
  private readonly now: () => number;
  private readonly startedAt: number;
  private session: string | null = null;
  private readonly areas = new Map<string, CacheArea>();
  private tempCounter = 0;

  constructor(options: AppStorageOptions) {
    this.root = path.resolve(options.root);
    this.dataDir = this.root;
    this.cacheRoot = path.join(this.root, 'cache');
    this.tempRoot = path.join(this.root, 'temp');
    this.logsDir = path.join(this.root, 'logs');
    this.downloads = options.downloads ?? (() => '');
    this.pid = options.pid ?? process.pid;
    this.now = options.now ?? Date.now;
    this.startedAt = this.now();
  }

  get processId(): number {
    return this.pid;
  }

  /** The cache root, created and marked on first use. */
  cacheDir(...segments: string[]): string {
    ensureOwnedDir(this.cacheRoot, { kind: 'cache-root' }, this.now);
    const dir = path.join(this.cacheRoot, ...segments);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  /** A file path directly under the cache root (the directory is created; the file is not). */
  cacheFile(name: string): string {
    return path.join(this.cacheDir(), name);
  }

  /**
   * This launch's temp directory.
   *
   * One per process rather than one per operation: an operation that needs a
   * file asks {@link tempFile} for a unique name inside it. Removed on quit
   * ({@link disposeSession}); a crash leaves it behind with a dead `pid` in its
   * marker, which is how the next launch knows it may go.
   */
  sessionTempDir(): string {
    if (this.session && fs.existsSync(this.session)) return this.session;
    ensureOwnedDir(this.tempRoot, { kind: 'temp-root' }, this.now);
    const dir = path.join(this.tempRoot, `session-${this.startedAt.toString(36)}-${this.pid}`);
    ensureOwnedDir(dir, { kind: 'temp-session', pid: this.pid }, this.now);
    this.session = dir;
    return dir;
  }

  /** A unique path for a short-lived file. The caller writes it and removes it when done. */
  tempFile(prefix: string, extension = ''): string {
    this.tempCounter += 1;
    const safePrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) || 'tmp';
    const ext = extension && !extension.startsWith('.') ? `.${extension}` : extension;
    const stamp = `${this.now().toString(36)}-${this.tempCounter}`;
    return path.join(this.sessionTempDir(), `${safePrefix}-${stamp}${ext}`);
  }

  /**
   * A temp directory that outlives one launch, for a tool that wants a stable
   * place (the JVM's `java.io.tmpdir`). Swept by age, never wholesale.
   */
  tempArea(name: string): string {
    ensureOwnedDir(this.tempRoot, { kind: 'temp-root' }, this.now);
    const dir = path.join(this.tempRoot, name);
    ensureOwnedDir(dir, { kind: 'temp-area' }, this.now);
    return dir;
  }

  /** Removes this launch's temp directory. Locked leftovers are swept next launch. */
  disposeSession(): void {
    if (!this.session) return;
    try {
      fs.rmSync(this.session, { recursive: true, force: true, maxRetries: 2 });
    } catch {
      // Something still holds a file. The marker names a process that will be
      // dead next launch, and the sweep then removes it.
    }
    this.session = null;
  }

  registerCacheArea(area: Omit<CacheArea, 'managed'>): CacheArea {
    const registered: CacheArea = { ...area, managed: isInside(this.cacheRoot, area.path) };
    this.areas.set(area.id, registered);
    return registered;
  }

  cacheAreas(): CacheArea[] {
    return [...this.areas.values()];
  }

  cacheArea(id: string): CacheArea | undefined {
    return this.areas.get(id);
  }

  downloadsDir(): string {
    try {
      return this.downloads();
    } catch {
      return '';
    }
  }

  /** The four answers a developer asks first. */
  locations(): { data: string; cache: string; temp: string; downloads: string; logs: string } {
    return {
      data: this.dataDir,
      cache: this.cacheRoot,
      temp: this.tempRoot,
      downloads: this.downloadsDir(),
      logs: this.logsDir,
    };
  }

  /**
   * Moves a cache file written by an older build from the data directory into
   * `cache/`, once. Only when the old one exists and the new one does not;
   * anything else — both present, a failed rename — leaves the old file where
   * it was rather than guessing which copy is right.
   */
  migrateIntoCache(legacyPath: string, name = path.basename(legacyPath)): string {
    const target = this.cacheFile(name);
    migratePath(legacyPath, target);
    return target;
  }
}

/** Moves `from` to `to` when only `from` exists. Returns whether it moved. */
export function migratePath(from: string, to: string): boolean {
  try {
    if (!fs.existsSync(from) || fs.existsSync(to)) return false;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
    return true;
  } catch {
    // A rename across volumes or a locked file: the old copy stays and the
    // service starts a fresh cache. Nothing is lost that cannot be re-fetched.
    return false;
  }
}

/** Whether `child` is `parent` or inside it, by path — never by name. */
export function isInside(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function readMarker(dir: string): OwnerMarker | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, OWNER_MARKER), 'utf8')) as OwnerMarker;
    return parsed?.app === OWNER_APP && typeof parsed.kind === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

function ensureOwnedDir(
  dir: string,
  marker: Omit<OwnerMarker, 'app' | 'createdAt'>,
  now: () => number
): void {
  fs.mkdirSync(dir, { recursive: true });
  if (readMarker(dir)) return;
  const record: OwnerMarker = { app: OWNER_APP, createdAt: now(), ...marker };
  try {
    fs.writeFileSync(path.join(dir, OWNER_MARKER), JSON.stringify(record));
  } catch {
    // Without a marker the directory is simply never cleaned — the safe failure.
  }
}

// --- the process-wide instance ---------------------------------------------

let configured: AppStorage | null = null;

/**
 * Set once, first thing in `main.ts`, before any service that stores
 * something is constructed. Services ask {@link appStorage} rather than
 * resolving paths of their own.
 */
export function configureAppStorage(options: AppStorageOptions): AppStorage {
  configured = new AppStorage(options);
  return configured;
}

/**
 * The configured storage. Unconfigured — only ever a test constructing a
 * service on its own — it is a per-process directory under the system temp
 * folder, so a test run never writes into the checkout.
 */
export function appStorage(): AppStorage {
  if (!configured) {
    configured = new AppStorage({ root: path.join(os.tmpdir(), `cs3-unconfigured-${process.pid}`) });
  }
  return configured;
}

/** What `storage:getReport` answers — the Storage panel's whole state. */
export interface StorageReport {
  locations: { data: string; cache: string; temp: string; downloads: string; logs: string };
  areas: Array<{
    id: string;
    label: string;
    path: string;
    kind: CacheArea['kind'];
    managed: boolean;
    clearable: boolean;
    bytes: number;
    maxAgeDays?: number;
    maxBytes?: number;
  }>;
  tempBytes: number;
  /** Folders earlier builds left in the system temp directory. */
  legacy: Array<{ path: string; bytes: number }>;
}
