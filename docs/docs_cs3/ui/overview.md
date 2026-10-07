# UI Architecture Overview

Stack: React 19 + TypeScript, Vite 8, `lucide-react` icons, hand-written CSS (`src/App.css`, per-feature CSS, vendored
Inter font in `src/assets/` — no third-party font fetch). No router library: navigation is state in `App.tsx`.

## 1. Shell

```
.app-container [--incognito border]
├── <Sidebar/>                 left rail: nav + streaming services
└── .main-content
    ├── <Navbar/>              search box, scope picker, torrent open, Incognito, inspector
    ├── banners                offline banner · <FirstRunBanner/> · <RegionOnboarding/> (modal)
    ├── <Suspense fallback=<ViewSkeleton/>>  the active view, each wrapped in <ErrorBoundary>
    ├── <VideoPlayer/>         lazy; full / mini / floating (never unmounted while playing)
    └── dialogs                <ProviderInspector/> · <BinarySetupModal/> · download dialogs · FixProvidersModal
```

`App.tsx` (2,350 lines) owns: `activeTab`, `selectedMedia` (detail), search state (`SearchUiState`), `homeCategory`
("Show all"), `ottCategory`, open torrent, player request/hidden state, download queue (`downloadQueue`), OTT platform
list, incognito, offline flag, renderer codec capabilities (registered via `media:setCapabilities` before playback).

## 2. Navigation model
`ActiveTab` = `home | search | library | history | extensions | settings | downloads | ott:<platformId>`
(`switch` in `App.tsx` ~L367). Selecting a tab clears `selectedMedia`; Home also clears the "Show all" category and an
`ott:` tab clears its category. Detail view is an overlay state (`selectedMedia`), not a tab. The Settings screen can be
opened on a pane from the menu (`initialTab`). Search results and UI state are held by `App` so opening a title from
results and returning restores the same place (`searchUiState.ts`, `homeCategoryState.ts`).

Native menu (`main.ts`, hidden behind Alt via `autoHideMenuBar`): File (Open File… `Ctrl+O`, Incognito `Ctrl+Shift+N`,
Settings… `Ctrl+,`), Edit, View, Help (Provider Inspector `F12`, Open Log Folder, Licences). Reload is gated on `!app.isPackaged`.
`will-navigate`/`will-frame-navigate` refuse top-level navigation; dropping a file plays it via `media:prepare`.

## 3. Modes and gates that change what is drawn
| Mode | Source | Effect |
|---|---|---|
| Standard vs Developer | `ExperienceModeContext`, `utils/experienceMode.ts` (`shouldReveal`, `plainMessage`) | Developer shows plans, swarm stats, ranking criteria, codecs, full provenance chain, original error text |
| Simple vs Everything (settings) | `settings/settingsLevel.ts`, `SettingsLevelContext.tsx` | `advanced` = understanding the *label* needs knowing how the app is built; an unclassified row is basic |
| Adult mode | `useAdultMode` (single copy; `adult:changed` push) | adult-only providers hidden; mixed rows screened/covered until confirmed |
| Incognito | `usePrivacy`, `privacy:changed` | border + badge; automatic activity not saved |
| Offline | `navigator.onLine` | one banner instead of thirty provider errors |

## 4. State management
No global store library. Patterns in use: component state; module-level subscriptions shared by hooks
(`useExtensionJobs`); main-process **push** snapshots rendered as-is (playback, search, jobs, metadata); batched read
hooks (`useTitleInteractions` → `interactions:summarise`, re-asked on `download:progress`, coalesced); persistent
choices round-trip through IPC (`datastore:*`); per-viewer conveniences in `localStorage` (settings level, collapse state).
`PlaybackSnapshot`, `SearchSnapshot`, `JobQueue` are replaced wholesale, never merged.

## 5. Accessibility and conventions
Global `:focus-visible` outline floor; `prefers-reduced-motion` honoured in `index.css`; poster cards are keyboard-reachable;
tablists use `role="tablist"/"tab"` + `aria-selected`; Esc handling is capture-phase and only consumes when it closed something.
`useFlash` (toasts with cleanup), `useDismissable` (outside-click dismiss), `Poster` (fallback on image error), `EmptyState` (message + action).

## 6. Lazy loading
`React.lazy` per route (VideoPlayer, DetailView, SearchView, LibraryView, HistoryView, SettingsView, ExtensionsScreen,
TorrentView, OttPlatformView, DownloadCenter); `manualChunks` for hls.js, shaka-player and one more large library.
`ViewSkeleton` fades in at 150 ms so the common case draws nothing. Do not value-import a screen from `App` state modules
(that is why `searchUiState.ts`/`homeCategoryState.ts` are separate).

Next: [screens.md](screens.md) · [components.md](components.md) · [wireframes.md](wireframes.md)
