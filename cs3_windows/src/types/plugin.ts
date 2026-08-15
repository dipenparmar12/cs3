import type { TvType } from './api';

export const PluginRuntimeTier = {
  TierA_SourceJVM: 'Tier A (Source-Rebuilt JVM)',
  TierB_LegacyDEX: 'Tier B (Legacy DEX Translator)',
  TierC_NativeTS: 'Tier C (Native TypeScript SDK)',
  TierC_NativeKMP: 'Tier C (Kotlin Multiplatform JS)',
  NotAnalyzed: 'Not analyzed',
  Unsupported: 'Unsupported',
} as const;
export type PluginRuntimeTier = (typeof PluginRuntimeTier)[keyof typeof PluginRuntimeTier];

export interface SitePlugin {
  url: string;
  status: number; // 0 Down, 1 Ok, 2 Slow, 3 Beta
  version: number;
  apiVersion?: number;
  name: string;
  internalName: string;
  authors?: string[];
  description?: string;
  repositoryUrl?: string;
  tvTypes?: TvType[];
  language?: string;
  iconUrl?: string;
  fileSize?: number;
  fileHash?: string;
}

export interface RepositoryData {
  iconUrl?: string;
  name: string;
  url: string;
}

export interface PluginCompatibilityReport {
  pluginName: string;
  internalName: string;
  format: 'CS3' | 'JS' | 'KMP';
  compatibilityScore: number; // 0 to 100
  confidence: 'High' | 'Medium' | 'Low' | 'Unsupported';
  recommendedTier: PluginRuntimeTier;
  androidApiReferences: number;
  hasNativeLibs: boolean;
  hasReflection: boolean;
  networkStack: string;
  htmlParser: string;
  details: string[];
}

export interface PluginData {
  internalName: string;
  url?: string;
  isOnline: boolean;
  filePath: string;
  version: number;
  tier: PluginRuntimeTier;
  isEnabled: boolean;
}

export interface ProviderTreeRepository {
  url: string;
  name: string;
  extensions: Array<{
    internalName: string;
    name: string;
    language?: string;
    providers: Array<{ name: string; lang?: string; supportedTypes: string[] }>;
  }>;
}
