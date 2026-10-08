import { describeError } from '../../src/utils/errors.ts';
import type {
  UserDataArea,
  UserDataResetResult,
  UserDataSummary,
} from '../../src/types/userData.ts';

/**
 * "Erase my data": everything this installation learned *from the viewer*,
 * and nothing it needs to run.
 *
 * ## The line
 *
 * **Erased:** what a person did — what they watched and where they stopped,
 * what they saved, searched for and opened, which sources played for them, the
 * download list, saved subtitles, and the caches that are copies of pages they
 * visited.
 *
 * **Never touched:** the building blocks — mpv, FFmpeg, aria2c, yt-dlp, the
 * Java runtime and the sidecar, installed repositories and extensions, and the
 * settings. These are infrastructure the viewer set up (or the app fetched)
 * and re-acquiring them costs minutes and bandwidth, while none of them says
 * anything about what the viewer did. They are listed on the confirmation so
 * the scope is stated, not implied.
 *
 * ## Shape
 *
 * Areas are rows in a table, as backup sections and storage areas are: an id,
 * the words to show, a count and a clear that goes through the *owning store*.
 * Emptying a store's file while the service holds it in memory would be undone
 * by its next write — the bug `storage:clearArea` is careful about too.
 *
 * Pure apart from the injected clears, so the runner is tested without
 * Electron.
 */
export interface ResetAreaDefinition extends Omit<UserDataArea, 'count'> {
  /** How many things would go. `null` when the store cannot say cheaply. */
  count(): number | null;
  clear(options: { deleteDownloadedFiles: boolean }): void | Promise<void>;
}

/** Infrastructure the reset never touches — shown on the confirmation. */
export const PRESERVED_ON_RESET = [
  'Media tools (mpv, FFmpeg, aria2c, yt-dlp)',
  'The Java runtime and the extension sidecar',
  'Installed repositories and extensions',
  'Your settings and preferences',
] as const;

export function summarise(areas: ResetAreaDefinition[]): UserDataSummary {
  return {
    areas: areas.map((area) => {
      let count: number | null = null;
      try {
        count = area.count();
      } catch {
        count = null;
      }
      return {
        id: area.id,
        label: area.label,
        description: area.description,
        defaultSelected: area.defaultSelected,
        count,
      };
    }),
    preserved: [...PRESERVED_ON_RESET],
  };
}

/**
 * Clears the chosen areas, each independently.
 *
 * One area failing never stops the rest — a locked subtitle file is not a
 * reason to keep someone's watch history — and every failure is reported by
 * name. Unknown ids are reported rather than ignored, so a renderer and main
 * process that have drifted apart say so instead of "erasing" nothing.
 */
export async function runReset(
  areas: ResetAreaDefinition[],
  chosen: string[],
  options: { deleteDownloadedFiles?: boolean } = {}
): Promise<UserDataResetResult> {
  const byId = new Map(areas.map((area) => [area.id, area]));
  const cleared: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];

  // Table order, not request order: it is the order the confirmation listed.
  const wanted = new Set(chosen);
  for (const id of chosen) {
    if (!byId.has(id)) failed.push({ id, error: 'Unknown area.' });
  }
  for (const area of areas) {
    if (!wanted.has(area.id)) continue;
    try {
      await area.clear({ deleteDownloadedFiles: Boolean(options.deleteDownloadedFiles) });
      cleared.push(area.id);
    } catch (error) {
      failed.push({ id: area.id, error: describeError(error) });
    }
  }
  return { ok: failed.length === 0, cleared, failed };
}
