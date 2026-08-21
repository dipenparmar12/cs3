/**
 * The envelope every fallible IPC channel answers with.
 *
 * A transport failure must surface in the UI as text the user can act on, never
 * as an unhandled rejection in the renderer — so handlers resolve with
 * `{ ok: false, error }` instead of throwing across the bridge. That contract
 * was previously written out by hand at sixty-eight call sites in `main.ts`,
 * each with its own `try`, its own `catch`, and its own idea of what the payload
 * should look like when the call failed.
 *
 * This module owns the semantics. It deliberately does **not** import
 * `electron`: that import makes a module unloadable under Node's type stripping,
 * which is where its tests run — the same reason `logging/logger.ts` keeps its
 * distance. The binding to `ipcMain` lives next door in `channel.ts`.
 */

/** What a fallible channel resolves with: the flag, the reason, the payload. */
export type Envelope<TPayload extends object = Record<string, never>> = {
  ok: boolean;
  error?: string;
} & TPayload;

/**
 * Normalises a thrown value into the error half of an envelope.
 *
 * Anything can be thrown in JavaScript, and a rejected promise carrying a string
 * or a DOMException still has to arrive at the renderer as a readable sentence.
 */
export function failure(error: unknown): { ok: false; error: string } {
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

/** A failure payload, either fixed or built on demand. */
export type Fallback<T extends object> = T | (() => T);

function resolveFallback<T extends object>(fallback: Fallback<T> | undefined): object {
  if (typeof fallback === 'function') {
    try {
      return (fallback as () => T)();
    } catch {
      /**
       * A fallback that throws must not replace the original failure with its
       * own. The caller asked why their call failed; answering with a second,
       * unrelated error from the error path is strictly worse than answering
       * with no payload at all.
       */
      return {};
    }
  }
  return fallback ?? {};
}

/**
 * Runs a handler and wraps whatever happens in an envelope.
 *
 * **The spread order is load-bearing.** `{ ok: true, ...payload }` lets a
 * handler return its own `ok: false` for a *validation* failure — an unknown
 * enum value, a malformed id — which is a real answer rather than an exception,
 * and several channels already work that way. Spreading the payload last is what
 * keeps that possible; hard-coding `ok: true` after it would silently convert
 * every rejection-as-a-value into a success.
 *
 * The failure payload is spread *after* the error for the mirror-image reason:
 * a caller that wants to state its own `error` text on a specific failure can.
 */
export async function toEnvelope<TPayload extends object, TFallback extends object>(
  run: () => TPayload | Promise<TPayload>,
  fallback?: Fallback<TFallback>
): Promise<object> {
  try {
    return { ok: true, ...(await run()) };
  } catch (error) {
    return { ...failure(error), ...resolveFallback(fallback) };
  }
}
