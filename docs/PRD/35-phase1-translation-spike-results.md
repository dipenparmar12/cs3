# 35 — Phase 1 Translation Spike: Measured Results

**Generated:** 2026-08-12
**Corpus:** 392 `.cs3` plugins from the `builds` branches of 24 reachable community repositories, fetched 2026-08-12
**Reproduce:** [`tools/dex-spike`](../../tools/dex-spike/)
**Status:** Complete. Supersedes the estimates in [31](31-cs3-dropin-compatibility.md) §2.3, §7 and closes OQ-27.

---

## 1. Why this ran first

[31](31-cs3-dropin-compatibility.md) §Next-steps opens with an instruction:

> **Fund and run the Phase 1 translation spike (OQ-27) before anything else in this document.** RISK-D1 can invalidate the whole approach, and it is cheap to test.

RISK-D1 is the risk that DEX→JVM translation mishandles Kotlin coroutine state
machines. Every CloudStream provider is coroutine-heavy, so a defect there would
be systemic, not long-tail. This document reports what happened when that test
was actually run against the whole ecosystem rather than a sample.

---

## 2. Headline result

**RISK-D1 is retired.** Translation is not the risk the plan assumed it was.

| Measure | Result |
|---|---|
| Plugins in corpus | 392 |
| Translated without error | **392 (100%)** |
| Classes emitted | 18,217 |
| Classes failing ASM structural verification | **0** |
| Entry class (`manifest.pluginClassName`) lost in translation | **0** |
| Suspend-shaped methods translated | 18,631 |
| **Kotlin coroutine state machines translated** | **6,617** |
| **State machines failing verification** | **0** |

