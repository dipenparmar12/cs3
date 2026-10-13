/**
 * The shapes behind Settings → Privacy → "Erase my data".
 *
 * Shared by both sides of the IPC boundary, like every other `src/types` file.
 * See `electron/cs3/userDataReset.ts` for what is and is not erased.
 */
export interface UserDataArea {
  id: string;
  label: string;
  /** One sentence: what goes. */
  description: string;
  /** Ticked when the dialog opens. */
  defaultSelected: boolean;
  /** How many items would go; null when unknown. */
  count: number | null;
}

export interface UserDataSummary {
  areas: UserDataArea[];
  /** What is never touched, in words. */
  preserved: string[];
}

export interface UserDataResetRequest {
  areas: string[];
  /** Also delete finished video files from disk. Off unless asked for. */
  deleteDownloadedFiles?: boolean;
  /** Save a backup of the chosen data before erasing (default on). */
  keepCopy?: boolean;
}

export interface UserDataResetResult {
  ok: boolean;
  cleared: string[];
  failed: Array<{ id: string; error: string }>;
  /** Where the safety copy was written, when one was. */
  backupPath?: string;
  error?: string;
}
