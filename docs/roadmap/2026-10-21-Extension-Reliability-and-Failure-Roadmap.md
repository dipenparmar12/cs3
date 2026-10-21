# Extension reliability & failure roadmap — CloudStream 3 Desktop

**Source of truth:** the 2026-10-21T08:08 diagnostic report (app 1.0.0, Electron 43.4.0, win32, java 21.0.2, runtime available, plugins=1076, providers=1006, query `dhobi ghat`).

**Status:** Unverified against the code. This doc proposes work; each item names file:line evidence and a `needs-app-run` where a human must confirm on a real desktop. Treat as a proposal until checked.

**Governing rule — count before fixing.** Do not fix a message; fix the category it represents, and only after the `extensionIssues.log` tally shows the category is worth the effort. The six-missing-classes finding (113 load failures → 6 missing classes) is the precedent: a raw list sends you fixing symptoms; a tally shows the causes. `desktop/electron/cs3/extensionIssues.ts` is the durable ledger keyed by `(cause, source, groupingForm(message))`; `desktop/electron/cs3/failureTaxonomy.ts` classifies each message into one closed set of kinds. Reuse both — never add a new classification scheme.

## 1. What the report actually says

| Field | Value |
|---|---|
| Unique errors | 16 |
| Unique diagnostic events | 20 |
| Unique sources/URLs | 7 |
| Unique providers | 12 |
| Total logged events | 20 (compressed to 20) |
| Failures by cause (diagnostic events) | 5 × Timed out, 2 × Unclassified, 1 × Extension error |

The diagnostic *events* section is only the tip. The "What was on screen" block lists every provider failure returned for the query — that is the material to act on. Grouped by root cause they fall into eight categories below.

## 2. Failure catalogue by root cause

Each category: examples from this report, root cause, code location, severity, next step, acceptance.

### A — JVM truststore / TLS (SSLHandshakeException / SSLPeerUnverifiedException)

**Examples from report.** `DisneyMirror`, `NetflixMirror`, `PrimeVideoMirror`, `UgurFilm`, `MyCima`, `HDFilme`, `Cinemathek`, `Dizikorea`, `Duboku`, `MegaFlix`, `UltraCine` — `PKIX path building failed: unable to find valid certification path to requested target`. `SezonlukDizi` — `Remote host terminated the handshake`. `SuperFilmGeldi` — `Received fatal alert: handshake_failure`. `Gomunime` — `SSLPeerUnverifiedException: Hostname 185.231.223.76 not verified … DN: CN=namensmij.nl` (cert/name mismatch).

**Root cause.** The bundled JRE's `cacerts` keystore lacks intermediates/roots that unofficial provider domains serve (re-issued LE/Cloudflare certs, self-signed or cross-signed chains). The stock JVM treats SNI warnings and name mismatches as fatal where Android's Conscrypt did not. Hostname verification is strict on the JVM side.

**Code location.** Sidecar JVM truststore (bundled `cacerts`, set at runtime provisioning — `desktop/electron/cs3/runtimeProvisioner.ts` generations). TLS strictness is noted as not built in `docs/agents/extensions.md` §TLS strictness and `docs/agents/field-notes/extensions.md:528` (`unrecognized_name` precedent). `desktop/electron/cs3/failureTaxonomy.ts:122` already routes SSL/TLS/handshake/certificate messages into the `network` kind — so these **do not** count against the provider in ranking, which is correct.