Translator: **dex2jar 2.4.38** (the maintained `de.femtopedia` fork, Maven
Central, Apache-2.0 — compatible with the project's GPL-3.0).

The alternative candidate named in doc 31, `dex-translator`, was not needed: the
first candidate cleared the bar completely, and there is no measurement that
would distinguish them on this corpus.

---

## 3. Ground truth, not self-assessment

A translator that verifies its own output only proves internal consistency. Three
of the surveyed repositories — `recloudstream/extensions`, `phisher98`,
`Reflex755` — publish the pre-dex `.jar` beside each `.cs3`. That is the
publisher's own `kotlinc` output, which makes it ground truth.

| Measure | Result |
|---|---|
| Plugins with a publisher-built reference jar | 53 |
| Reference classes | 1,573 |
| Classes missing after translation | 4 (0.25%) |
| Classes whose method set differs | 54 (3.4%) |
| **Real methods lost** | **0** |

Both divergences are fully explained, and neither is a translation defect:

- **The 4 missing classes are all `BuildConfig`.** R8 strips it during dexing, so
  it was never in the DEX to translate.
- **All 54 method-set differences are `$r8$lambda$*` synthetics** that the
  translated output *has* and the reference jar does not. The reference jar is
  built **before** R8 runs; the `.cs3` is dexed **after**. The diff is therefore
  measuring R8's lambda desugaring, not dex2jar's fidelity — and its direction
  (translated output is a superset) is what confirms that.

`DiffDetail` classifies every divergence, and the count in the
`REAL METHOD LOST` bucket is zero.

---

## 4. The correction that matters more than the headline

Doc 31 §2.3 estimated the Android compatibility surface by counting `android.*`
**imports in provider Kotlin source**, and concluded that stubbing five types
would cover ≈93% of providers.

Measuring **type references in the shipped, translated bytecode** gives a very
different picture, because a `.cs3` also contains CloudStream library code that
R8 inlined into it — code that must link even though it appears in no provider's
import list.

| Android type | Doc 31 §2.3 (source imports) | Measured (translated bytecode) |
|---|---|---|
| `android.content.Context` | 4 files | **299 of 392 plugins** |
| `android.content.SharedPreferences` | 8 files | **112 plugins** |
| `android.util.Log` | 77 files | 91 plugins |
| `android.util.Base64` | 16 files | 50 plugins |
| `android.content.pm.PackageManager` | ≤3 files | **93 plugins** |
| `android.app.Activity` | — | **68 plugins** |
| `android.view.View` | in the "2.7% UI toolkit" bucket | **47 plugins** |
| `android.view.ViewGroup` | in the same bucket | **43 plugins** |
| `android.widget.TextView` | in the same bucket | **39 plugins** |

**189 distinct `android.*` types** are referenced across the corpus, not the
handful implied by the import histogram.

### What this does and does not mean

It does **not** mean 47 plugins draw Android views on desktop. The JVM resolves
lazily: a type named only inside a method that never runs is never loaded. Most
of these references sit in settings dialogs and other cold paths.

It does mean two things:

1. **Doc 31 §7's tier estimates (~68% T1) are not supported by this evidence**
   and must not be quoted as measured. They were projections from a method that
   systematically undercounts. DROP-30 already required replacing them with
   measured values; this is the measurement that shows why.
2. **The shim cannot be a fixed list of five types.** The sound design is the one
   DROP-7 already specifies — every unimplemented `android.*` member throws a
   named `UnsupportedAndroidApiException` — with the implemented set grown from
   what plugins actually *reach* at runtime, which is a smaller and different set
   from what they reference.

---

## 5. The runtime classpath, measured

896 distinct external types are referenced across the corpus. Bucketed by owner:

| Owner | Distinct types | Who supplies it |
|---|---|---|
| `com.lagradost.*` | 197 | `library-jvm.jar` + `cs3-app-shim.jar` |
| `android.*` | 189 | `cs3-android-shim.jar` |
| JDK | 186 | the bundled JRE |
| `kotlin` / `kotlinx` | 155 | kotlin-stdlib, coroutines |
| other third-party | 89 | bundled with the sidecar |
| okhttp / okio | 32 | bundled |
| Jackson | 20 | bundled |
| Jsoup | 11 | bundled |
| Gson | 7 | bundled |
| Rhino | 6 | bundled |
| `org.json` | 4 | bundled |

The most-referenced provider API types, which fixes the shim's priority order:

| Type | Plugins |
|---|---|
| `com.lagradost.cloudstream3.MainAPIKt` | 391 |
| `com.lagradost.cloudstream3.MainAPI` | 389 |
| `com.lagradost.nicehttp.Requests` | 388 |
| `okhttp3.Interceptor` | 388 |
| `com.lagradost.cloudstream3.TvType` | 388 |
| `org.jsoup.nodes.Document` | 315 |
| `com.lagradost.cloudstream3.plugins.Plugin` | 324 |
| `com.fasterxml.jackson.databind.ObjectMapper` | 231 |

**Third-party libraries are not bundled inside the `.cs3`.** They are `compileOnly`
against the host, so the sidecar must supply them. All are on Maven Central.

---

## 6. The one blocker that remains

`library-jvm.jar` — the provider API those 197 `com.lagradost.*` types come from
— is published **only through JitPack**
(`com.github.recloudstream.cloudstream:library`). It is not on Maven Central.

This is a build-time supply-chain fact, not a design problem: a normal CI runner
or developer machine resolves it fine. It does mean the artifact must be fetched
at build time and shipped with the app, and that the shim's ABI has to be diffed
against it (DROP-10/DROP-11).

Until it is present on the sidecar's classpath, every plugin classifies as
`T4_BLOCKED` with `com.lagradost.cloudstream3.plugins.BasePlugin` named as the
missing critical type. That is the correct and honest behaviour, and it is what
the sidecar reports today.

---

## 7. Corrections to earlier documents

| Document | Claim | Correction |
|---|---|---|
| 31 §2.3 | Stubbing 5 `android.*` types covers ≈93% of providers | Not supported. 189 distinct `android.*` types are referenced in shipped bytecode; §4 above. |
| 31 §7 | ~68% T1, ~7% T2, ~3% T3 | Unverified projections. Real tiers require execution against the provider API (§6). |
| 31 §4.2 RISK-D1 | Highest-severity unknown, Critical | **Retired.** 392/392, zero verification failures, zero coroutine failures. |
| 31 §4.1 Tier A | Source-rebuild the 26 repos to avoid translation risk | **No longer justified by risk.** Translation carries no measured risk, and Tier A costs a Kotlin toolchain, per-repo build maintenance and drift from what users actually install. Recommend dropping Tier A and treating translation as the single path. |
| `electron/official_repositories.json` | All 26 repos hosted under `recloudstream/` | Wrong for 23 of 26; those URLs 404. Corrected against `.gitmodules`. |

---

## 8. Corpus notes

- 24 of 26 vendored repositories had a reachable `builds` branch.
  `Abodabodd/re-3arabi` and `saimuelbr/saimuelrepo` did not clone and are absent
  from the corpus.
- One plugin (`cs-Karma/Filmmiraşım`) carries a non-ASCII filename. It translates
  correctly; the harness normalises filenames so a filesystem-encoding failure is
  not misreported as a translation failure.
- Only 53 of 392 plugins (13.5%) ship a companion `.jar`. A "use the publisher's
  jar when present" fast path would therefore cover a small minority, and given
  §2 it buys nothing — translation is not the risky step.

---

## 9. What this unblocks, in order

1. **Build `library-jvm.jar` in CI** and ship it on the sidecar classpath (§6).
   Everything else is gated on this.
2. **Grow the `android.*` shim from reached-at-runtime telemetry**, not from the
   reference histogram in §4 (DROP-8).
3. **Publish measured tier statistics** once execution is possible, replacing
   doc 31 §7 (DROP-30).
4. **Build the offscreen WebView bridge** (DROP-13..17) — still the largest piece
   of net-new work, and still without an upstream reference implementation.
5. **Close the sandbox gaps.** Network egress (DROP-23) and process creation
   (DROP-24) are *not* enforced today; the sidecar reports both rather than
   implying a guarantee it does not provide.
