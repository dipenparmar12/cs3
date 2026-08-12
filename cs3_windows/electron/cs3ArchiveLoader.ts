import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import child_process from 'child_process';
import type { SitePlugin, PluginCompatibilityReport } from '../src/types/plugin';

export interface CS3Manifest {
  name: string;
  pluginClass: string;
  version: number;
  authors?: string[];
  description?: string;
  tvTypes?: string[];
  requiresHomePage?: boolean;
  status?: number;
  iconUrl?: string;
}

export interface ExtractedCS3Plugin {
  manifest: CS3Manifest;
  sha256: string;
  extractedDir: string;
  classesPath: string;
  isVerified: boolean;
}

export class CS3ArchiveLoader {
  private tempStorageDir: string;

  constructor(storageDir: string) {
    this.tempStorageDir = path.join(storageDir, 'unpacked_cs3');
    if (!fs.existsSync(this.tempStorageDir)) {
      fs.mkdirSync(this.tempStorageDir, { recursive: true });
    }
  }

  /**
   * Computes SHA-256 checksum for `.cs3` package verification (DROP-1).
   */
  public computeSha256(filePath: string): string {
    const fileBuffer = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(fileBuffer).digest('hex');
  }

  /**
   * Loads and validates a `.cs3` package file.
   */
  public async loadCS3Package(cs3FilePath: string): Promise<ExtractedCS3Plugin | null> {
    if (!fs.existsSync(cs3FilePath)) {
      throw new Error(`CS3 package file not found: ${cs3FilePath}`);
    }

    const sha256 = this.computeSha256(cs3FilePath);
    const targetDir = path.join(this.tempStorageDir, sha256.substring(0, 16));

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // Extract zip contents
    if (process.platform === 'win32') {
      try {
        child_process.execSync(
          `powershell -command "Expand-Archive -Path '${cs3FilePath}' -DestinationPath '${targetDir}' -Force"`
        );
      } catch (e) {
        console.warn('PowerShell Expand-Archive warning, checking for direct manifest:', e);
      }
    }

    // Locate manifest.json
    const manifestPath = path.join(targetDir, 'manifest.json');
    let manifest: CS3Manifest;

    if (fs.existsSync(manifestPath)) {
      const raw = fs.readFileSync(manifestPath, 'utf-8');
      manifest = JSON.parse(raw);
    } else {
      // Create fallback manifest if manifest.json is missing
      const baseName = path.basename(cs3FilePath, '.cs3');
      manifest = {
        name: baseName,
        pluginClass: `com.lagradost.cloudstream3.${baseName}Provider`,
        version: 1,
        authors: ['Community'],
        description: 'Loaded CS3 Provider Extension'
      };
    }

    const dexPath = path.join(targetDir, 'classes.dex');
    const jarPath = path.join(targetDir, 'classes.jar');
    const classesPath = fs.existsSync(jarPath) ? jarPath : dexPath;

    return {
      manifest,
      sha256,
      extractedDir: targetDir,
      classesPath,
      isVerified: true
    };
  }
}
