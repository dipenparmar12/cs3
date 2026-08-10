# 08 — UI and Interaction Design

**Generated:** 2026-08-10
**Baseline:** commit `a72f9e6c`

The desktop UI must deliver the same *behavior* through **desktop-native interaction patterns**. Mobile constraints that reduce desktop usability are dropped deliberately, and each drop is recorded here.

---

## 1. Android UI as built

### 1.1 Navigation
Single-Activity + Jetpack Navigation, one graph (`mobile_navigation.xml`, 69 identified nodes). Chrome varies by layout mode:

| Layout | Navigation chrome |
|---|---|
| PHONE | `BottomNavigationView` (`nav_view`) |
| TV / EMULATOR | `NavigationRailView` (`nav_rail_view`) |

Top-level destinations: Home, Search, Library, Downloads, Settings. Global actions exist for results (separate TV and phone variants), player, subtitles, chromecast subtitles, and plugins.

**Evidence.** `app/src/main/res/navigation/mobile_navigation.xml`; `app/src/main/res/menu/bottom_nav_menu.xml`; `app/.../MainActivity.kt:348-353`. **Confidence: High.**

### 1.2 Screen inventory

| Area | Fragments/Activities |
|---|---|
| Home | `HomeFragment` + 5 adapters + `HomeViewModel` |
| Search | `SearchFragment`, `SearchViewModel`, `SyncSearchViewModel`, 4 adapters, `SearchResultBuilder`, `SearchHelper` |
| Quick search | `ui/quicksearch/` |
| Result | 11 files incl. `ResultFragment`, `ResultViewModel2`, phone/TV variants |
| Library | `LibraryFragment`, `LibraryViewModel`, `ViewpagerAdapter`, `PageAdapter` |
| Downloads | `ui/download/` (5) + `button/` (4) + `queue/` (3) |
| Player | 29 files, 15,531 lines |
| Settings | 10 files + `extensions/` (7) + `testing/` (4) + `utils/` (1) |
| Setup | 5 wizard fragments |
| Account | `ui/account/` (5) |
| Subtitles | `SubtitlesFragment`, `ChromecastSubtitlesFragment` |
| Cast | `ControllerActivity`, `MiniControllerFragment` |
| Misc | `WebviewFragment`, `EasterEggMonkeFragment` |

### 1.3 Mobile interaction vocabulary
Tap · long-press (context actions) · swipe (pager, dismiss) · pull-to-refresh · bottom sheets · full-screen dialogs · D-pad focus traversal (TV) · player gestures (horizontal seek, vertical volume/brightness, double-tap seek/pause) · overlapping side panels (`OverlappingPanels`).

---

## 2. Desktop layout

```
┌───────────────────────────────────────────────────────────────────┐
│ ☰  CloudStream        [ Search…            ]      👤 Profile  ─ □ ×│
├──────────┬────────────────────────────────────────────────────────┤
│ ▸ Home   │                                                        │
│ ▸ Search │   Main content — responsive, virtualized                │
│ ▸ Library│                                                        │
│ ▸ Down…  │                                                        │
│ ▸ Extens.│                                                        │
│ ▸ Settings                                                        │
│──────────│                                                        │
│ ▶ Now    │                                                        │
│   playing│                                                        │
└──────────┴────────────────────────────────────────────────────────┘
```

| ID | Requirement | Priority |
|---|---|---|
| UI-1 | Collapsible sidebar replaces bottom navigation. Collapsed/expanded state persists. | P1 |
| UI-2 | Persistent search field in the header; `Ctrl/Cmd+K` focuses it from anywhere. | P1 |
| UI-3 | Profile switcher in the header, not a full-screen takeover. | P1 |
| UI-4 | A mini-player docks in the sidebar when playback is active outside the player view. | P2 |
| UI-5 | Minimum window 1024×640; below that the sidebar auto-collapses to icons. | P1 |
| UI-6 | Window size, position, monitor, and maximized state persist across restarts. | P1 |
| UI-7 | Content areas are virtualized. No layout may assume a bounded item count. | P0 |

---

## 3. Interaction mapping

