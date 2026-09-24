import fs from 'fs';
import path from 'path';
import { app } from 'electron';

export interface DatastoreBucket {
  _Bool?: Record<string, boolean>;
  _Int?: Record<string, number>;
  _String?: Record<string, string>;
  _Float?: Record<string, number>;
  _Long?: Record<string, number>;
  _StringSet?: Record<string, string[]>;
}

export interface DatastoreBackup {
  datastore: DatastoreBucket;
  settings: DatastoreBucket;
  version?: number;
  exportTimestamp?: number;
}

export interface ImportBackupResult {
  success: boolean;
  importedKeysCount: number;
  report: string[];
}

/**
 * How long a change waits for the next one before the file is written.
 *
 * Long enough to collapse a burst — a search caching thirty results, a download
 * ticking progress — and short enough that a user who changes a setting and
 * pulls the plug loses nothing they would notice.
 */
const SAVE_DEBOUNCE_MS = 250;

export class DatastoreManager {
  private dataDir: string;
  private dbFile: string;
  private backupSnapshotFile: string;
  private data: DatastoreBackup;
  private dirty = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private writing: Promise<void> = Promise.resolve();

  // Non-transferable Android key grammar patterns (tokens, ephemeral state, device IDs)
  private nonTransferableKeyPatterns: RegExp[] = [
    /token/i,
    /session_id/i,
    /device_id/i,
    /auth_bearer/i,
    /ephemeral_/i,
    /cache_path/i,
    // Paths on this machine awaiting deletion; on another machine they name
    // nothing, or something that is not ours to delete.
    /displaced_archives/i
  ];

  constructor() {
    this.dataDir = app ? app.getPath('userData') : path.join(process.cwd(), 'data');
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    this.dbFile = path.join(this.dataDir, 'cs3_datastore.json');
    this.backupSnapshotFile = path.join(this.dataDir, 'cs3_datastore_snapshot.json');
    this.data = this.loadFromFile();
  }

  private loadFromFile(): DatastoreBackup {
    try {
      if (fs.existsSync(this.dbFile)) {
        const raw = fs.readFileSync(this.dbFile, 'utf-8');
        return JSON.parse(raw);
      }
    } catch (e) {
      console.error('Failed to read datastore file:', e);
    }
    return {
      datastore: { _Bool: {}, _Int: {}, _String: {}, _Float: {}, _Long: {}, _StringSet: {} },
      settings: { _Bool: {}, _Int: {}, _String: {}, _Float: {}, _Long: {}, _StringSet: {} },
      version: 1
    };
  }

