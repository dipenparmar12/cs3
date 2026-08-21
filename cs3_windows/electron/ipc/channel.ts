import { ipcMain } from 'electron';
import { toEnvelope, type Fallback } from './envelope.ts';

/**
 * Registration helpers for the `ipcMain` side of the bridge.
 *
 * Two shapes, because the surface genuinely has two. Most channels are fallible
 * and answer with an envelope; a minority are total — they read something from
 * memory and cannot fail — and those return their value bare. Forcing the second
 * group into an envelope would change the contract the renderer already relies
 * on, so both are supported and named for what they are.
 *
 * Every registration in the app goes through here so that
 * `tools/refactor/ipc-surface.mjs` has one grammar to look for, and so the
 * per-domain registrars introduced in Phase 2 have a single import.
 */

/**
 * Registers a fallible channel.
 *
 * The handler receives the renderer's arguments directly — the `IpcMainEvent` is
 * dropped, because none of this app's handlers use it and every one of them
 * therefore opened with an unused `_` parameter.
 *
 * `fallback` is the payload to merge into a failure, and it exists because the
 * renderer destructures these replies: a search that fails still has to answer
 * with `results: []` or every caller needs a null check that none of them has.
 * Omit it where the channel's failure carries no payload.
 */
export function handle<TArgs extends unknown[], TPayload extends object, TFallback extends object>(
  channel: string,
  handler: (...args: TArgs) => TPayload | Promise<TPayload>,
  fallback?: Fallback<TFallback>
): void {
  ipcMain.handle(channel, (_event, ...args) =>
    toEnvelope(() => handler(...(args as TArgs)), fallback)
  );
}

/**
 * Registers a channel that answers with a bare value.
 *
 * For the reads that cannot fail — a list held in memory, a number out of the
 * datastore. Wrapping these would be a contract change, not a tidy-up: the
 * renderer awaits the array itself, not `{ ok, items }`.
 */
export function handleRaw<TArgs extends unknown[], TResult>(
  channel: string,
  handler: (...args: TArgs) => TResult | Promise<TResult>
): void {
  ipcMain.handle(channel, (_event, ...args) => handler(...(args as TArgs)));
}
