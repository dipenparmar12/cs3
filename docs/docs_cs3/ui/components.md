# UI Component Inventory

Locations are under `cs3_windows/src/`. **Reusable** = used by several screens; **screen-specific** = owned by one.
Props below were read from the component files (2026-10-07); anything not listed was not re-read.

## 1. Reusable primitives

| Component | File | Props (key) | Behaviour / rules |
|---|---|---|---|
| `Poster` | `components/Poster.tsx` | `src?, title, className?, decorative?, loading?('lazy'\|'eager'), fallback?` | Handles a broken/expired poster URL with a per-call-site `fallback`; never shows the browser's broken-image icon |
| `PosterCard` | `components/PosterCard.tsx` | `item: SearchResponse, onSelectMedia, onPlayDirectly?, progressPercent?, watchedText?, showBucketButton?, interaction?: TitleInteraction, outcome?` | The most-repeated component; state badge/dimming from `cardState.ts` (failure always marked; success rarely; `visited` dims, never badges); keyboard-reachable |
| `ContentHoverCard` | `components/ContentHoverCard.tsx` | `item, alignRight?, onSelectMedia, onPlayDirectly?, onClose` | Hover preview with quick actions |
| `EmptyState` | `components/EmptyState.tsx` | `icon?, title, description?, action?, secondary?, compact?` | Every list route's empty state; the *action* is the point (e.g. "Search all sources") |
| `FacetMenu` | `components/FacetMenu.tsx` | `label, value, options, onChange, allValue?, allLabel?, icon?, searchable?, title?` | Single-select facet dropdown with counts |
| `ErrorBoundary` | `components/ErrorBoundary.tsx` | `children, fallbackTitle?` | Wraps each view |
| `CopyErrorButton` | `components/CopyErrorButton.tsx` | — | Copies a main-process-assembled report (`diagnostics:report`; "current" vs full) |
| `ShareButton`, `SourceExportButton` | `components/` | — | Share link (`shareLink.ts`); CSV/text/links export (`sourceExport.ts`) |
| `LibraryBucketSelector` | `components/LibraryBucketSelector.tsx` | `size?('sm'\|'md'), variant?('default'\|'detail-action')`, status | Watching/Completed/On hold/Plan to watch/Dropped; explicit selection gated by `allowExplicitSaves` in Incognito |
| `ViewSkeleton` | `components/ViewSkeleton.tsx` | — | Suspense fallback, fades in at 150 ms |
| `InfoHint` | `components/settings/InfoHint.tsx` | — | ⓘ text for a setting |
| `SettingRow` / `SettingGroup` | `components/settings/SettingRow.tsx` | `label, hint?, note?, children, stacked?, level?('basic'\|'advanced'), keywords?` | Rows/groups filter themselves by level and by search; a group whose rows all hide hides too |
| `SettingsSection` | settings | `keywords` | Wraps whole panels for "Find a setting" |
| `Toggle`, `TriStateCheckbox`, `FilterBar`, `BulkActionBar` | `components/extensions/primitives.tsx`, `FilterBar.tsx`, `BulkActionBar.tsx` | — | Toggle carries a `suppressedReason`; tri-state for partially-enabled parents |

## 2. Hooks and view-model utilities (reusable)
| Name | File | Purpose |
|---|---|---|
| `useFlash` | `utils/useFlash.ts` | Toast timers with cleanup; `flash` goes in dependency arrays |
| `useDismissable` | `utils/useDismissable.ts` | Outside-click dismiss, capture phase |
| `useAdultMode`, `usePrivacy` | `utils/` | The renderer's single copies of main-process state |
| `useTitleInteractions` | `components/useTitleInteractions.ts` | Batched card state for a screen |
| `useTitleEnrichment`, `useSourceProvenance` | `components/` | Metadata push; batched provenance |
| `useExtensionJobs` | `components/extensions/useExtensionJobs.ts` | One module-level subscription shared by tray, row buttons, sidebar badge; `useOnJobsSettled` |
| `useFloatingPlayer`, `useMiniFrame`, `useTimelinePreview` | `components/player/` | PiP/pin/background/Media Session; mini drag/resize clamped to the window; hover thumbnails |
| Pure rules | `utils/{cardState,deadRows,downloadIdentity,resumePoint,sourceExport,sourceIdentity,releaseName,homeRows,trailerQueue,videoGallery,adultContent,experienceMode,subtitleStyle,clearKey}.ts` | Tested, no React |

## 3. Screen-specific components

| Screen | Components |
|---|---|
| Shell | `Sidebar`, `Navbar`, `FirstRunBanner`, `regions/RegionOnboarding`, `ProviderInspector`, `BinarySetupModal`, `FixProvidersModal`, `ProviderRecoveryPanel` |
| Search scope | `SearchScopePicker` (in Navbar), `search/SourceProfileBar`, `search/SourceScopeDialog` (+ `sourceScopeModel.ts`), `search/providerHealth.ts` |
| Home | `home/HomeRow`, `CategoryGrid`, `RowPicker`, `CataloguePicker`, `StreamingServicePicker` (Sidebar) |
| Detail | `detail/DetailHero`, `TitleMetadata` (+`metadataSection.ts`), `MediaRatings`, `TrailerGallery`, `TrailerPopup`, `FranchiseRail`, `ReviewsAndExplanations`, `SourcePicker`, `SourceFilterBar` |
| Library | `library/SavedSourcesList`, `PlayedSourcePanel`, `SavedSearchesList` |
| Downloads | `DownloadCenter`, `DownloadConfirmDialog`, `DeleteDownloadDialog`, `player/PlayerDownloadPanel` |
| Extensions | `extensions/ExtensionsScreen`, `SourceTree`, `RepositoryCatalog`, `ExtensionCatalog`, `BuiltInSources`, `JobsTray`, `ProvenancePanel`, `CompatibilityReport` (+`compatibilityVerdict.ts`), `ExtensionUpdates` |
| Settings | `settings/{AboutPanel,BackupPanel,DiagnosticsPanel,ExtensionIssuesPanel,HomeSettings,PrivacySettings,ProviderRankingPanel,StartupProfilePanel,SubtitleSettings,PlayerShortcutsPanel,CardStatusLegend}`, `PlayerSettings`, `NetworkSettings`, `AdultContentSetting`, `regions/RegionSettings`, `MediaComponentsCard`, `UnifiedComponentManager` |
| Player | `VideoPlayer`, `player/{NativeEngineStage,PlaybackErrorPanel,SourcePanel,EpisodePanel,SubtitlePanel,UpNextCard,SourceResolveOverlay,ExternalPlayerFallback,MiniPlayerBar,HoverMenu,PlayerCopyMenu}` |

## 4. Reachability guard
`src/componentReachability.test.mts` fails if a component is built but never mounted (three superseded orphans are
allow-listed with the component that replaced each) and if two module paths differ only by letter case (a `.ts`/`.tsx`
pair with the same name resolves to the wrong file on Windows and blanks the whole app).
