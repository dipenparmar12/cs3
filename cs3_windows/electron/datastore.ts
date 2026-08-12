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

export class DatastoreManager {
  private dataDir: string;
  private dbFile: string;
  private backupSnapshotFile: string;
  private data: DatastoreBackup;

  // Non-transferable Android key grammar patterns (tokens, ephemeral state, device IDs)
  private nonTransferableKeyPatterns: RegExp[] = [
    /token/i,
    /session_id/i,
    /device_id/i,
    /auth_bearer/i,
    /ephemeral_/i,
    /cache_path/i
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

  public save(): void {
    try {
      fs.writeFileSync(this.dbFile, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (e) {
      console.error('Failed to save datastore:', e);
    }
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
        this.save();
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
    return target._String?.[key] ?? defaultValue;
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
}
