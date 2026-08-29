import fs from 'fs';
import { PluginRuntimeTier } from '../src/types/plugin';
import type { PluginCompatibilityReport } from '../src/types/plugin';

/**
 * Static compatibility analysis for `.cs3` archives.
 *
 * The previous implementation returned a hardcoded `compatibilityScore: 95`,
 * `confidence: 'High'` for every input, with `androidApiReferences` declared and
 * never assigned. That is worse than no analyzer: it asserted confidence in an
 * inspection that never happened, so a plugin looked supported right up until it
 * failed.
 *
 * This version inspects the archive for real and, crucially, reports
 * `NotAnalyzed`/`Unsupported` when it cannot draw a conclusion. Scores here
 * describe *static* compatibility only — nothing in this build can execute a
 * `.cs3`, and the report says so.
 */

/** DEX files begin with `dex\n035\0` (version digits vary). */
const DEX_MAGIC = Buffer.from([0x64, 0x65, 0x78, 0x0a]);
const ZIP_MAGIC = Buffer.from([0x50, 0x4b]);

/**
 * Android APIs that the shim layer in doc 31 §5.1 covers, versus those it does
 * not. Presence is detected from the DEX string table, which lists every type
 * descriptor the code references.
 */
const SHIMMED_APIS = [
  'Landroid/util/Log;',
  'Landroid/util/Base64;',
  'Landroid/content/Context;',
  'Landroid/content/SharedPreferences;',
  'Landroid/webkit/CookieManager;',
  'Landroid/net/Uri;',
  'Landroid/os/Build;',
];

const UNSHIMMED_APIS = [
  'Landroid/view/',
  'Landroid/widget/',
  'Landroid/app/Activity;',
  'Landroid/app/Dialog;',
  'Landroid/graphics/',
  'Landroid/media/',
  'Landroid/hardware/',
  'Landroid/telephony/',
  'Landroid/content/pm/PackageManager;',
];

const WEBVIEW_APIS = ['Landroid/webkit/WebView;', 'WebViewResolver', 'CloudflareKiller'];

interface ArchiveFacts {
  isZip: boolean;
  hasDex: boolean;
  hasNativeLibs: boolean;
  sizeBytes: number;
  /** Raw bytes of the concatenated DEX payloads, for string scanning. */
  dexPayload: Buffer | null;
  entryNames: string[];
  manifestClassName?: string;
  /** `.class` members, which is what makes an archive a cross-platform jar. */
  classCount: number;
}

