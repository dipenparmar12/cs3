/**
 * Where "Install Required Components" fetches a Java 21 runtime on each
 * operating system, and where that runtime sits inside the archive.
 *
 * The table this replaces had three faults, none visible on Windows:
 *
 * - every `amazon-corretto-21-*-jre` URL answers 404 (measured 2026-10-16 on
 *   all five platforms — Corretto publishes JDKs, not JREs), and the
 *   `ghproxy.net` copy carried no digest, so `usableMirrors` dropped it: the
 *   only working entry anywhere was Temurin's GitHub asset;
 * - a platform with no entry (Linux on ARM) fell back to the *Windows* zip;
 * - the download was always named `.zip`, so a macOS or Linux tarball went to
 *   `unzip`, which failed without anyone checking its exit status.
 *
 * Pinned to one Temurin release with the digests Adoptium publishes beside
 * each asset (`<asset>.sha256.txt`), which is also what lets a mirror be used
 * at all (audit SEC-03). Platform and architecture are Node's spellings.
 */

import fs from 'node:fs';
import path from 'node:path';

export interface PortableJavaSource {
  mirrors: Array<{ url: string; sha256: string }>;
  /** What the download is, which decides how it is unpacked. */
  archive: 'zip' | 'tar.gz';
}

const TEMURIN = 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.2%2B13';
const PROXY = 'https://ghproxy.net/';

const TEMURIN_JRE: Record<string, { asset: string; sha256: string }> = {
  win32_x64: {
    asset: 'OpenJDK21U-jre_x64_windows_hotspot_21.0.2_13.zip',
    sha256: 'a29b88541bc11276de4c4cbdfac60e374ef8a34a415f61cb02a2b6a46f0e1064',
  },
  darwin_x64: {
    asset: 'OpenJDK21U-jre_x64_mac_hotspot_21.0.2_13.tar.gz',
    sha256: 'e7d2eb566cbabae99385684989cf894f9ef86b2462a1911ea48fe50e197ce53a',
  },
  darwin_arm64: {
    asset: 'OpenJDK21U-jre_aarch64_mac_hotspot_21.0.2_13.tar.gz',
    sha256: 'c5704de3e0b6fb977db97b9b50d68dd65630e330375fd721ce9621dc407a4fb2',
  },
  linux_x64: {
    asset: 'OpenJDK21U-jre_x64_linux_hotspot_21.0.2_13.tar.gz',
    sha256: '51141204fe01a9f9dd74eab621d5eca7511eac67315c9975dbde5f2625bdca55',
  },
  linux_arm64: {
    asset: 'OpenJDK21U-jre_aarch64_linux_hotspot_21.0.2_13.tar.gz',
    sha256: '64c78854184c92a4da5cda571c8e357043bfaf03a03434eef58550cc3410d8a4',
  },
};

/** The runtime to download here, or `null` where none is published — never another platform's. */
export function portableJavaSource(platform: string, arch: string): PortableJavaSource | null {
  const entry = TEMURIN_JRE[`${platform}_${arch}`];
  if (!entry) return null;
  const url = `${TEMURIN}/${entry.asset}`;
  return {
    mirrors: [
      { url, sha256: entry.sha256 },
      { url: `${PROXY}${url}`, sha256: entry.sha256 },
    ],
    archive: entry.asset.endsWith('.zip') ? 'zip' : 'tar.gz',
  };
}

/**
 * The Java home inside an unpacked archive: the directory whose `bin/` holds
 * the launcher.
 *
 * Archives nest it one level down (`jdk-21.0.2+13-jre/bin/java`), and on
 * macOS one more (`jdk-21.0.2+13-jre/Contents/Home/bin/java`) — the layout the
 * old code did not know, so a macOS download unpacked and was then never found.
 */
export function locateJavaHome(dir: string, platform: string = process.platform): string | null {
  const exe = platform === 'win32' ? 'java.exe' : 'java';
  const isHome = (candidate: string) => fs.existsSync(path.join(candidate, 'bin', exe));
  if (isHome(dir)) return dir;
  let children: string[];
  try {
    children = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return null;
  }
  for (const child of children) {
    for (const candidate of [path.join(dir, child), path.join(dir, child, 'Contents', 'Home')]) {
      if (isHome(candidate)) return candidate;
    }
  }
  return null;
}
