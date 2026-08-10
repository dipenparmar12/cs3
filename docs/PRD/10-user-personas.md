# 10 — User Personas

**Generated:** 2026-08-10

Personas exist here to settle design arguments, not to decorate the document. Each one ends with the decisions it drives.

---

## P1 — The Migrating User ★ *primary*

Has used CloudStream on Android for months or years. Has a library of dozens to hundreds of titles, watch history, installed providers, and a linked tracker. Wants a bigger screen without starting over.

**Goal.** Import their Android data and continue.
**Frustrations.** Losing progress. Re-installing providers by hand. Not knowing what did or did not transfer.
**Technical level.** Moderate — can move a file between devices, cannot debug JSON.
**Volume.** 100–2,000 titles; 500–10,000 progress records; 5–20 providers.

**Decisions this persona drives.**
- Import is a **first-class flow in the setup wizard**, not buried in settings (WF-1 step 2).
- The migration report is **itemized and human-readable**, because "it worked" is not credible to someone who just moved years of data.
- Repositories must migrate, so providers are recoverable without the user remembering URLs.
- The pre-import snapshot is automatic, not opt-in.

---

## P2 — The Desktop-Native User

Has never used the Android app. Found the desktop app directly. Judges it against desktop media software.

**Goal.** Discover and watch content with a proper desktop experience.
**Frustrations.** Mobile UI stretched to a 27-inch monitor. Missing keyboard shortcuts. Tiny click targets.
**Technical level.** Moderate to high.

**Decisions this persona drives.**
- Desktop layout is a genuine redesign, not a port ([08](08-ui-and-interactions.md) §2).
- Full keyboard shortcut map ([08](08-ui-and-interactions.md) §4).
- Context menus everywhere Android uses long-press.
- Multi-select and bulk actions (FEAT-LIB-7) — expected on desktop, absent on Android.

---

## P3 — The HTPC User

Runs the app on a machine plugged into a television, driven by a remote or a gamepad from across the room.

**Goal.** A 10-foot experience equivalent to Android TV.
**Frustrations.** Text too small. Focus invisible. Mouse required.
**Technical level.** High for setup, low during use.

**Decisions this persona drives.**
- 10-foot mode is a real requirement, not a stretch goal ([08](08-ui-and-interactions.md) §7).
- Every action reachable by directional navigation, with no keyboard traps.
- Overscan and clock settings retained from Android.
- Autostart and fullscreen-on-launch options ([26](26-electron-desktop-requirements.md) §8).

---

## P4 — The Provider Developer

Writes and maintains content providers. The reason the ecosystem exists.

**Goal.** Ship a provider that works, without rewriting it per platform.
**Frustrations.** A forked API. No debugging tools. Silent failures.
**Technical level.** Very high.

**Decisions this persona drives.**
- The plugin-runtime decision is made **with this persona in the room** ([27](27-plugin-and-extension-architecture.md) §6). If provider developers do not follow, the desktop app has no content.
- Provider testing tooling is ported (FEAT-DIAG-3), not dropped.
- Failures are attributed to the specific provider with actionable diagnostics.
- The plugin API is versioned and documented independently of the app ([07](07-apis-and-contracts.md) §3).
- Hot reload is preserved in some form — Android has it via `deployWithAdb`.

---

## P5 — The Privacy-Conscious User

Assumes untrusted code and hostile networks. Reads what the app sends.

**Goal.** Watch content without the app leaking data or executing untrusted code with full privilege.
**Frustrations.** Opaque telemetry. Plugins with unrestricted access. Credentials in plaintext.
**Technical level.** High.

**Decisions this persona drives.**
- Plugin sandboxing is non-negotiable ([11](11-security-and-compliance.md) §3) — and CloudStream's Android model, where plugins run with full app privilege, is a genuine weakness the desktop version should not replicate.
- Crash reporting defaults **off** and never transmits provider URLs or tokens without consent (FEAT-DIAG-2).
- Tokens live in the OS keychain, an improvement over Android's SharedPreferences (FEAT-SYNC-1).
- Logs are redacted before display or export (FEAT-DIAG-1).
- Every outbound connection is attributable in the log.

---

## P6 — The Data Hoarder

Downloads everything. Terabytes of local media. Large library, large queue.

**Goal.** Bulk download and manage a large local collection.
**Frustrations.** Non-resumable downloads. Broken libraries after moving files. UI that stalls on large datasets.
**Technical level.** High.
**Volume.** 10,000+ library items; 100+ queued downloads; multi-TB storage.

**Decisions this persona drives.**
- Virtualized lists everywhere ([08](08-ui-and-interactions.md) UI-7).
- Performance targets sized for this persona, not the median ([12](12-performance-and-limits.md) §2).
- Download metadata sidecars (FEAT-DL-9) so a moved collection can be rebuilt — directly addressing the "in the future we may write metadata to files" note upstream left in `BackupUtils.kt:92-93`.
- Explicit disk-space checks (FEAT-DL-8).

---

## P7 — The Household Sharer

One machine, several people, separate libraries.

**Goal.** Keep watch history and libraries separate.
**Frustrations.** Shared history. No way to switch quickly.
**Technical level.** Low.

**Decisions this persona drives.**
- Profile switching is one click from the header, not a full-screen flow (UI-3).
- Profile isolation is absolute for scoped keys (WF-13).
- PIN is presented as a courtesy lock, **never** as encryption — because it is stored in plaintext (DATA-1).

---

## Priority ranking

| Rank | Persona | Rationale |
|---|---|---|
| 1 | **P1 Migrating User** | The premise of the project. Failure here fails the project. |
| 2 | **P4 Provider Developer** | No providers, no content, no product. |
| 3 | P2 Desktop-Native | The growth audience; judges quality. |
| 4 | P5 Privacy-Conscious | Drives requirements that protect everyone. |
| 5 | P3 HTPC | Significant existing Android TV audience. |
| 6 | P6 Data Hoarder | Sets the performance floor. |
| 7 | P7 Household Sharer | Well served by existing profile support. |

---

## Anti-persona

**The user who expects a legal streaming service.** CloudStream ships no content and never has. The desktop app must be equally clear about this. Onboarding must not imply a catalogue exists before providers are installed, and marketing must not suggest the app provides content.

---

## Next steps

1. Validate P1's volume assumptions against real backups ([30](30-migration-test-cases.md) §2) — they set the performance targets.
2. Engage real provider developers (P4) **before** finalizing the plugin runtime decision.
3. Use P1 and P4 as the acceptance jury for the milestone demos in [16](16-implementation-plan.md).