**Severity.** P1 — high provider coverage, but environmental (the site's cert), not an app defect.

**Next step.** Count first: query `extensionIssues.log` by cause=`network` + source containing the SSL hosts, across sessions, to confirm this is recurring and not one bad night. If recurring, inject modern Let's Encrypt/Cloudflare roots into the bundled runtime keystore (per `docs/roadmap/unverified/2026-10-050-errors_need_to_resolve.md` item 7 / session handoff line 56 "PKIX/SSL is JVM truststore — count before acting"). Do **not** disable SNI globally (`docs/agents/extensions.md`).

**Acceptance.** Tally shows the category shrank after a JRE/rebuild; no provider is ranked down for a cert failure.

### B — Dead hosts / DNS (UnknownHostException / No such host is known)

**Examples from report.** `JioHotstar`, `Netflix`, `PrimeVideo` (net22.cc ×3), `Time4tv` (dlhd.sx), `Tv247` (tv247.us), `FullyMaza` (fullymaza.qpon), `TokusatsuUltimate` (toku555.com), `TokuZilla` (tokuzilla.net), `ReyDonghua` (reydonghua.org), `Esheaq` (esheeq.study), `Dizilla` (dizilla40.com), `InatBox` (boxyz.cfd), `RecTV` (m.prectv50.sbs), `Altadefinizione` (altadefinizionegratis.center), `DiziYou` (www.diziyou.mx), `FilmBip` (filmbip.com), `FullHDFilmizlesene`, `GuardaPlay` (guardaplay.store), `OxAx` (ythls.kekikakademi.org), `TopMovies` (moviesleech.club), `Neonime` (neonime.ink), `NontonAnimeID`, `Otakudesu`, `Phimmoichill`, `KitaNonton`, `Rebahin`, `XCine` (api.xcine.ru), `Yomovies` (yomovies.town), `NetCine` (nnn1.lat), `Cinefreak [Backup]` (cinefreak.nl), `EmwBD`, `(BDIX) RoarZone TV` (tv.roarzone.info).

**Root cause.** Piracy/streaming domains are seized, abandoned, or short-lived; plugins hardcode them. `failureTaxonomy.ts:122-128` classifies `UnknownHost`/`ENOTFOUND`/Chromium `ERR_NAME_NOT_RESOLVED` as `network`. Correct — DNS failure is not the extension's fault.

**Severity.** P1 — environmental; the app must not punish the provider, and must not present a dead domain as "no results" without a reason.

**Next step.** Confirm via the ledger tally (cause=`network`, source=dead host). Then: (1) keep `network` unscored (`UNSCORED_FAILURE_KINDS` does not include `network`, and ranking treats it as a real failure — verify intent: a dead domain *should* eventually depress the provider since it can never answer from here); (2) surface an honest reason on the row ("host does not resolve") so the viewer does not conclude the app is broken; (3) consider a stale-domain review path rather than manual removal.

**Acceptance.** Dead-host rows show a reason, not a silent empty result; ranking does not treat one DNS failure as permanent.

### C — Timeouts (SocketTimeoutException / InterruptedIOException / Connect timed out / Read timed out / "did not answer within 50000 ms")

**Examples from report.** `Streamed`, `Streamed Sports`, `DramaFull🌺`, `Watch2Movies`, `5movierulz` (Connect timed out), `9kMovies`, `MoviPK` (InterruptedIOException), `KissKH` (Search API failed after retries), `DoramasLatinoX`, `Cinedoze`, `India4Movies`, `World4uFree`, `SyriaLive`, `FilmModu` (Connect timed out), `KultFilmler`, `WebteIzle`, `CtgStream` (Connect timed out), `Joya9Tv` (Connect timed out), `EinschaltenIn`, `Cinefreak`, `FibWatch`, `Tamilblasters`, `WCO Fun`, `Movie4k`, `Mlsbd`, `TamilDhool`, `TamilUltra`, `Oppadrama` (Connect timed out), `Huhu`, `KinoKiste`, `Streamcloud`, `XcineRU`, `WatchMoviesPk`, `NgeFilm21`, `(BDIX)` ×7, `YTS MX` (50000 ms). Diagnostic events also: `WatchMoviesPk`, `India4Movies`, `CtgStream`, `Cinevood`, `YTS MX`, `Movix` links — all timeouts.

**Root cause.** Slow hosts, ISP throttling/blocks, Cloudflare verification delays. The host budget is `sidecarSupervisor.ts:32` `CALL_TIMEOUT_MS = 60_000` for RPC calls and `webViewHost.ts:283` `60_000` default for browser resolves, shaped by `hostDeadline.ts` (floor 1000 ms, reserve 1500 ms, max 25% of deadline). Search fan-out caps 8 in flight (`AGENTS.md` §4.2 `search:*`). `searchUnsupported` remembers "does not implement that operation" per launch so catalogue-only providers are not re-asked (~17×/day previously).

**Severity.** P1 — the dominant failure class in this report (5 of 8 diagnostic events).

**Next step.** Count first (cause=`timeout`, grouped by source). Then per `docs/agents/torrents-and-search.md` indexer budget: per-indexer deadline = p90 of its own successes × 2.5, clamped [4s, 20s]; cooldown escalates, any success resets. The 50s JVM deadline is coarse — consider per-provider deadlines derived from measured latency so a fast provider is not held behind a slow one, and so `rpc_queued` (already logged ≥1s in `RpcLanes.java`) is visible in the ledger. Do not silently widen scope after timeouts — a self-widened result is offered, never auto-started (`AGENTS.md` §7–8).

**Acceptance.** Per-provider deadlines replace the flat 50s where measured; timeouts group by source in the ledger; no auto-play after a widened search.

### D — Missing classes / shim gaps (NoClassDefFoundError)

**Examples from report.** `BingeCloud` — `android/util/LruCache`. `قصة عشق` — `com/lagradost/cloudstream3/syncproviders/providers/OpenSubtitlesApi`.

**Root cause.** The android shim does not provide a class the extension references, or a class exists but its descriptor differs from Android's so `Class.getMethod` (which resolves every public method's parameter/return types) fails at *describe* time — after registration, abandoning the load and naming a class nobody called (`runtimeProvisioner.ts:173-176`, the Toast precedent generation 14). `failureTaxonomy.ts:83` routes `NoClassDefFoundError`/`ClassNotFoundException` to `runtime-unavailable` — correctly "ours", not the extension's.

