# CloudStream 3 Desktop — Documentation

Two subjects, kept apart on purpose:

1. **CS3 Desktop** (`cs3_windows/` + `sidecar/`) — the Electron app in this repository. **Source code is the authority**;
   these documents describe what the code does today. Start here.
2. **Android reference** (`android/`) — the upstream CloudStream 3 Android app (v4.8.0) that the desktop app ports.
   Useful for expected behaviour; it does **not** describe this codebase.

Verification status of every claim: [VERIFICATION.md](VERIFICATION.md). Root agent context: `CLAUDE.md`/`AGENTS.md`;
intent/requirements: `docs/PRD/`; deep domain notes: `docs/agents/`.

## Desktop documentation

| Area | Document | Covers |
|---|---|---|
| **Architecture** | [overview](architecture/overview.md) | processes, services, IPC, startup, state |
| | [core-concepts](architecture/core-concepts.md) | glossary, patterns, provenance, fallbacks |
| | [streaming](architecture/streaming.md) | search → detail → sources → proxy → inspect → decide → player |
| | [downloading](architecture/downloading.md) | task identity, engines, resume, verification |
| | [providers](architecture/providers.md) | repository ▸ extension ▸ provider ▸ source, gating, ranking, OTT |
| | [extensions](architecture/extensions.md) | sidecar runtime, loading, shim, updates |
| | [repositories](architecture/repositories.md) | repo listings, bootstrap, regions |
| | [search](architecture/search.md) | search sessions, suggestions, discovery, metadata |
| | [caching](architecture/caching.md) | every cache, keys, lifetimes, startup |
| | [persistence](architecture/persistence.md) | data stores, history, library, Incognito, backup |
| | [player](architecture/player.md) | player components, engines, shortcuts, recovery |
| | [api-services](architecture/api-services.md) | all 334 IPC channels + service reference |
| **UI** | [overview](ui/overview.md) · [screens](ui/screens.md) · [components](ui/components.md) · [wireframes](ui/wireframes.md) | shell, navigation, every screen, component inventory |
| **Debugging** | [overview](debugging/overview.md) · [troubleshooting](debugging/troubleshooting.md) | evidence sources, symptom → owner → steps |
| **AI agents** | [coding-agent-guide](ai/coding-agent-guide.md) | tracing, where to add code, rules, verification |
| **Development** | [setup](development/setup.md) · [conventions](development/conventions.md) · [testing](development/testing.md) | build order, packaging, conventions, tests |

## Android reference (`android/`)
[01 Executive summary](android/01_executive_summary_and_purpose.md) ·
[02 Architecture & modules](android/02_architecture_and_modules.md) ·
[03 Extension system](android/03_extension_and_plugin_system.md) ·
[04 UI layer](android/04_ui_and_presentation_layer.md) ·
[05 Playback & torrent engine](android/05_playback_media_and_torrent_engine.md) ·
[06 Trackers & persistence](android/06_trackers_sync_and_data_persistence.md) ·
[07 Security & utilities](android/07_security_services_and_utilities.md) ·
[08 Key files](android/08_key_files_and_codebase_reference.md) ·
[09 CI/CD & roadmap](android/09_ci_cd_devops_and_future_roadmap.md) ·
[verification report](android/VERIFICATION_REPORT.md) (Android-only; compares those documents to the upstream Android tree).

Android docs paths such as `app/src/main/…` refer to the upstream Android repository
(`repositories/_cloudstream_ref_android`, an **uninitialised submodule** by default), not to anything in `cs3_windows/`.

## Maintenance rules
* Code wins. When a document disagrees with the code, fix the document in the same change.
* One authoritative document per concept; link, don't copy. Counts that change (channels, suites, indexers) are
  stated with a date or a command to regenerate them.
* Mark anything not confirmed in code as *requires verification* in [VERIFICATION.md](VERIFICATION.md).
