/**
 * The extension runtime's maximum heap, by machine memory. Shared by the app
 * (`sidecarSupervisor.ts`) and the provider audit, which must run the JVM as
 * the app does: at a tools-sized 768 MB, AniSnatch's DEX translation ran out
 * of heap and the audit called the extension broken (measured 2026-10-28).
 * Pure.
 */
const GB = 1024 * 1024 * 1024;

export function jvmHeapMb(totalMemoryBytes: number): number {
  if (totalMemoryBytes >= 16 * GB) return 4096;
  if (totalMemoryBytes >= 8 * GB) return 3072;
  return 2048;
}
