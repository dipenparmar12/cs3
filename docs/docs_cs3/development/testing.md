# Testing

* **Runner:** `cs3_windows/scripts/test-runner.mjs`; suites are auto-discovered (`*.test.mts`, Node type-stripping). `bun run test` (all), `bun run test --fast` (skips slow suites needing real ffmpeg/mpv), `bun run test <alias>` (kebab-case file name or a `PRESET_ALIASES` entry, e.g. `ipc`, `backup`, `address`), `bun run test --list` for the current set — do not trust a count written in a doc.
* **Pure vs real:** most suites are pure (stubbed transport, temp dirs, gated runners). `pipeline` (real ffmpeg), `native` (real mpv), `proxy`/`resume-window` (real sockets) skip themselves without their binaries. The mpv suite is deliberately not mocked: failures live in the seam between processes.
* **Lexical guards:** `ipcSurface` (channel parity), `componentReachability` (built-never-mounted; case collisions), `moduleReachability`, `settingsLevel` (≤50% advanced; no marking inside marked groups).
* **Mutation-verify** a regression test: break the fix again and watch it fail. Several first drafts passed trivially (asserting "resolved quickly" with the bug present; asserting "empty result" when a failing provider also returns empty).
* **Timing tests:** use gated stubs, not timers; a timing test for a latency fix passes on the machine that wrote it.
* **Sidecar:** `mvn test` in `sidecar/` (Java). `ShimSignatureTest` enforces that no shim widens a type to `Object`.
* **Live harnesses** (`tools/e2e/`) are not unit tests: they hit third-party hosts and must be run deliberately; liveness is never asserted in the unit suite.
* **No CI:** `.github/` holds no workflows; run tests yourself and say exactly what you ran.
