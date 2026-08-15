import { builtinModules } from 'node:module';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';

import pkg from './package.json' with { type: 'json' };

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
