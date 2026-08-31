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
  /**
   * The cross-platform artifact, when the author opted in.
   *
   * Upstream's Gradle plugin has carried `isCrossPlatform` for some time: set
   * it and `:make` emits a plain JVM **jar** beside the `.cs3`, runs
   * `jdeps --print-module-deps` over it, and **fails the build** if the output
   * mentions `android.` — then writes these three fields into the published
   * index. They have been in `plugins.json` all along and nothing read them.
   *
   * Measured against the live indexes on 2026-08-28: **5 of 5** extensions in
   * `recloudstream/extensions` and **47 of 79** in `phisher98`'s repository
   * publish a `jarUrl`, and every one checked matched its declared hash and
   * size. So this is not a lane we are asking anyone to adopt — it is one a
   * large part of the corpus already publishes into.
   */
  jarUrl?: string;
  jarHash?: string;
  jarFileSize?: number;
}

export interface RepositoryData {
  iconUrl?: string;
  name: string;
  url: string;
}

export interface PluginCompatibilityReport {
  pluginName: string;
  internalName: string;
  /**
   * `CSJ` is the cross-platform jar lane — JVM bytecode published by upstream's
   * own build and verified by it to name no `android.*` type. It is a distinct
   * format rather than a flag on `CS3` because the two go through different
   * pipelines: one is translated at install and one is not.
   */
  format: 'CS3' | 'CSJ' | 'JS' | 'KMP';
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

/**
 * The source hierarchy, which is exactly three levels deep:
 * repository → extension → provider. The provider is the selectable leaf.
 *
 * `id` fields are always populated by the main process. They are optional here
 * only because the extensions screen synthesises placeholder nodes for
 * repositories whose archives have not been loaded yet, and those have no
 * identity to give.
 */
export interface ProviderTreeProvider {
  name: string;
  lang?: string;
  supportedTypes: string[];
  /** Stable identity for selection, filtering and result attribution. */
  id?: string;
  /** False when the provider itself is switched off in the extensions screen. */
  enabled?: boolean;
  /**
   * False when an ancestor is switched off while this provider's own switch is
   * still on. Distinct from `enabled` so the UI can say *why* a provider is
   * silent — its own toggle would appear inert against an ancestor gate.
   */
  effectivelyEnabled?: boolean;
  /** Provenance: which extension registered it, and which repository supplied that. */
  extensionInternalName?: string;
  extensionName?: string;
  repositoryId?: string;
  repositoryName?: string;
  /** Declares upstream's NSFW `TvType`. */
  adult?: boolean;
}

export interface ProviderTreeExtension {
  internalName: string;
  name: string;
  language?: string;
  providers: ProviderTreeProvider[];
  id?: string;
  /**
   * Why this extension offers nothing to select. Present only when it offers
   * nothing — never invent a provider to stand in for it.
   */
  unavailableReason?: string;
  /** False when switched off by the user. The archive is kept either way. */
  enabled?: boolean;
  /** False when its repository is switched off, whatever its own state. */
  effectivelyEnabled?: boolean;
  version?: number;
  authors?: string[];
  description?: string;
  iconUrl?: string;
  fileSize?: number;
  repositoryId?: string;
  repositoryName?: string;
  /** Union of the content types its providers declare, for tag filtering. */
  tvTypes?: string[];
  enabledProviderCount?: number;
}

export interface ProviderTreeRepository {
  url: string;
  name: string;
  extensions: ProviderTreeExtension[];
  id?: string;
  /** False when the whole repository is switched off. Archives are kept. */
  enabled?: boolean;
  /** Installed on first launch. Labelled, never hidden, and always removable. */
  bundled?: boolean;
  description?: string;
  category?: string;
  iconUrl?: string;
  /** Whether the catalogue confirmed this URL returns a document. */
  verified?: boolean;
  /** The project page, when `url` is a raw document link. */
  homepageUrl?: string;
  extensionCount?: number;
  providerCount?: number;
  enabledProviderCount?: number;
  tvTypes?: string[];
}
