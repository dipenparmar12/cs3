# Development Setup

## Prerequisites
Windows 11 (Windows-first), Bun (lockfile `bun.lock`; npm works but churns it), Node 20+ (22 used), **Java 21+**
(the app and `SidecarSupervisor.resolveJava` prefer `tools/toolchain/jdk-*` over PATH; Maven is in
`tools/toolchain/apache-maven-3.9.16`, not on PATH). Run `tools/fetch_toolchain.mjs` to populate the toolchain.

## Fresh-clone build order
1. `cs3_windows/`: `bun install`.
2. **Sidecar → runtime-deps → bridge** (the sidecar produces the android shim the bridge compiles against; runtime-deps puts `library-jvm` in place):
   `mvn package` in `sidecar/`; `mvn -f sidecar/runtime-deps/pom.xml package`; `mvn -f sidecar/bridge/pom.xml package` (or `node tools/package/build-bridge.mjs` when JitPack is unreachable).
3. `node tools/package/build-runtime.mjs --verify` → `sidecar/dist/`; `node tools/package/build-media-runtime.mjs --verify` → `cs3_windows/media-runtime/` (ffmpeg, ffprobe, mpv).
4. `bun run dev` — Vite on :5173; `vite-plugin-electron` launches Electron and rebuilds main/preload on change.

Submodules (`repositories/*`, `_cloudstream_ref_android`) are empty by default; do not `git submodule update --init --recursive` casually.

## Packaging
`bun run dist:win` (whole chain), `dist:win:fast` (reuse jars; trusts what is on disk), `dist:installer`, `dist:portable`;
`--quick` stores the payload uncompressed (never for a release), `--clean`, `--refresh`, `--relink`, `--skip-jvm/--skip-media`.
Stages are incremental by default. NSIS: per-user, no UAC; portable keeps userData beside the exe; x64 only. A running
`bun run dev` fails packaging (`EPERM … win-unpacked.tmp`). Verify `release/win-unpacked/resources/` has `media/` and `sidecar/`.

## Scripts (`cs3_windows/package.json`)
`dev`, `build` (`tsc && vite build`), `typecheck` (`tsc -b`), `test`/`test:electron`, `build:runtime`, `build:media`,
`electron:build`, `dist*`, `e2e:providers`, `e2e:network`, `e2e:sources`.