**Code location.** `desktop/electron/cs3/runtimeProvisioner.ts` (shim generations: gen 11 BottomSheetDialogFragment ×36, gen 14 Toast ×11, gen 16 `android.webkit.*`/layouts, gen 17 `Activity.isFinishing`/`isDestroyed`). Shim rule in `AGENTS.md` §5: "concede the type, refuse the operation; never widen to Object; never forge the package name." `ShimSignatureTest` enforces it.

**Severity.** P1 — the extension cannot load at all; every one of its providers is dead.

**Next step.** Count first (cause=`runtime-unavailable`, missingClass present). For each missing class, add a shim that concedes the type and refuses the operation (returns null/defaults, never throws), then bump `RUNTIME_GENERATION` (§3.5 provisioning) so already-provisioned copies get it. `cs3-provider-bridge.jar` must keep the same loader as `library-jvm.jar` or `BasePlugin` resolves as two classes (`AGENTS.md`).

**Acceptance.** Ledger shows no new `runtime-unavailable` rows for these classes after a generation bump; `PluginUnloadTest`/`ShimSignatureTest` pass.

### E — Kotlin non-nullable JSON deserialization (MissingKotlinParameterException / MismatchedInputException)

**Examples from report.** `PlutoTV` — `BootResponse.startingChannel` non-null NULL (JSON `"startingChannel"` missing). `Kinostrain` — `MovieItem.highlight.name` non-null NULL. `Arte` — `SearchApiResponse` has no int constructor for a Number `404` (a 404 HTML/body arrived where an object was expected). `FilmFrei24` — `MovieList` deserialized from a `VALUE_STRING`.

**Root cause.** The provider's reply is null for a non-nullable Kotlin field, returns an error/empty body where an object was expected, or the bridge's kotlinx.serialization schema does not match the actual JSON. The extension's code is fine; the data shape changed.

**Code location.** Sidecar bridge deserialization (Kotlin `kotlinx.serialization` in `sidecar/bridge/`), `desktop/electron/cs3/providerLinks.ts` (reads provider replies, does not guess). `failureTaxonomy.ts:149` `unreadable-reply` catches JSON parse failures; `provider-error` is the catch-all at line 151.

**Severity.** P1 — a whole provider's main page or search returns nothing because one field is missing.