| Android | Desktop | Notes |
|---|---|---|
| Tap | Left click | |
| **Long press** | **Right-click context menu** | Android hides real functionality behind long-press (remove from continue-watching, plugin actions, history removal). Desktop must expose all of it in context menus **and** in a visible overflow control — right-click alone is not discoverable enough. |
| Swipe between pages | Tabs + `Ctrl+Tab` / `Ctrl+Shift+Tab` | |
| Swipe to dismiss | Explicit close/remove control | |
| Pull to refresh | Refresh button + `F5` / `Ctrl+R` | |
| Bottom sheet | Modal dialog (≤3 fields) or right side panel (more) | |
| Full-screen dialog | Modal window | |
| D-pad focus | Tab/arrow focus traversal | Required for accessibility, not only 10-foot mode |
| Player gestures | Mouse: drag-seek, wheel volume, double-click fullscreen. Touch retained where present. | Brightness gesture unavailable (FEAT-PLAY-8) |
| Toast | Non-blocking snackbar/toast, plus OS notification for background events | |
| Android share sheet | Copy-link + "Share…" menu with OS share where available | |

---

## 4. Keyboard shortcuts

A first-class desktop requirement. Must be user-remappable (P2) and discoverable through a shortcuts panel (`?`).

### Global
| Shortcut | Action |
|---|---|
| `Ctrl/Cmd+K`, `Ctrl/Cmd+F` | Focus search |
| `Ctrl/Cmd+1..6` | Jump to Home/Search/Library/Downloads/Extensions/Settings |
| `Ctrl/Cmd+,` | Settings |
| `F5`, `Ctrl/Cmd+R` | Refresh current view |
| `Alt+←` / `Alt+→` | Back / forward |
| `Ctrl/Cmd+W` | Close window |
| `Ctrl/Cmd+Q` | Quit (honors `confirm_exit_key`) |
| `F1`, `?` | Shortcut reference |

### Player
| Shortcut | Action |
|---|---|
| `Space`, `K` | Play/pause |
| `←` / `→` | Seek ∓ `fast_forward_button_time` |
| `J` / `L` | Seek ∓ 10 s |
| `↑` / `↓` | Volume |
| `M` | Mute |
| `F`, `F11` | Fullscreen |
| `Esc` | Exit fullscreen |
| `N` / `P` | Next / previous episode |
| `C` | Cycle subtitle track |
| `V` | Cycle audio track |
| `<` / `>` | Speed down / up |
| `S` | Skip intro/outro when available |
| `[` / `]` | Subtitle offset |
| `0`–`9` | Seek to 0–90% |
| `Ctrl/Cmd+↑`/`↓` | Zoom / resize mode cycle |

### Library and lists
| Shortcut | Action |
|---|---|
| `↑↓←→` | Grid navigation |
| `Enter` | Open |
| `Space` | Toggle selection (desktop enhancement) |
| `Ctrl/Cmd+A` | Select all |
| `Delete` | Remove (with confirmation) |
| `Ctrl/Cmd+D` | Download |
| `B` | Toggle bookmark |

---

## 5. Screen-by-screen specification

### 5.1 Home
Responsive grid; item count per row derives from window width, not a fixed mobile count. Rows are horizontally virtualized. Hover reveals quick actions (play, bookmark, info). Provider selector in the header. Continue-watching cards show progress on the card and a remove affordance on hover.

### 5.2 Search
Two-column: filters (providers, types, quality) persistently visible on the left at ≥1280 px, collapsing to a popover below that. Results stream in per provider, each section showing loading / results / error-with-retry independently.

### 5.3 Result / detail
Two-column at ≥1100 px: poster, metadata, actions on the left; season selector and episode list on the right. Episode list is a virtualized table with sortable columns (number, title, air date, runtime, progress). Right-click on an episode offers play, download, mark watched/unwatched, copy link. Below 1100 px, stacks vertically.

### 5.4 Library
Multi-column grid with a persistent sort/filter bar and source selector (Local / MAL / AniList / Kitsu / Simkl). Multi-select with bulk actions. Optional list view with columns.