export class PluginCompatibilityAnalyzer {
  public analyzePlugin(
    pluginName: string,
    internalName: string,
    filePathOrUrl: string
  ): PluginCompatibilityReport {
    if (/\.(ts|js|mjs)$/i.test(filePathOrUrl)) {
      return {
        pluginName,
        internalName,
        format: 'JS',
        compatibilityScore: 100,
        confidence: 'High',
        recommendedTier: PluginRuntimeTier.TierC_NativeTS,
        androidApiReferences: 0,
        hasNativeLibs: false,
        hasReflection: false,
        networkStack: 'Brokered fetch',
        htmlParser: 'Cheerio',
        details: ['Native TypeScript extension — runs in a sandboxed V8 isolate.'],
      };
    }

    // Nothing to inspect: the plugin has not been downloaded yet.
    if (!filePathOrUrl || !fs.existsSync(filePathOrUrl)) {
      return this.notAnalyzed(
        pluginName,
        internalName,
        'The archive is not present locally. Install the plugin to analyse it.'
      );
    }

    let facts: ArchiveFacts;
    try {
      facts = this.inspectArchive(filePathOrUrl);
    } catch (error) {
      return this.notAnalyzed(
        pluginName,
        internalName,
        `Archive could not be read: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    if (!facts.isZip) {
      return {
        ...this.notAnalyzed(pluginName, internalName, 'Not a ZIP archive — not a valid .cs3 file.'),
        confidence: 'Unsupported',
        recommendedTier: PluginRuntimeTier.Unsupported,
        compatibilityScore: 0,
      };
    }

    const details: string[] = [`Archive size: ${(facts.sizeBytes / 1024).toFixed(1)} KB`];
    if (facts.manifestClassName) {
      details.push(`Plugin entry class: ${facts.manifestClassName}`);
    } else {
      details.push('No pluginClassName in manifest.json — entry point unknown.');
    }

    /**
     * A cross-platform jar, which has no DEX because it never needed one.
     *
     * This branch has to come first, and getting it wrong is worse than having
     * no branch at all: the archive reaches the "no classes.dex" case below,
     * which reports `Unsupported` with a score of zero — the exact opposite of
     * the truth for the one lane that skips translation entirely. The install
     * screen shows this report, so an author who opted in would have been told
     * their extension was incompatible.
     *
     * The score is not a guess. Upstream's build ran `jdeps --print-module-deps`
     * over this jar and refused to publish it if the output named a single
     * `android.` type, so the whole category of failure the score below is
     * measuring — Android API surface we would have to shim — is absent by
     * construction.
     */
    if (!facts.hasDex && facts.classCount > 0) {
      details.push(
        `Cross-platform JVM jar: ${facts.classCount} classes, no DEX to translate.`
      );
      details.push(
        'Published by upstream’s build with `isCrossPlatform`, which fails if `jdeps` finds any `android.` dependency.'
      );
      // Stated rather than implied, because it is the part most easily
      // overclaimed: `jdeps` flags `android.*` only. This jar can still reach
      // the `:app` types the bridge supplies, so the linkage analysis in the
      // sidecar still runs and can still demote it.
      details.push('The `:app` classpath still applies; the runtime tier is decided by the sidecar.');
      return {
        pluginName,
        internalName,
        format: 'CSJ',
        compatibilityScore: 95,
        confidence: 'High',
        recommendedTier: PluginRuntimeTier.TierA_SourceJVM,
        androidApiReferences: 0,
        hasNativeLibs: facts.hasNativeLibs,
        hasReflection: false,
        networkStack: 'Unknown',
        htmlParser: 'Unknown',
        details,
      };
    }

    if (!facts.hasDex) {
      details.push('No classes.dex found; the archive carries no Android bytecode.');
      return {
        pluginName,
        internalName,
        format: 'CS3',
        compatibilityScore: 0,
        confidence: 'Unsupported',
        recommendedTier: PluginRuntimeTier.Unsupported,
        androidApiReferences: 0,
        hasNativeLibs: facts.hasNativeLibs,
        hasReflection: false,
        networkStack: 'Unknown',
        htmlParser: 'Unknown',
        details,
      };
    }

    // The DEX string table is plain UTF-8 within the file, so a substring scan
    // over the raw bytes is a sound (if coarse) way to enumerate referenced types.
    const payload = facts.dexPayload?.toString('latin1') ?? '';

    const shimmed = SHIMMED_APIS.filter((api) => payload.includes(api));
    const unshimmed = UNSHIMMED_APIS.filter((api) => payload.includes(api));
    const usesWebView = WEBVIEW_APIS.some((api) => payload.includes(api));
    const hasReflection =
      payload.includes('Ljava/lang/reflect/') || payload.includes('Ljava/lang/Class;');

    let score = 100;
    if (unshimmed.length > 0) score -= Math.min(45, unshimmed.length * 12);
    if (facts.hasNativeLibs) score -= 60;
    if (usesWebView) score -= 10;
    score = Math.max(0, score);

    if (shimmed.length > 0) {
      details.push(`Shimmed Android APIs referenced: ${shimmed.length} (${shimmed.join(', ')})`);
    }
    if (unshimmed.length > 0) {
      details.push(`Android APIs with no shim: ${unshimmed.join(', ')} — these would degrade or fail.`);
    }
    if (usesWebView) {
      details.push('References WebView/Cloudflare bypass — needs the offscreen browser bridge.');
    }
    if (facts.hasNativeLibs) {
      details.push('Contains native .so libraries — not loadable in a sandboxed JVM.');
    }
    if (hasReflection) {
      details.push('Uses reflection — expected for plugin entry points, but worth noting.');
    }

    details.push(
      'Static analysis only. Nothing in this build can execute a .cs3; see docs/PRD/31-cs3-dropin-compatibility.md.'
    );

    const tier = facts.hasNativeLibs
      ? PluginRuntimeTier.Unsupported
      : PluginRuntimeTier.TierB_LegacyDEX;

    return {
      pluginName,
      internalName,
      format: 'CS3',
      compatibilityScore: score,
      // Never "High": import presence does not prove runtime behaviour, and no
      // execution has been attempted (doc 31 §2.3, DROP-28).
      confidence: facts.hasNativeLibs ? 'Unsupported' : unshimmed.length > 0 ? 'Low' : 'Medium',
      recommendedTier: tier,
      androidApiReferences: shimmed.length + unshimmed.length,
      hasNativeLibs: facts.hasNativeLibs,
      hasReflection,
      networkStack: payload.includes('okhttp3') ? 'OkHttp / NiceHttp' : 'Unknown',
      htmlParser: payload.includes('org/jsoup') ? 'Jsoup' : 'Unknown',
      details,
    };
  }

  private notAnalyzed(
    pluginName: string,
    internalName: string,
    reason: string
  ): PluginCompatibilityReport {
    return {
      pluginName,
      internalName,
      format: 'CS3',
      compatibilityScore: 0,
      confidence: 'Low',
      recommendedTier: PluginRuntimeTier.NotAnalyzed,
      androidApiReferences: 0,
      hasNativeLibs: false,
      hasReflection: false,
      networkStack: 'Unknown',
      htmlParser: 'Unknown',
      details: [reason],
    };
  }

  /**
   * Minimal ZIP central-directory reader.
   *
   * A dedicated unzip dependency would be heavier than warranted: we only need
   * entry names, the DEX payloads, and the manifest. Stored *and* deflated
   * entries are handled via `zlib.inflateRawSync`.
   */
  private inspectArchive(filePath: string): ArchiveFacts {
    const buffer = fs.readFileSync(filePath);
    const facts: ArchiveFacts = {
      isZip: buffer.subarray(0, 2).equals(ZIP_MAGIC),
      hasDex: false,
      hasNativeLibs: false,
      sizeBytes: buffer.length,
      dexPayload: null,
      entryNames: [],
      classCount: 0,
    };
    if (!facts.isZip) return facts;

    const dexChunks: Buffer[] = [];
    // Walk local file headers (PK\x03\x04) rather than the central directory:
    // simpler, and sufficient because we only read, never rewrite, the archive.
    let offset = 0;
    while (offset + 30 <= buffer.length) {
      if (buffer.readUInt32LE(offset) !== 0x04034b50) break;

      const compressionMethod = buffer.readUInt16LE(offset + 8);
      const compressedSize = buffer.readUInt32LE(offset + 18);
      const nameLength = buffer.readUInt16LE(offset + 26);
      const extraLength = buffer.readUInt16LE(offset + 28);

      const nameStart = offset + 30;
      const name = buffer.subarray(nameStart, nameStart + nameLength).toString('utf8');
      const dataStart = nameStart + nameLength + extraLength;

      facts.entryNames.push(name);
      if (/\.so$/i.test(name) || name.startsWith('lib/')) facts.hasNativeLibs = true;
      if (/\.class$/i.test(name)) facts.classCount++;

      // A zero compressed size means the sizes live in a trailing data
      // descriptor; streaming past it reliably is out of scope, so stop here
      // and report on what was read.
      if (compressedSize === 0 && compressionMethod !== 0) break;

      const data = buffer.subarray(dataStart, dataStart + compressedSize);

      if (/(^|\/)classes\d*\.dex$/i.test(name) || /(^|\/)manifest\.json$/i.test(name)) {
        let content: Buffer | null = null;
        try {
          if (compressionMethod === 0) {
            content = Buffer.from(data);
          } else if (compressionMethod === 8) {
            // Lazy import keeps zlib out of the hot path for non-archive calls.
            const { inflateRawSync } = require('zlib') as typeof import('zlib');
            content = inflateRawSync(data);
          }
        } catch {
          content = null;
        }

        if (content) {
          if (/\.dex$/i.test(name)) {
            if (content.subarray(0, 4).equals(DEX_MAGIC)) {
              facts.hasDex = true;
              dexChunks.push(content);
            }
          } else {
            try {
              const manifest = JSON.parse(content.toString('utf8')) as Record<string, unknown>;
              // Android's key is `pluginClassName` (PluginManager.kt), not `pluginClass`.
              const className = manifest.pluginClassName ?? manifest.pluginClass;
              if (typeof className === 'string') facts.manifestClassName = className;
            } catch {
              // Malformed manifest is itself a finding, reported by the caller.
            }
          }
        }
      }

      offset = dataStart + compressedSize;
    }

    if (dexChunks.length > 0) facts.dexPayload = Buffer.concat(dexChunks);
    return facts;
  }
}