  /**
   * Marks the store dirty. The bytes reach disk shortly afterwards.
   *
   * This used to be `writeFileSync(JSON.stringify(everything))`, called from
   * **every setter**. Measured on the development install — 7.10 MB across 52
   * keys, of which `source_cache_v1` alone is 3.18 MB and
   * `media_history_events_v1` 2.15 MB — that is ~29ms of serialisation plus the
   * write, on the main thread, for a single `setBool`. A search that caches its
   * results, a download that ticks progress, or a window drag that settles all
   * paid it, and several in a row is a visible freeze.
   *
   * Two changes, and the second is the one that matters:
   *
   * **Coalesced.** A burst of setters costs one write of the final state rather
   * than one write each. Same argument as `util/jsonFileStore.ts`, which five
   * other stores in this codebase already went through — this was simply the
   * largest store and the one that never did.
   *
   * **Asynchronous, and atomic.** Written to a sibling temp file and renamed,
   * because a 7 MB write interrupted by a crash or a power loss previously left
   * a truncated file, and a truncated datastore is every preference, the whole
   * library and the watch history. `rename` within a directory is atomic on
   * both NTFS and POSIX, so a reader sees the old file or the new one.
   *
   * Durability points call {@link flush} explicitly: a backup, an import, and
   * `before-quit`. Everything else is a cache or a preference, for which losing
   * the last {@link SAVE_DEBOUNCE_MS} on a hard kill is the right trade.
   */
  public save(): void {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.writeNow();
    }, SAVE_DEBOUNCE_MS);
    // A pending write must never be the reason the process stays alive; quit
    // flushes explicitly instead.
    this.saveTimer.unref?.();
  }

  /**
   * Writes any pending change and waits for it.
   *
   * Awaits an in-flight write before starting its own, or two overlapping
   * renames onto one path race and the loser's bytes are the ones that survive.
   */
  public async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.writing;
    if (this.dirty) await this.writeNow();
  }

  /**
   * The last-resort write, for paths that cannot await.
   *
   * Only `before-quit`'s final teardown and the snapshot/import routines reach
   * this. It is the old behaviour, deliberately — at that point the process is
   * going away and a blocked main thread costs nothing.
   */
  public flushSync(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (!this.dirty) return;
    try {
      const temp = `${this.dbFile}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(this.data, null, 2), 'utf-8');
      fs.renameSync(temp, this.dbFile);
      this.dirty = false;
    } catch (e) {
      console.error('Failed to save datastore:', e);
    }
  }

  private async writeNow(): Promise<void> {
    await this.writing;
    if (!this.dirty) return;
    // Snapshotted before the await, so a setter running while the write is in
    // flight marks the store dirty again rather than having its value silently
    // folded into a write that had already serialised.
    const payload = JSON.stringify(this.data, null, 2);
    this.dirty = false;
    const temp = `${this.dbFile}.tmp`;
    this.writing = (async () => {
      try {
        await fs.promises.writeFile(temp, payload, 'utf-8');
        await fs.promises.rename(temp, this.dbFile);
      } catch (e) {
        // Put the flag back: the state in memory is still unwritten, and the
        // next setter should try again rather than assume this succeeded.
        this.dirty = true;
        console.error('Failed to save datastore:', e);
      }
    })();
    await this.writing;
  }

  public createSnapshot(): void {
    try {
      fs.writeFileSync(this.backupSnapshotFile, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (e) {
      console.error('Failed to create datastore snapshot:', e);
    }
  }

  public rollbackSnapshot(): boolean {
    try {
      if (fs.existsSync(this.backupSnapshotFile)) {
        const raw = fs.readFileSync(this.backupSnapshotFile, 'utf-8');
        this.data = JSON.parse(raw);
        // Durable immediately: this is the recovery path from a failed import,
        // and leaving the rescued state only in memory means a crash in the
        // next 250ms loses the thing that was just rescued.
        this.save();
        this.flushSync();
        return true;
      }
    } catch (e) {
      console.error('Failed to rollback datastore snapshot:', e);
    }
    return false;
  }

  private isKeyTransferable(key: string): boolean {
    return !this.nonTransferableKeyPatterns.some((pattern) => pattern.test(key));
  }

  // --- Key Value Getter/Setters ---

  public setString(key: string, value: string, isSetting = false): void {
    const target = isSetting ? this.data.settings : this.data.datastore;
    if (!target._String) target._String = {};
    target._String[key] = value;
    this.save();
  }

  public getString(key: string, defaultValue = '', isSetting = false): string {
    const target = isSetting ? this.data.settings : this.data.datastore;
    if (target._String && target._String[key] !== undefined) return target._String[key];
    if (target._Bool && target._Bool[key] !== undefined) return String(target._Bool[key]);
    return defaultValue;
  }

  public setBool(key: string, value: boolean, isSetting = false): void {
    const target = isSetting ? this.data.settings : this.data.datastore;
    if (!target._Bool) target._Bool = {};
    target._Bool[key] = value;
    this.save();
  }

  public getBool(key: string, defaultValue = false, isSetting = false): boolean {
    const target = isSetting ? this.data.settings : this.data.datastore;
    return target._Bool?.[key] ?? defaultValue;
  }

  public setBoolean(key: string, value: boolean, isSetting = false): void {
    this.setBool(key, value, isSetting);
  }

  public getBoolean(key: string, defaultValue = false, isSetting = false): boolean {
    return this.getBool(key, defaultValue, isSetting);
  }

  public setInt(key: string, value: number, isSetting = false): void {
    const target = isSetting ? this.data.settings : this.data.datastore;
    if (!target._Int) target._Int = {};
    target._Int[key] = Math.floor(value);
    this.save();
  }

  public getInt(key: string, defaultValue = 0, isSetting = false): number {
    const target = isSetting ? this.data.settings : this.data.datastore;
    return target._Int?.[key] ?? defaultValue;
  }

  public setObject<T>(key: string, value: T, isSetting = false): void {
    this.setString(key, JSON.stringify(value), isSetting);
  }

  public getObject<T>(key: string, defaultValue: T | null = null, isSetting = false): T | null {
    const raw = this.getString(key, '', isSetting);
    if (!raw) return defaultValue;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return defaultValue;
    }
  }

  // --- Robust Key-Grammar Android Backup Import & Export ---

  public importBackupFile(filePath: string): ImportBackupResult {
    const report: string[] = [];
    let importedKeysCount = 0;

    try {
      this.createSnapshot();

      const content = fs.readFileSync(filePath, 'utf-8');
      const backupData = JSON.parse(content) as DatastoreBackup;

      report.push(`Starting import from: ${path.basename(filePath)}`);

      const mergeBucket = (source?: DatastoreBucket, target?: DatastoreBucket, bucketName = 'datastore') => {
        if (!source || !target) return;

        // Process 6 canonical Android CS3 data buckets
        const types: Array<keyof DatastoreBucket> = ['_Bool', '_Int', '_String', '_Float', '_Long', '_StringSet'];

        for (const t of types) {
          const sObj = source[t] as Record<string, any> | undefined;
          if (sObj) {
            if (!target[t]) target[t] = {} as any;
            const tObj = target[t] as Record<string, any>;

            for (const [key, val] of Object.entries(sObj)) {
              if (this.isKeyTransferable(key)) {
                tObj[key] = val;
                importedKeysCount++;
              } else {
                report.push(`Skipped non-transferable key [${bucketName}.${t}]: ${key}`);
              }
            }
          }
        }
      };

      mergeBucket(backupData.datastore, this.data.datastore, 'datastore');
      mergeBucket(backupData.settings, this.data.settings, 'settings');

      this.save();
      this.flushSync();
      report.push(`Successfully imported ${importedKeysCount} keys into local Datastore.`);

      return {
        success: true,
        importedKeysCount,
        report
      };
    } catch (e: any) {
      this.rollbackSnapshot();
      report.push(`Import failed, rolled back snapshot: ${e.message}`);
      return {
        success: false,
        importedKeysCount: 0,
        report
      };
    }
  }

  public exportBackup(): string {
    this.data.exportTimestamp = Date.now();
    return JSON.stringify(this.data, null, 2);
  }

  /**
   * Every stored key and value, for a whole-app backup.
   *
   * Distinct from `exportBackup` above, which produces the **Android** wire
   * format so a backup can move between the phone app and this one. This one
   * feeds `BackupService`, whose job is different: capture this installation so
   * it can be restored onto another machine.
   *
   * Non-transferable keys are filtered here rather than at restore, and the
   * distinction matters — a session token or a device id in an exported file is
   * a credential sitting in a user's Downloads folder. Filtering on the way out
   * means it was never written down.
   */
  public snapshot(): DatastoreBucket & { settings: DatastoreBucket } {
    const strip = (bucket: DatastoreBucket): DatastoreBucket => {
      const out: DatastoreBucket = {};
      for (const [name, entries] of Object.entries(bucket) as Array<
        [keyof DatastoreBucket, Record<string, unknown> | undefined]
      >) {
        if (!entries) continue;
        const kept: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(entries)) {
          if (this.isKeyTransferable(key)) kept[key] = value;
        }
        (out as Record<string, unknown>)[name] = kept;
      }
      return out;
    };
    return { ...strip(this.data.datastore), settings: strip(this.data.settings) };
  }

  /**
   * Puts a snapshot back, merging rather than replacing.
   *
   * Merge is deliberate. A restore onto a *running* installation must not drop
   * keys the backup predates — a preference added since it was taken would
   * silently revert to its default, which reads as the restore having broken
   * something rather than as it not having covered it.
   */
  public restore(snapshot: (DatastoreBucket & { settings?: DatastoreBucket }) | null): number {
    if (!snapshot || typeof snapshot !== 'object') return 0;
    let restored = 0;

    const merge = (target: DatastoreBucket, source: DatastoreBucket | undefined) => {
      if (!source) return;
      for (const [name, entries] of Object.entries(source)) {
        if (name === 'settings' || !entries || typeof entries !== 'object') continue;
        const bucket = (target as Record<string, Record<string, unknown>>);
        bucket[name] ??= {};
        for (const [key, value] of Object.entries(entries as Record<string, unknown>)) {
          if (!this.isKeyTransferable(key)) continue;
          bucket[name][key] = value;
          restored++;
        }
      }
    };

    const { settings, ...rest } = snapshot;
    merge(this.data.datastore, rest as DatastoreBucket);
    merge(this.data.settings, settings);
    this.save();
    this.flushSync();
    return restored;
  }
}