**Next step.** Count first (cause=`provider-error` or `unreadable-reply`, source=PlutoTV/Kinostrain/Arte/FilmFrei24). Then make the bridge tolerant of absent non-nullable fields where the schema allows (default for `startingChannel`, `name`), and treat a non-object reply (404/HTML) as `unreadable-reply` with a clear reason rather than a deserialization crash. Add a regression fixture from the truncated PlutoTV payload (`BootResponse` with `startingChannel` absent).

**Acceptance.** PlutoTV main page resolves despite absent `startingChannel`; Arte 404 body yields `unreadable-reply`, not a crash; tests pin the truncated payloads.

### F — HTML / wrong content type instead of expected data (JsonParseException / JSONException / InvalidHeader)

**Examples from report.** `CalcioStreaming` — `Unexpected character '<' … <!DOCTYPE html>` (DiretteCommunity HTML page). `DiziPal` — Cloudflare "Just a moment…" interstitial parsed as JSON. `SetFilmIzle` — `A JSONObject text must begin with '{'`. `Gomunime.is` — `Invalid Json reponse`. `Japan IPTV`, `Pirate IPTV`, `Sony IPTV`, `Sports IPTV` — `InvalidHeader: Header doesn't start with #EXTM3U` (playlist URL now serves an HTML block page or redirect).

**Root cause.** The provider serves a Cloudflare challenge page, an error page, an HTML block page, or a redirect where the extension expected JSON/M3U. `failureTaxonomy.ts:148-149` routes these to `unreadable-reply` — correctly "the page changed shape," actionable by checking/replacing the source, not by reporting the maintainer.

**Severity.** P1 — four IPTV providers fail identically on every search; read as scattered noise unless grouped.

**Next step.** Count first (cause=`unreadable-reply`, grouped by source). Then: (1) confirm Cloudflare challenges reach `webViewHost` clearance (`clearance.get` single-flight, 10-minute cooldown, Chrome-shaped UA — `AGENTS.md` §5.15); (2) where a host now serves HTML permanently, offer a reason on the row ("site changed shape") rather than a raw parse exception; (3) do not retry an HTML answer as JSON.

**Acceptance.** HTML/reject replies group under one `unreadable-reply` row per source; clearance handles challenges instead of passing the interstitial to the parser.

### G — Null URL / missing scheme (IllegalArgumentException: Expected URL scheme http or https … null)

**Examples from report.** `DramaDrip` — `null/?…`. `Jellyfin` — `null/U…`. `StremioC` — `/manif…` (scheme missing).

**Root cause.** The provider returned a null handle/URL and the app passed it downstream as a fetchable address. `AGENTS.md` §5 rule: "Provider links are read, not guessed"; `cs3/extensionAddress.ts` distinguishes a links handle (`looksLikeLinksHandle`, opaque blob) from a page address (`looksLikePageAddress`, fetchable URL). Storing one as the other is how saved rows open blank.

**Severity.** P1 — the provider produced nothing usable; the app should report "no links" rather than a scheme exception.

**Next step.** Count first (cause=`provider-error` on the IllegalArgumentException, source=each). Then harden `providerLinks.ts` / `extensionAddress.ts` so a null handle becomes an empty, reason-carrying result ("provider has no links for this item") and never reaches a URL constructor. `loadLinks` takes an opaque provider blob; `load` takes a fetchable URL — keep them distinct.

**Acceptance.** Null-scheme provider returns an honest empty-with-reason, never `IllegalArgumentException`; saved rows do not store a handle as an address.

### H — Provider errors & edge cases (NullPointerException, StackOverflowError, login walls, redirect loops, HTTP 502)

**Examples from report.** `DiziKorea` — `NullPointerException: no detail`. `Toonix` — `StackOverflowError: no detail`. `izzi go` — `ErrorLoadingException: requires an active subscription / log in`. `Kartoons` — `ErrorLoadingException: not logged in`. `Frembed` — `ErrorLoadingException: HTTP 502` (domain registry). `Phim1080` — `ProtocolException: Too many follow-up requests: 21` (redirect loop). `DramaDrip` (category G) also `IllegalArgumentException`.

