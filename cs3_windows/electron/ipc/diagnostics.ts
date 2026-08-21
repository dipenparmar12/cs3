import { handle, handleRaw } from './channel.ts';
import type { RegisterHandlers } from './services.ts';
import { DiagnosticsLog } from '../cs3/diagnostics';
import type { TitleOutcomeKind } from '../cs3/titleOutcomes';
import type { LogLevel, LogScope } from '../logging/logger';
import { app, shell } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Failure reports, and the structured log they are drawn from.
 *
 * Moved out of `main.ts` unchanged; see `services.ts` for why the dependencies
 * are named rather than reached for.
 */
export const registerDiagnosticsHandlers: RegisterHandlers = (services) => {
  const {
    datastore,
    diagnostics,
    logger,
    pluginManager,
    titleOutcomes,
  } = services;

  // --- diagnostics ---------------------------------------------------------------
  /**
   * The environment questions every bug report needs answered first.
   *
   * Collected here rather than asked of the user: "which Java" and "which build"
   * are the two things a reporter is least able to find and the two a maintainer
   * asks for immediately.
   */
  async function diagnosticsEnvironment(): Promise<Record<string, string>> {
    let runtime = 'unknown';
    try {
      const status = await pluginManager.getRuntimeStatus();
      runtime =
        `available=${status.available} plugins=${status.installedCount}` +
        (status.javaVersion ? ` java=${status.javaVersion}` : '') +
        (status.reason ? ` — ${status.reason}` : '');
    } catch {
      // A runtime that cannot even be queried is itself worth reporting as such.
    }
    return {
      App: app.getVersion(),
      Electron: process.versions.electron ?? 'unknown',
      Node: process.versions.node ?? 'unknown',
      Platform: `${process.platform} ${os.release()}`,
      'Extension runtime': runtime,
      Providers: String(pluginManager.getProvidersList().length),
    };
  }

  /**
   * Problems by default, everything on request.
   *
   * The log now records successes too, because reproducing a failure needs the
   * session around it — but a panel where every successful search scrolls past
   * the one error is not a debugging tool.
   */
  handle('diagnostics:list', (limit?: number, levels?: Array<'error' | 'warn' | 'info'>) => ({
    records: diagnostics.list(limit ?? 200, levels ?? ['error', 'warn']),
    total: diagnostics.all().length,
    filePath: diagnostics.filePath,
  }));

  handle('diagnostics:clear', () => {
    diagnostics.clear();
    return {};
  });

  // --- the structured log --------------------------------------------------------
  /**
   * `log:*` is the developer-facing surface, deliberately thin.
   *
   * The log's job is to be on disk when something goes wrong, not to be browsed;
   * a large UI over it would be effort spent on the wrong half. What is exposed
   * is what a person actually needs at the moment they are debugging: query the
   * recent past, find the file, open the folder, and turn the level up for the
   * next reproduction attempt.
   */
  handle(
    'log:query',
    (filter?: {
      level?: LogLevel;
      scopes?: LogScope[];
      event?: string;
      search?: string;
      since?: number;
      limit?: number;
    }) => ({
      records: logger.query(filter ?? {}),
      session: logger.session,
      level: logger.level,
      file: logger.logFile,
    }),
    { records: [], session: '', level: 'info' as LogLevel, file: '' }
  );

  handle(
    'log:sessions',
    () => {
      // Flushed first, or the current session under-reports its own size by
      // however much is sitting in the write buffer.
      logger.flush();
      return { sessions: logger.sessions(), directory: path.dirname(logger.logFile) };
    },
    { sessions: [], directory: '' }
  );

  /**
   * The level is persisted, because the thing it is turned up for is a bug that
   * has not happened yet. A `trace` setting that reset on restart would be off
   * again by the time the user managed to reproduce anything.
   */
  handle(
    'log:setLevel',
    (level: LogLevel) => {
      logger.setLevel(level);
      datastore.setString('log_level_key', level);
      logger.info('app', 'log_level_changed', { level });
      return { level };
    },
    // The level the logger is *actually* at, so a rejected change leaves the
    // settings control showing the truth rather than the value that failed.
    () => ({ level: logger.level })
  );

  handle('log:reveal', () => {
    logger.flush();
    shell.showItemInFolder(logger.logFile);
    return {};
  });

  /**
   * The whole current session as text, for attaching to a report.
   *
   * Read back off disk rather than served from the ring: the ring holds the last
   * couple of thousand records and the file holds the session, and a report that
   * silently omits the beginning is worse than one that is large.
   */
  handle(
    'log:exportSession',
    () => {
      logger.flush();
      return { text: fs.readFileSync(logger.logFile, 'utf8'), file: logger.logFile };
    },
    () => ({ text: '', file: logger.logFile })
  );

  /**
   * A pasteable report, in one of two sizes.
   *
   * `mode: 'current'` is the one that was missing. Every report used to be the
   * whole session — up to three hundred entries — which is unusable in both
   * directions: whoever receives it has to find the failure being described, and
   * whoever sends it has pasted their entire evening's viewing into a chat
   * window without meaning to. Narrowing to the failure on screen is the common
   * case; the full log is for an issue about the app itself.
   *
   * Both are deduplicated, and the full one especially: a provider failing on a
   * loop produces the same line hundreds of times, and an occurrence count says
   * everything the repetition did.
   */
  handle(
    'diagnostics:report',
    async (
      options: {
        ids?: string[];
        mode?: 'current' | 'full';
        context?: Parameters<DiagnosticsLog['selectForContext']>[0];
      } = {}
    ) => {
      const mode = options.mode ?? 'full';
      const all = diagnostics.all();

      let chosen = all;
      let contextMatched: boolean | undefined;

      if (options.ids?.length) {
        chosen = all.filter((record) => options.ids!.includes(record.id));
      } else if (mode === 'current' && options.context) {
        const selection = diagnostics.selectForContext(options.context);
        chosen = selection.records;
        contextMatched = selection.matched;
      } else {
        // Reports carry everything retained, successes included: the run that
        // worked is the control for the one that did not.
        chosen = all.slice(0, 300);
      }

      return {
        text: diagnostics.report(chosen, await diagnosticsEnvironment(), {
          mode,
          context: options.context,
          contextMatched,
        }),
        records: chosen.length,
      };
    },
    { text: '', records: 0 }
  );

  /** Lets the renderer record what only it can see, such as a playback failure. */
  handle('diagnostics:record', (entry: Parameters<DiagnosticsLog['record']>[0]) => {
    diagnostics.record(entry);
    return {};
  });

  /**
   * What happened last time each title was opened.
   *
   * Read once per search rather than per row, so the grid can mark dead entries
   * without a round trip for every poster on screen.
   */
  handleRaw('api:getTitleOutcomes', () => titleOutcomes.list());

  handle(
    'api:recordTitleOutcome',
    (url: string, kind: TitleOutcomeKind, reason?: string) => {
      titleOutcomes.record(url, kind, reason);
      return {};
    }
  );
};
