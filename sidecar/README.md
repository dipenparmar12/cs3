# CloudStream Desktop JVM sidecar

Runs existing `.cs3` CloudStream extensions on Windows desktop **without a
rebuild and without maintainer action** — the drop-in commitment in
[docs/PRD/31](../docs/PRD/31-cs3-dropin-compatibility.md).

`.cs3` archives contain Android DEX bytecode compiled against a Kotlin provider
API. Node.js cannot execute that, so this sidecar exists: a separate JVM process
that translates the bytecode, loads it the way Android does, and answers the
Electron main process over JSON-RPC.

## Build

```bash
mvn package          # -> target/cs3-sidecar.jar, target/cs3-sidecar-android-shim.jar
mvn test             # 15 tests
```

## Try it

```bash
printf '%s\n' \
  '{"id":"1","method":"status"}' \
  '{"id":"2","method":"inspect","params":{"pluginId":"Youtube","path":"/path/to/Youtube.cs3"}}' \
| java -cp "target/cs3-sidecar.jar:target/lib/*" \
    com.cloudstream.desktop.sidecar.Main \
    --data-dir=/tmp/cs3 --runtime-classpath=/tmp/cs3/runtime
```

## Protocol

Line-delimited JSON on stdio. One request object per line in, one reply per line
out. **stdout carries RPC frames and nothing else** — plugin logs, JVM warnings
and stack traces are forced to stderr, because a single stray `println` from
plugin code would otherwise desynchronise the channel.

| Method | Does |
|---|---|
| `ping` | Liveness, Java version, pid |
| `status` | Whether plugins can be executed, and why not if they cannot |
| `inspect` | Translate + classify without executing. Safe on install. |
| `load` | Full Android-parity load sequence; returns registered providers |
| `unload` | `beforeUnload()`, then drop the class loader |
| `clearTranslationCache` | Drop cached translations (needed on translator upgrade) |

Every call has a hard timeout. A hung plugin fails its own call and leaves the
rest of the sidecar usable.

## How it works

1. **Translate** (`DexTranslator`) — DEX → JVM bytecode via dex2jar 2.4.38, once
   at install time, cached by archive SHA-256. The original `.cs3` is never
   modified. Failure is a reported outcome, never a thrown exception.
2. **Analyse** (`LinkageAnalyzer`) — resolve every referenced type against the
   runtime classpath and assign a compatibility tier.
3. **Load** (`PluginHost`) — reproduce Android's sequence exactly: read
   `manifest.json` *through the class loader*, `loadClass` the entry, construct
   reflectively, call `load(context)`, and observe self-registration.

### Why dex2jar, and why you can trust the translation step

Because it was measured, not assumed. Doc 31 rated DEX→JVM translation of Kotlin
coroutine state machines as the **critical** risk (RISK-D1) — every provider is
coroutine-heavy, so a defect would be systemic.

Against all 392 real community plugins: **392 translated, 18,217 classes emitted,
0 verification failures, 6,617 coroutine state machines, 0 failures.** Checked
against 53 publisher-built reference jars, **zero real methods were lost**.

Full results: [docs/PRD/35](../docs/PRD/35-phase1-translation-spike-results.md).
Reproduce: [`tools/dex-spike`](../tools/dex-spike/).

## Current limitation: the provider API

Plugins link against `library-jvm.jar` (`MainAPI`, `ExtractorApi`, `Plugin`, …),
which upstream publishes **only through JitPack**
(`com.github.recloudstream.cloudstream:library`) — not Maven Central. It must be
fetched at build time and placed on the sidecar's runtime classpath.

Until it is there, `inspect` works and every plugin classifies as `T4_BLOCKED`
naming `com.lagradost.cloudstream3.plugins.BasePlugin` as the missing type, and
`status` says exactly why. That is deliberate: an extension system that cannot
run must say so, not return empty results that look like "no matches found".

## Sandbox: what is and is not enforced

| Control | Status |
|---|---|
| Plugin cannot reach sidecar internals (DROP-12) | **Enforced** by `PluginClassLoader`, tested |
| `System.exit` cannot kill the app (DROP-26) | **Enforced** by the process boundary |
| `System.loadLibrary` (DROP-24, native half) | **Enforced** via empty `java.library.path` |
| Per-plugin scoped storage (DROP-12) | **Enforced**, tested |
| Raw network egress (DROP-23) | **Not enforced** — needs an OS-level sandbox |
| Process creation (DROP-24, exec half) | **Not enforced** — needs an OS-level sandbox |

The last two are reported by `status` as `sandboxGaps` and surfaced to the UI. A
gap that is named is a gap that can be closed; a gap that is implied to be
covered is one that never gets fixed.

Note that Java's `SecurityManager` is not an option — it is deprecated and being
removed (JEP 411/486), and DROP-25 forbids designs that assume it. The remaining
controls have to come from a Windows job object with a restricted token, applied
by the launcher.