**Root cause.** Provider-side bugs (NPE, stack overflow), login/pay walls, a registry returning 502, or an OkHttp redirect loop. These are not app defects; `failureTaxonomy.ts:151` `provider-error` is the catch-all and the hint tells the viewer to report it to the maintainer.

**Severity.** P2/P3 — low coverage per provider, but noisy in the ledger if ungrouped.

**Next step.** Count first (cause=`provider-error`, by source). Then: (1) `Phim1080` redirect loop — cap follow-ups and classify as `network`/`unreadable-reply` rather than a provider crash; (2) login walls (`izzi go`, `Kartoons`) — surface "account required" as a provider-level message, not a failure, so the viewer knows the fix is on the provider side; (3) `Frembed` 502 — transient, retry once then `server-error`.

**Acceptance.** Login walls show a reason, not an error; redirect loop capped; each category groups to one ledger row per source.

## 3. Roadmap items

| ID | Severity | Item | Evidence / file | Fix | Acceptance |
|---|---|---|---|---|---|
| R-01 | P1 | Count failures before fixing anything | `extensionIssues.ts`, `failureTaxonomy.ts`; this report | Run the ledger tally (by cause and by source) against this session + prior `cs3-diagnostics.json`/`cs3-extension-issues.json`; only then pick fixes | A tally exists and drives the fix order |
| R-02 | P1 | JVM truststore: PKIX path building failures | `runtimeProvisioner.ts` (JRE/cacerts), `docs/agents/extensions.md` TLS strictness | Inject LE/Cloudflare roots into bundled JRE keystore; count first | SSL providers resolve; no provider ranked down for cert |
| R-03 | P1 | Dead-host rows show a reason | `failureTaxonomy.ts:122` network rule; `extensionIssues.ts` | Surface "host does not resolve" per dead source | Viewer sees a reason, not silent empty |
| R-04 | P1 | Per-provider timeouts instead of flat 50s | `sidecarSupervisor.ts:32` `CALL_TIMEOUT_MS=60_000`; `hostDeadline.ts`; `webViewHost.ts:283` | Derive per-indexer deadline = p90×2.5 clamped [4s,20s]; log `rpc_queued` | Fast providers not held by slow ones |
| R-05 | P1 | Shim missing classes | `runtimeProvisioner.ts` generations; `ShimSignatureTest`; `AGENTS.md` shim rule | Add `concede type, refuse operation` shims for `LruCache`, `OpenSubtitlesApi`; bump `RUNTIME_GENERATION` | Extensions load; `ShimSignatureTest` passes |
| R-06 | P1 | Tolerate absent non-nullable Kotlin fields | `sidecar/bridge/` kotlinx.serialization; PlutoTV/Kinostrain/Arte/FilmFrei24 payloads | Default `startingChannel`, `name`; treat non-object reply as `unreadable-reply` | PlutoTV main page resolves; Arte 404 → unreadable-reply |
| R-07 | P1 | Cloudflare HTML → unreadable-reply, not parser crash | `failureTaxonomy.ts:148-149`; `clearance.ts` single-flight | Route challenge pages to `clearance.get`; group HTML answers per source | DiziPal/CalcioStreaming group under one row |
| R-08 | P1 | Null handle never becomes a URL | `providerLinks.ts`; `cs3/extensionAddress.ts` | Null handle → empty result with reason; keep `loadLinks`/`load` distinct | No `IllegalArgumentException: URL scheme` |
| R-09 | P2 | Login/pay walls as reason, not failure | `izzi go`, `Kartoons` messages | Surface "account required" as provider-level message | Viewer knows the fix is provider-side |
| R-10 | P2 | Redirect loop cap | `Phim1080` `Too many follow-up requests: 21` | Cap OkHttp follow-ups; classify as network/unreadable-reply | No StackOverflow-like provider crash |
| R-11 | P3 | Ledger retention & visibility | `extensionIssues.ts` `MAX_ISSUES=1500`, `MAX_PLUGINS_PER_ISSUE=12` | Confirm the ledger survives restarts and this report's categories persist | `getIssueLog` returns rows across launches |