### 5.5 Downloads
Two panes: active queue with per-item progress, speed, ETA, and pause/cancel; completed downloads with play, reveal-in-folder, and delete. A global pause-all and a concurrency control.

### 5.6 Player
Frameless or minimally chromed. Auto-hiding controls on mouse idle (~3 s). Hover over the seekbar shows a thumbnail preview and timestamp. Track selectors are dropdowns, not modals. Persistent access to quality-profile switching. Full keyboard control per §4.

### 5.7 Settings
Two-pane: category list on the left, settings on the right, with a search field over all ~100 keys (FEAT-SET-12). Settings that are inert on desktop (rotation, battery optimization) are **hidden but preserved in storage**, not deleted.

### 5.8 Extensions
Two-pane: repositories on the left, plugins on the right. Each plugin shows name, author, version, language, status badge, and install/update/remove. A prominent, honest banner about plugin trust ([11](11-security-and-compliance.md) §4).

### 5.9 Migration / import
The most carefully designed flow in the app. Full specification in [25](25-data-portability-and-migration.md) §7.

---

## 6. Desktop-native affordances

| ID | Requirement | Priority |
|---|---|---|
| UI-8 | Native file/folder dialogs for downloads path, backup path, subtitle files, import files. | P0 |
| UI-9 | Drag-and-drop: subtitle files onto the player; video files onto the window; backup files onto the import screen; repository URLs onto Extensions. | P1 |
| UI-10 | Context menus everywhere Android has a long-press. | P0 |
| UI-11 | Tooltips on every icon-only control. | P1 |
| UI-12 | OS notifications for download completion, subscription updates, and background backup results. | P1 |
| UI-13 | Application menu bar (macOS mandatory; Windows/Linux optional) with File / Edit / View / Playback / Window / Help. | P1 |
| UI-14 | Resizable split panes with persisted sizes. | P2 |
| UI-15 | Optional tray icon with show/hide and playback controls. | P3 |
| UI-16 | Theme follows the OS light/dark preference by default, overridable via `app_theme_key`. | P1 |
| UI-17 | Zoom (`Ctrl/Cmd +/-/0`) scales the whole UI. | P2 |

---

## 7. 10-foot mode

When `app_layout_key` selects TV mode, or the user opts in:
- Larger type and hit targets; increased spacing.
- Visible focus rings; full arrow-key traversal with no keyboard-trap.
- Gamepad support where the OS exposes one (P3).
- Overscan compensation honoring `overscan_key`.
- Clock overlay honoring `tv_layout_clock_key`.

---

## 8. Accessibility

| ID | Requirement | Priority |
|---|---|---|
| A11Y-1 | Every interactive element reachable and operable by keyboard alone. | P0 |
| A11Y-2 | Correct roles/labels for screen readers (NVDA, JAWS, VoiceOver, Orca). | P1 |
| A11Y-3 | Text contrast ≥ 4.5:1 in both themes. | P1 |
| A11Y-4 | Respect the OS reduced-motion preference. | P2 |
| A11Y-5 | Subtitle rendering honors OS caption preferences where exposed. | P2 |
| A11Y-6 | Focus is never trapped; `Esc` always exits a modal. | P0 |

Android's accessibility posture is not strong; desktop should exceed it rather than match it.

---

## 9. Behavior that must not change

Recorded because they are easy to "improve" into incompatibility:

1. Progress-bar snapping thresholds (UTIL-4) — a 3%-watched title shows as 5%.
2. Items under 30 seconds never record progress.
3. Setting watch state to NONE **deletes** the record.
4. Setting video watch state to `None` **deletes** the record.
5. Sequential-homepage providers must not be parallelized.
6. Provider failures degrade one row/section, never the screen.

---

## Next steps

1. Produce wireframes for §5 screens at 1024, 1440, and 1920 px.
2. Ratify the §4 shortcut map before player implementation (Phase 7).
3. Design the migration flow first ([25](25-data-portability-and-migration.md) §7) — it is the highest-stakes UI in the product.
4. Run an accessibility audit at the end of Phase 5, not at the end of the project.
