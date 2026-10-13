/**
 * What to tell someone whose extension runtime is incomplete — and only advice
 * that can work.
 *
 * Every gap used to end "Click Install Required Components in Settings to set
 * up automatically". That button downloads a Java runtime and copies build
 * outputs into the app's data folder; it cannot produce `cs3-sidecar.jar` or
 * the provider bridge. In a fresh checkout — where the jar is not built yet,
 * which is the most common way to meet this message — pressing it changed
 * nothing and the same sentence came back. A message that sends someone to a
 * fix that cannot work is the reassuring-catch failure in words (AGENTS.md §4).
 *
 * So the advice depends on what is missing and on where the app is running:
 * - only Java → the button really does fix it;
 * - the sidecar or the bridge, in a checkout → build them (`bun run setup`);
 * - the sidecar or the bridge, in an installed app → this package was built
 *   without them, and only a complete package fixes that.
 *
 * Pure, so the wording is testable without Electron.
 */

export interface RuntimeGaps {
  javaReady: boolean;
  sidecarReady: boolean;
  bridgeReady: boolean;
  /** `app.isPackaged`: an installed build rather than a source checkout. */
  packaged: boolean;
}

export const REQUIRED_JAVA_VERSION = 21;

export function describeRuntimeGaps(gaps: RuntimeGaps): string | undefined {
  const built: string[] = [];
  if (!gaps.sidecarReady) built.push('the extension sidecar (cs3-sidecar.jar)');
  if (!gaps.bridgeReady) built.push('the provider bridge (library-jvm and cs3-provider-bridge.jar)');

  if (built.length > 0) {
    const what = built.join(' and ');
    // Java is mentioned only as an aside: it is the one piece the button can fetch.
    const java = gaps.javaReady ? '' : ` Java ${REQUIRED_JAVA_VERSION}+ is missing as well.`;
    return gaps.packaged
      ? `This copy of CloudStream was packaged without ${what}, so extensions cannot run. Install Required Components cannot download ${built.length > 1 ? 'them' : 'it'} — reinstall from a complete release.${java}`
      : `${capitalise(what)} ${built.length > 1 ? 'have' : 'has'} not been built in this checkout. Run "bun run setup" in desktop (it builds ${built.length > 1 ? 'them' : 'it'} with Maven), then restart the app.${java}`;
  }

  if (!gaps.javaReady) {
    return `Java ${REQUIRED_JAVA_VERSION}+ was not found. Click "Install Required Components" in Settings to download it.`;
  }
  return undefined;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
