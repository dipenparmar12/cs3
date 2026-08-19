import { builtinModules } from 'node:module';
import { spawn, type ChildProcess } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import electronBin from 'electron';

import pkg from './package.json' with { type: 'json' };

let electronProcess: ChildProcess | null = null;

/**
 * Main-process externals.
 *
 * Everything in `dependencies` is left as a runtime import rather than bundled.
 * This is not just a size optimisation — it is required for correctness:
 *
 *  - `webtorrent` depends on **native** modules (`node-datachannel`, `utp-native`).
 *    Bundling them rewrites the module's internal relative path to its `.node`
 *    binary, which then resolves against `dist-electron/` and fails at load with
 *    `Cannot find module '../../../build/Release/node_datachannel.node'`.
 *  - A `.node` binary cannot be represented in a JS bundle at all, so the only
 *    correct treatment is to leave the requiring package external and let Node
 *    resolve it from `node_modules` at runtime.
 *
 * Node builtins are listed in both bare (`fs`) and prefixed (`node:fs`) form
 * because dependencies use both spellings.
 */
const nodeBuiltins = [
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
];

const runtimeDependencies = Object.keys(pkg.dependencies ?? {});

const mainProcessExternals = [
  'electron',
  ...nodeBuiltins,
  ...runtimeDependencies,
];

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        // Main-process entry point
        entry: 'electron/main.ts',
        async onstart(options) {
          if (electronProcess) {
            electronProcess.kill();
            electronProcess = null;
          }
          // `spawn UNKNOWN` (errno -4094) is a known flaky Windows failure: it
          // happens when the OS/antivirus has electron.exe locked for scanning
          // at the exact moment child_process.spawn() opens it. It is transient,
          // not a real problem with the binary, so retry a few times before
          // falling back to a shell-mediated spawn.
          const maxAttempts = 3;
          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
              await options.startup();
              return;
            } catch (err) {
              console.warn(
                `[vite-plugin-electron] startup attempt ${attempt}/${maxAttempts} failed: ${(err as Error).message}`,
              );
              if (attempt === maxAttempts) {
                console.warn('[vite-plugin-electron] falling back to shell spawn...');
                electronProcess = spawn(electronBin as unknown as string, ['.'], {
                  stdio: 'inherit',
                  shell: true,
                });
              } else {
                await new Promise((resolve) => setTimeout(resolve, 300));
              }
            }
          }
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: mainProcessExternals,
            },
          },
        },
      },
      {
        entry: 'electron/preload.ts',
        onstart(options) {
          options.reload();
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              // The preload script is pure IPC plumbing and imports nothing
              // beyond electron itself, but keep builtins external for safety.
              external: ['electron', ...nodeBuiltins],
            },
          },
        },
      },
    ]),
    renderer(),
  ],
  server: {
    port: 5173,
  },
});
