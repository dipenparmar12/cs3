import fs from 'fs';
import path from 'path';
import { app } from 'electron';

export interface DatastoreBackup {
  datastore: {
    _Bool?: Record<string, boolean>;
    _Int?: Record<string, number>;
    _String?: Record<string, string>;
    _Float?: Record<string, number>;
    _Long?: Record<string, number>;
    _StringSet?: Record<string, string[]>;
  };
  settings: {
    _Bool?: Record<string, boolean>;
    _Int?: Record<string, number>;
    _String?: Record<string, string>;
    _Float?: Record<string, number>;
    _Long?: Record<string, number>;
    _StringSet?: Record<string, string[]>;
  };
}

export class DatastoreManager {
  private dataDir: string;
  private dbFile: string;
  private data: DatastoreBackup;

  constructor() {
    this.dataDir = app ? app.getPath('userData') : path.join(process.cwd(), 'data');
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    this.dbFile = path.join(this.dataDir, 'cs3_datastore.json');
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
    };
  }

  public save(): void {
    try {
      fs.writeFileSync(this.dbFile, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (e) {
      console.error('Failed to save datastore:', e);
    }
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

  // Aliases for compatibility
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

  // --- Android Backup Import & Export ---

  public importBackupFile(filePath: string): boolean {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const backupData = JSON.parse(content) as DatastoreBackup;

      if (backupData.datastore) {
        Object.assign(this.data.datastore._Bool ??={}, backupData.datastore._Bool ?? {});
        Object.assign(this.data.datastore._Int ??={}, backupData.datastore._Int ?? {});
        Object.assign(this.data.datastore._String ??={}, backupData.datastore._String ?? {});
        Object.assign(this.data.datastore._Float ??={}, backupData.datastore._Float ?? {});
        Object.assign(this.data.datastore._Long ??={}, backupData.datastore._Long ?? {});
        Object.assign(this.data.datastore._StringSet ??={}, backupData.datastore._StringSet ?? {});
      }

      if (backupData.settings) {
        Object.assign(this.data.settings._Bool ??={}, backupData.settings._Bool ?? {});
        Object.assign(this.data.settings._Int ??={}, backupData.settings._Int ?? {});
        Object.assign(this.data.settings._String ??={}, backupData.settings._String ?? {});
        Object.assign(this.data.settings._Float ??={}, backupData.settings._Float ?? {});
        Object.assign(this.data.settings._Long ??={}, backupData.settings._Long ?? {});
        Object.assign(this.data.settings._StringSet ??={}, backupData.settings._StringSet ?? {});
      }

      this.save();
      return true;
    } catch (e) {
      console.error('Error importing backup:', e);
      return false;
    }
  }

  public exportBackup(): string {
    return JSON.stringify(this.data, null, 2);
  }
}
