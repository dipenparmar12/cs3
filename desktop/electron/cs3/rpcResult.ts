/**
 * What one sidecar call answered, and whether it answered at all.
 *
 * A separate module from `sidecarSupervisor.ts` for `groupingForm`'s reason:
 * that one imports `electron` and spawns a child process, so it cannot be
 * loaded under Node's type stripping — and this is the half worth testing.
 *
 * ## The distinction this exists to keep
 *
 * A failed call is one of two completely different things, and flattening them
 * cost a real defect. Either the runtime **answered and the answer was no**, or
 * the runtime **never answered**: it was not running, it was shut down, it
 * crashed, or it did not reply inside the deadline.
 *
 * `PluginManager.inspect` used to turn every `!ok` reply into a `T4_BLOCKED`
 * tier, which states that an archive cannot be loaded. Two things act on that:
 *
 * - `ExtensionUpdater` reads it through `verifyInstalledPlugin` and **rolls the
 *   update back** — undoing an archive that had already downloaded, verified
 *   its publisher's SHA-256 and been written atomically, and reporting the
 *   extension as broken.
 * - The tier is cached, so the extensions screen shows a working extension as
 *   blocked until something re-inspects it.
 *
 * Neither is hypothetical. A bulk update unloads, translates and reloads each
 * archive in turn against a JVM holding a hundred-plus plugins, and the call
 * deadline is 60 seconds. DROP-34 already said an unreachable runtime is not a
 * verdict; it was only being honoured for a sidecar that had never started.
 */

export interface RpcResult {
  ok: boolean;
  result?: Record<string, unknown>;
  error?: string;
  errorKind?: string;
}

/**
 * The kinds set by the *host* when no verdict was ever produced.
 *
 * Every one of these is written by `SidecarSupervisor` itself rather than by
 * the JVM, which is what makes the set closed and knowable: they are the ways
 * the conversation can fail rather than the ways an answer can be negative.
 */
export const TRANSPORT_ERROR_KINDS = new Set([
  'SIDECAR_UNAVAILABLE',
  'SIDECAR_STOPPED',
  'SIDECAR_CRASHED',
  'TIMEOUT',
]);

/** Whether a failed call means "the runtime never answered", not "the answer was no". */
export function isTransportFailure(result: RpcResult): boolean {
  return !result.ok && TRANSPORT_ERROR_KINDS.has(result.errorKind ?? '');
}
