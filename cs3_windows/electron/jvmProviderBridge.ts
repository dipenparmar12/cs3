import child_process, { ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import type { SearchResponse, LoadResponse, ExtractorLink } from '../src/types/api';

export interface JVMProviderCallPayload {
  action: 'search' | 'load' | 'loadLinks';
  providerClass: string;
  query?: string;
  url?: string;
}

export class JVMProviderBridge {
  private javaProcess: ChildProcess | null = null;
  private isJavaAvailable: boolean = false;
  private jvmLibPath: string;

  constructor(workspacePath: string) {
    this.jvmLibPath = path.join(workspacePath, 'cloudstream_ref_android', 'library');
    this.checkJavaRuntime();
  }

  private checkJavaRuntime(): void {
    try {
      const output = child_process.execSync('java -version', { encoding: 'utf-8', stdio: 'pipe' });
      this.isJavaAvailable = true;
    } catch {
      this.isJavaAvailable = false;
    }
  }

  public isReady(): boolean {
    return this.isJavaAvailable;
  }

  public async executeProviderAction<T>(payload: JVMProviderCallPayload): Promise<T | null> {
    if (!this.isJavaAvailable) {
      return null;
    }

    return new Promise((resolve) => {
      // Execute Java provider invocation sub-process
      const args = [
        '-cp',
        this.jvmLibPath,
        'com.lagradost.cloudstream3.jvm.ProviderExecutorHost',
        JSON.stringify(payload)
      ];

      const proc = child_process.spawn('java', args, { stdio: ['pipe', 'pipe', 'pipe'] });
      let output = '';

      proc.stdout.on('data', (data) => (output += data.toString()));
      proc.on('close', (code) => {
        if (code === 0 && output.trim()) {
          try {
            resolve(JSON.parse(output) as T);
          } catch {
            resolve(null);
          }
        } else {
          resolve(null);
        }
      });
      proc.on('error', () => resolve(null));
    });
  }
}