## 4. Shared mechanisms already in place (reuse, do not duplicate)

- `desktop/electron/cs3/failureTaxonomy.ts` — one closed set of `FailureKind`; `UNSCORED_FAILURE_KINDS` (`cancelled`, `provider-missing`, `unsupported-operation`, `resource-leak`) must not be scored against providers. `network` and `timeout` **are** scored — verify that intent before changing.
- `desktop/electron/cs3/extensionIssues.ts` — durable ledger keyed by `(cause, source, groupingForm(message))`; survives restarts; `muted` hides without forgetting; `bySource()` shows where effort pays. `getIssueLog()` is null until `setIssueLog()` runs — do not let it silently drop a session's problems.
- `desktop/electron/cs3/diagnostics.ts` — per-failure tuple (provider, query, title, url, stage, level) capped at 20k / 6 months; `selectForContext()` returns only records matching the failure on screen so pasted reports are not the whole history.
- `desktop/electron/cs3/hostDeadline.ts` — host finishes before the waiter (`DELIVERY_RESERVE_MS=1500`, `MIN_WORKING_MS=1000`, `MAX_RESERVE_FRACTION=0.25`); "the worker stops before the waiter does."
- `desktop/electron/cs3/sidecarSupervisor.ts` — `call()` times out at `CALL_TIMEOUT_MS + 2000`; the host waits slightly longer so the JVM's clean in-process timeout names the plugin.
- `desktop/electron/cs3/rpcResult.ts` — `isTransportFailure` distinguishes "runtime never answered" from "the answer was no"; `providerLatencyMs` subtracts `queuedMs`.

## 5. What must not change

- Never widen a shim parameter/return to `Object` (renames the method; `ShimSignatureTest` enforces). Never forge a package name. Never fake a platform number (`AGENTS.md` §5 shim rule).
- Never record `cancelled` calls as extension errors — they are the app's own decision to stop waiting (`failureTaxonomy.ts:42-44`).
- Never auto-start a widened search result; a self-widened result is offered, never played (`AGENTS.md` §7–8 rule; `playbackFailover.test.mts`).
- Never store a links handle as a page address (`cs3/extensionAddress.ts`).
- Never rank a provider down for `network`/SSL/DNS failures that are environmental — verify the scoring intent before touching `UNSCORED_FAILURE_KINDS`.

## 6. Verification checklist

- [ ] `tsc -b` exits 0
- [ ] `bun run test --fast` passes; `failureTaxonomy`, `extensionIssues`, `hostDeadline` suites green
- [ ] Ledger tally run against this session + prior logs; fix order driven by counts
- [ ] Each fix has a regression test using a captured/truncated payload from this report (PlutoTV `BootResponse`, Kinostrain `highlight.name`, Arte 404 body, CalcioStreaming HTML)
- [ ] A human runs the app and reproduces one category on a real desktop (`needs-app-run`) before closing its item
- [ ] `AGENTS.md` and `docs/agents/*.md` updated in the same change if IPC/surface/runtime contract moves
- [ ] Item removed from this file and its status recorded in `docs/roadmap/docs-audit-…` when closed

## 7. Decision register (open)

- **R-02 truststore:** count first; do not disable SNI globally. Owner decision needed on whether to rebuild the JRE or ship an added `cacerts` overlay.
- **R-04 deadline:** per-indexer p90×2.5 vs flat 60s — confirm ranking intent for `network`/`timeout` before changing scoring.
- **R-05 generation bump:** `RUNTIME_GENERATION` is currently 17; bump only when shim/bridge/translator changes would make an already-provisioned copy wrong (`AGENTS.md` §3.5).
- **R-09 login walls:** whether "account required" is a message or a soft-failure that still offers other sources.

---
*Written to the review standard in `.claude/skills/cs3-architecture-simplifier/SKILL.md`: facts with a file reference, one severity scale per item, simplest next step. Keep dense — facts, rules, measurements, not narrative.*
