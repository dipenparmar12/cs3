import { spawn } from 'child_process';

export interface ToolResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
}

/**
 * Runs a tool and keeps everything it said.
 *
 * The version this replaced returned `string | null` — stdout on success, null
 * on any failure — which discarded the exit code, the stderr, and the difference
 * between "timed out" and "refused". ffprobe puts its entire diagnosis on stderr
 * ("Server returned 404", "Invalid data found", a TLS failure), so a failed
 * probe produced a null, then a generic "could not decode this file", then a
 * diagnostics report containing zero records. The tool had said exactly what was
 * wrong and it was thrown away.
 */
export function runTool(command: string, args: string[], timeoutMs: number): Promise<ToolResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (result: {
      ok: boolean;
      code: number | null;
      timedOut: boolean;
      spawnError?: string;
    }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: result.ok,
        stdout,
        stderr: (result.spawnError ? `${result.spawnError}\n` : '') + stderr,
        code: result.code,
        timedOut: result.timedOut,
      });
    };

    const proc = spawn(command, args, { windowsHide: true });
    const timer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      finish({ ok: false, code: null, timedOut: true });
    }, timeoutMs);

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    // Bounded: a failing ffmpeg can produce megabytes of repeated warnings, and
    // only the first part of that is ever read by anyone.
    proc.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 8_000) stderr += chunk.toString();
    });
    proc.on('error', (error) =>
      finish({ ok: false, code: null, timedOut: false, spawnError: error.message })
    );
    proc.on('close', (code) => finish({ ok: code === 0, code, timedOut: false }));
  });
}
