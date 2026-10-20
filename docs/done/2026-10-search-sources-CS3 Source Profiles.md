> **Filed 2026-10-20: Done.** Built; the main modules exist in the code (full line-by-line check not done). See [docs-audit-2026-10-20](../roadmap/docs-audit-2026-10-20.md).

The main problem with this dialog is not that it has too many features. It is that too many different decisions are presented at the same time, with almost equal visual importance.

Your app has hundreds of providers, multiple repositories, extensions, languages, regions, content types, and saved profiles. A conventional filter dialog will become increasingly difficult to use as that ecosystem grows.

For CS3, I recommend changing the design from a large source-management panel into a guided source selection experience, backed by powerful filters and a full source explorer when needed.

The objective is to keep all the existing capabilities while making the common task simple: choose which sources should be searched.

## 1. What is wrong with the current dialog?

[For Developers | Bigdata](https://images.openai.com/static-rsc-4/XT7vOE6ildz1tD3S14SVj_mLsj-LKIbOB1sxVn8JOFdYBQgo3tnXnbsu02jU0nNZwWbFVYA3n6V2P0M5BvpnkJdIC-mI0GfirWMu3ClSKdEG_4XH5tLT2gVx8CDrUoPLpTclgMIbW7AyazD1mOyXmeOoTXlx11IxVG-uDWthsuE?purpose=inline)

1\. Too many competing controls

Language chips, content types, profiles, selected-source chips, repository trees, counts, and bulk actions all compete for attention. Users must understand the entire interface before making one simple choice.

[User Interface](https://images.openai.com/static-rsc-4/cAkefJQcmHK9b8X6-CKcHQiO_JFSAWMgx7C7LETn6XSyMVgOsZIwh6NpRq_XIuhBQ4YSu9A8C4qIvSiMkJWpezx7PLUXkHG_rzdo4kM4lAJSs9l1uRrw_e6_c90eE89PqzZz6F0xaej9NXDQYIDGAJ2hzKdzStUXG_axp0ReLI0?purpose=inline)

2\. Filters are mixed with selection

Language and content type determine which sources are displayed, while checkboxes determine which sources actually participate in search. Those are different concepts and should be visually separated.

[Tree view - Spectrum](https://images.openai.com/static-rsc-4/rJOJHRanvOpIxxd5cpaImv8GkwgxivG2-P4zmV5cuuyUHi0uT8vxyoW4SaK1Rbam9Zrq3nF2GqfkPJJ7GNBBdlocP6sMK45lugTjDwN4E9JdepQmVX8uo6GfkSaTMYJgIeGFP4dIwp6imQCTy62Ln8p5raPi9HKRDf0qJpU6J74?purpose=inline)

3\. Repository hierarchy is too prominent

Most people care about finding working Hindi movie sources, not which repository contains an extension. Repository and extension details should remain accessible without dominating the default experience.

[Multirow Choice Component (aka Chips UI) - Feature Requests - Glide Community](https://images.openai.com/static-rsc-4/cyavkI1bO9Dyv56GBmeLBZjJ0MypyZPJ566oYKe4DUut8RmmHGNQPTIXmmkOYTqqrym1Jx59NLWbJ5wyYnkG_ODGr8gQ46Kt8YjYtukblOyv25jJt0rgi2oPOMED7PJxr1YMQGgtR8FHBprq0GSbDfZgKRnZjzIfrNffHdtyoXc?purpose=inline)

4\. Too many ways to express the same intent

Profiles, current selection, language presets, and individual provider toggles overlap conceptually. Users need one clear answer to the question: "What sources will my search use?"

The current screen also has a particularly important usability issue: the visible filters can make sources disappear from the list, while the actual search selection can remain unchanged. Users need to distinguish "hidden by this filter" from "not selected for searching."

## 2. The recommended architecture

Use three levels of complexity instead of displaying everything at once.

### Level 1: Quick setup

Default experience

Users choose a saved profile or a simple combination of region, language, and content type. The app handles provider-level details automatically.

### Level 2: Customize sources

Users can exclude specific providers, search for a provider, select multiple sources, and inspect source health. Keep the existing tree and bulk-selection capabilities here.

### Level 3: Advanced source explorer

Expose repository and extension hierarchy, diagnostics, compatibility, unmeasured providers, and fine-grained selection controls for power users.

This should be progressive disclosure, not three separate implementations. All three levels should operate on the same underlying source selection and profile state.

## 3. Redesign the main screen

I would structure the dialog around the user's intent rather than the underlying repository structure.

## Search sources

Choose which sources can be searched

ACTIVE PROFILE

IN + Hindi

213 sources enabled

Change profile

REFINE YOUR SEARCH

Region

India

Language

Hindi

CONTENT TYPE

Movies

TV series

Anime

Live TV

More

### Sources included

213 selected across 523 available

Customize

Recommended sources

Prioritized using available performance data

Find a specific provider

Search names and filter the complete list

Search uses only the sources you have selected.

Changes are applied when confirmed

Done

Conceptual mockup showing the proposed hierarchy, not the current implementation.

### What changes in this layout?

- Profile first: users start from a familiar, reusable configuration.
- Region and language next: these are natural ways to describe what a user wants.
- Content type after that: movies, series, anime, documentaries, live TV, and other categories.
- Source management is secondary: only users who need precise control enter the full explorer.
- One clear primary action: confirm the configuration without requiring users to understand every provider.

The counts should always describe their actual meaning. For example, "213 sources selected" must not imply that 213 sources are guaranteed to have playable results.

## 4. Rethink region, language, and content selection

Avoid displaying every country, language, and content type as a permanent chip.

Instead, use compact searchable selectors with summaries of the active choices.

### Region

Primary region, with optional additional regions

India

Additional regions

### Languages

Hindi

English

Gujarati

\+ Add language

Show a short summary, with the full selection inside the selector.

### Content types

Movies

TV series

Anime

More types

### Important behavior rules

1\. Region should be a preference, not an automatic destructive filter. Adding or removing a region must not silently disable previously selected sources. Your existing region model already supports reviewing affected repositories, which is the right direction.

2\. Language metadata is imperfect. A provider may support Hindi even if its metadata does not declare that language. Offer a way to include unclassified sources or inspect them in the source explorer.

3\. Content type should use consistent definitions. Anime is often a subset of TV series or movies, so decide whether it is a separate overlapping facet or a mutually exclusive category. Do not let selecting Anime unexpectedly exclude anime series.

4\. Filters must not silently change the active selection. Changing the visible list should not remove hidden sources from the search configuration unless the user explicitly chooses that behavior.

5\. Make combinations understandable. Display a concise summary such as "India, Hindi + English, Movies + Series" instead of a large collection of active chips.

## 5. Redesign the full source explorer

The advanced explorer should preserve the capabilities you already have, but make the hierarchy easier to navigate.

### Recommended layout

## Customize sources

213 selected

Search providers, extensions, repositories...

Ctrl+F

All sources

Selected

Excluded

Needs attention

Adam Knight Mega Repo

62 providers · 1 extension enabled in this view

Select group

Indian BillibiliProvider

Extension · 1 provider

BillibiliTV

Performance: Good · Hindi metadata unavailable

Indian Cinedoze

Extension · 1 provider

Cinedoze

Performance: Poor

213 selected · Changes pending

Cancel

Apply changes

Conceptual explorer mockup.

### Specific improvements

| Current issue                                      | Recommended change                                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Separate horizontal chip groups everywhere         | Put most filters inside searchable dropdowns or a single filter menu                                         |
| Long selected-source chip wall                     | Replace it with a compact count and a dedicated Selected view                                                |
| Repeated `All`, `None`, `Invert`, `Reset` controls | Consolidate selection actions into a contextual bulk-action menu                                             |
| Nested trees dominate the dialog                   | Collapse repository groups by default and show hierarchy only where useful                                   |
| Good/Poor badges without context                   | Show health labels with a short explanation or tooltip                                                       |
| Too many tiny controls                             | Increase click targets and reduce decorative borders and redundant icons                                     |
| Search field has an unclear scope                  | Let users search providers, extensions, and repositories, with the matching hierarchy revealed automatically |
| Selected items are hard to audit                   | Add a Selected view with searchable, removable items                                                         |

One important distinction: poor performance should be a warning, not an automatic exclusion. A provider can be unreliable for one period or work well for a particular language or title.

## 6. Make profiles the primary way to manage complexity

Profiles are especially valuable in your app because users can have different preferences for different kinds of searches.

Instead of showing several profile chips above a second set of filters, provide one active profile selector.

IN + Hindi

India · Hindi · Movies and series

213 sources selected

Active

English Movies

English · Movies

Uses its own saved source selection

Anime

Anime providers and preferred languages

Define profile behavior

The profile should preserve the exact source selection, not merely its language and region labels. Two profiles with the same language can still require different providers.

Keep the existing `profiles:*` and source-scope architecture. Profiles should remain a layer over the actual search scope, rather than introduce another independent selection state.

Also consider these behaviors:

- Switching profiles should restore the profile's saved configuration.
- Editing a profile should make it clear whether changes will be saved to that profile or applied temporarily.
- Creating a profile should be possible from the current selection.
- Duplicate, rename, and delete actions should live in a profile menu.
- If a profile has unresolved or disabled sources, explain which sources are affected rather than silently widening the search.

## 7. Simplify selection behavior

This is one of the most important implementation details because your app has a repository, extension, and provider hierarchy.

Use consistent tri-state selection:

- Checked: all eligible children are selected.
- Indeterminate: some eligible children are selected.
- Unchecked: no eligible children are selected.

Bulk actions should work on the currently visible matching items, but the UI must explicitly distinguish that from all items in the repository.

For example, when a user searches for `Cinedoze` and selects all matching results, the app should not accidentally select hidden providers from the same extension.

Your current bulk-selection model already has rules for hidden selections and parent-child relationships. Preserve these rules while simplifying the interface.&#x20;

AGENTS.md



### Replace the bottom actions with a clearer model

| Action                | Behavior                                                    |
| --------------------- | ----------------------------------------------------------- |
| Select all matching   | Select only the eligible items matching the current filters |
| Deselect all matching | Exclude only the matching items                             |
| Invert matching       | Reverse selection for the matching items only               |
| Reset changes         | Restore the state that existed when the dialog opened       |
| Apply changes         | Confirm the draft and close the dialog                      |

Do not combine "Reset changes" with "Select none." They are fundamentally different actions.

## 8. Make provider health useful rather than decorative

You already have provider analytics and ranking in CS3. Use them to help people make decisions without exposing the underlying scoring model.

A provider should have a meaningful state such as:

- Recommended: strong measured performance.
- Good: generally reliable.
- Unreliable: frequent failures.
- Unmeasured: insufficient evidence.
- Disabled or unavailable: a specific actionable reason.

Do not label an unmeasured provider as average or poor. Likewise, a provider returning no results for a particular title should not automatically be classified as broken.

A useful default would be to order the source explorer by repository or provider name for predictable browsing, with an optional sort by performance. The recommended profile can use performance ranking internally.

## 9. What I would implement first

Priority 1: Remove visual clutter

Consolidate the chip groups, eliminate duplicate selection controls, shrink the selected-source area to a summary, and make the repository tree the secondary interface.

Priority 2: Separate filters from selection

Filters control visibility. Selection controls which sources are searched. Make this distinction explicit in labels, counts, and bulk actions.

Priority 3: Improve profile-based setup

Put the active profile first and make region, language, and content type easy to adjust without exposing every provider.

Priority 4: Improve source discovery and health

Add meaningful health labels, explain exclusions, improve search across the hierarchy, and make selected items easy to audit.

## 10. Acceptance criteria for the redesign

The redesign should be considered successful when:

1. A new user can choose a profile and confirm the source selection without opening the advanced explorer.
2. An experienced user can still select or exclude an individual provider, extension, or repository.
3. Users can discover a provider by name without manually expanding repository trees.
4. Counts clearly distinguish available, selected, filtered, and disabled sources.
5. Filtering the list never silently changes the search scope.
6. Bulk operations do not accidentally affect hidden items.
7. The dialog stays responsive with hundreds of providers and large repositories.
8. Existing profiles and saved source selections continue to work after migration.
9. Every source has an understandable selection state, including when a parent is disabled.
10. Keyboard navigation, accessible labels, focus handling, and Escape behavior remain correct.

My final recommendation: make the profile-driven quick setup the default, put a searchable source explorer behind Customize, and keep repository-level management in the advanced view. Do not remove functionality to simplify the screen. Reduce the number of decisions visible at once, preserve the existing selection semantics, and make every visible control communicate one clear purpose.



# 
# CS3 Source Profiles
## Product Requirements and Technical Behavior Specification

**Status:** Proposed specification  
**Product:** CloudStream 3 (CS3) Desktop  
**Scope:** Source profiles, source selection, profile lifecycle, draft management, persistence, and strict search-scope integration.

## 1. Purpose

Source profiles allow users to save and switch between named configurations of search sources without repeatedly selecting individual providers, extensions, repositories, or indexers.

CS3 supports a large and changing source ecosystem. Users may want different configurations for Hindi movies, English television, anime, regional content, or broad discovery. The profile system must make these configurations easy to create and maintain while preserving precise control over which sources a search can access.

The objective is to simplify source management without weakening the existing strict search-scope contract.

### 1.1 Product principles

1. A profile represents a complete, named search configuration.
2. Switching profiles must be predictable and must not silently modify another profile.
3. Unsaved changes must be distinguishable from saved configurations.
4. The active profile and effective search scope must always agree.
5. A selected source is an explicit search restriction, not a ranking preference.
6. Missing or unavailable sources must be reported, never silently replaced with all sources.
7. All source-selection entry points must use the same state-management layer.
8. Profile management must remain usable with hundreds of providers.
9. Existing configurations must survive application restarts and supported backup/restore operations.
10. Profiles must not install, enable, disable, or remove extensions as an implicit side effect.

## 2. Existing architecture and compatibility requirements

The current implementation already provides a foundation for this feature.

| Component | Existing responsibility |
|---|---|
| `cs3/sourceProfiles.ts` | Pure profile state machine |
| `cs3/sourceProfileStore.ts` | Profile persistence and writing the effective scope to `SearchScopeStore` |
| `searchScope.ts` | Strict search-scope storage and resolution |
| `profiles:*` IPC namespace | `list`, `activate`, `create`, `rename`, `duplicate`, and `delete` |
| `cs3_search_scope` | Persisted effective search scope |
| `cs3_source_profiles` | Persisted profile configuration |
| `search:setScope` | Routes scope changes through the profile layer |

The profile API returns the complete state, including the profile list, active profile ID, and unnamed draft. Consumers must not reconstruct this state by applying partial response updates.

**Compatibility constraint:** profiles remain above `SearchScopeStore`. Search and downstream services must not need to know which profile produced a scope.

The existing search contract must remain unchanged:

- With no explicit source selection, search follows the existing all-sources behavior, including catalogues.
- With selected providers, search uses exactly those providers and does not query catalogues.
- With selected indexers, those indexers are queried according to the existing search plan.
- Unresolvable selections are reported through the existing missing-provider and missing-indexer mechanisms.
- Discovery scope and playback recovery retain their existing independent behavior.

This specification defines proposed user-facing behavior and acceptance criteria on top of these existing contracts. It does not assume that every interaction described below is already implemented.

## 3. Domain model

### 3.1 Profile

A profile is a named, durable snapshot of a search configuration.

Recommended conceptual model:

```ts
type SourceProfile = {
  id: string;
  name: string;
  scope: SearchScope;
  createdAt: number;
  updatedAt: number;
};
```

The actual field names and scope representation must follow the existing types in `sourceProfiles.ts` and `searchScope.ts`. The fields above describe the logical contract, not a requirement to introduce a new incompatible schema.

Profile identity must be stable and independent of its name.

### 3.2 Active profile

The active profile identifies the named configuration currently in use.

Activating a profile resolves its saved configuration into an effective `SearchScope` and writes that scope through the existing store.

The active profile ID and effective scope must be updated as one logical operation. The application must not expose an intermediate state where the selected profile differs from the scope being used by search.

### 3.3 Unnamed draft

The unnamed draft is the temporary configuration being edited outside a named saved profile.

It supports workflows such as:

- Temporarily trying different sources.
- Customizing a profile without immediately overwriting it.
- Starting a new configuration before giving it a name.
- Making changes that can later be saved as a new profile.

The existing profile state already includes an unnamed draft. The UI should expose this concept clearly without presenting it as another ordinary saved profile.

### 3.4 Effective scope

The effective scope is the actual configuration consumed by search.

It must be derived from the currently applied profile or unnamed draft through the profile state machine. UI components must not independently write a competing scope.

### 3.5 Draft state

The UI needs to distinguish these conditions:

| State | Meaning |
|---|---|
| Clean | Current configuration matches its saved baseline |
| Dirty | The user has made changes that have not been committed to the relevant saved profile |
| Saving | A persistence operation is in progress |
| Error | A change could not be committed |
| Missing sources | One or more selected source identifiers cannot currently be resolved |

Missing sources are a validity condition, not a substitute for the dirty-state indicator.

## 4. Profile management interface

### 4.1 Profile selector

The source-selection dialog should show one active profile selector rather than a row of competing profile chips.

The selector should display:

- Profile name.
- Active-state indicator.
- A concise source count.
- A dropdown or menu for switching profiles and managing them.

Example:

**IN + Hindi**

India · Hindi · Movies and TV  
213 sources selected

Actions:

- Switch profile
- Create profile
- Duplicate profile
- Rename profile
- Delete profile
- Save changes, when applicable

Actions that are not valid for the current state should be hidden or disabled with a clear explanation.

### 4.2 Profile management list

A dedicated management view may be opened from the selector.

Each row should contain:

- Profile name.
- Active indicator.
- Number of selected sources.
- Dirty indicator when the active configuration differs from its saved baseline.
- A contextual actions menu.

Avoid showing the entire source list or every language and content-type facet inside each profile row.

### 4.3 Default and special modes

**All sources is a mode, not a profile deletion or reset operation.**

It must remain possible to use the existing all-sources behavior without deleting saved profiles or overwriting their stored scopes.

The implementation must preserve any existing special handling of the all-sources mode. Do not invent a synthetic profile with a normal provider selection if the current model represents that mode differently.

If an explicit all-sources choice is exposed in the selector, label it distinctly from named profiles and explain its scope semantics.

## 5. Creating profiles

### 5.1 Entry points

Users should be able to create a profile from:

1. The profile selector.
2. The profile management view.
3. The current customized source selection.

### 5.2 Create flow

1. The user selects Create profile.
2. CS3 opens a compact naming dialog.
3. The user enters a name.
4. CS3 creates a new profile from the current effective configuration or the explicitly chosen starting configuration.
5. The new profile becomes active.
6. The new profile and effective scope are persisted.
7. The UI receives and renders the complete authoritative profile state.

The source configuration used as the starting point must be explicit. Creating a profile must not unexpectedly copy the default configuration when the user intended to save the current selection.

### 5.3 Validation

- Names must not be empty or whitespace-only.
- Leading and trailing whitespace should be removed.
- Duplicate names should be rejected or handled through an explicit rename confirmation.
- Profile IDs must be generated independently of the display name.
- Creating a profile must not overwrite an existing profile with the same name.
- Failure must leave the previous active profile and scope unchanged.

The maximum name length and profile count must follow existing project conventions or be specified before implementation. Do not impose an arbitrary limit without reviewing current code.

### 5.4 Acceptance criteria

- A profile created from the current selection preserves the selected source identifiers.
- The newly created profile is active only after the state transition succeeds.
- Restarting CS3 preserves the new profile and its active state.
- Failure to persist the profile produces a visible error and does not falsely report success.

## 6. Renaming profiles

### 6.1 Behavior

Renaming changes only the profile's display name and update metadata.

It must not modify:

- The profile ID.
- The saved scope.
- Source enablement settings.
- The effective source selection.
- Other profiles.
- Provider ranking or analytics.

### 6.2 Active and inactive profiles

Renaming an active profile must leave the same profile active.

Renaming an inactive profile must not change the active profile or effective search scope.

### 6.3 Acceptance criteria

- The new name is validated before persistence.
- The UI reflects the committed name only after a successful operation.
- A failed rename preserves the previous name.
- The active profile indicator remains attached to the same profile ID.
- Renaming must not be implemented as deleting and recreating the profile.

## 7. Duplicating profiles

### 7.1 Purpose

Duplication allows users to start with an existing configuration and customize it independently.

For example, a user could duplicate an India + Hindi profile to create a separate Hindi + English configuration without modifying the original.

### 7.2 Behavior

1. The user selects Duplicate profile.
2. CS3 proposes a default name, such as `IN + Hindi (Copy)`.
3. The user may change the proposed name.
4. CS3 creates a new profile ID.
5. The duplicate receives a snapshot of the source profile's saved scope.
6. The original profile remains unchanged.
7. The new profile becomes active after successful creation.

If the product chooses not to activate duplicates automatically, that behavior must be consistent and explicit. The recommended default is to activate the duplicate because users generally duplicate a profile to customize it.

### 7.3 Independence

After duplication, modifying either profile must not mutate the other profile's saved scope.

The profiles may refer to the same provider identifiers, but they must not share a mutable scope object that allows edits to propagate unintentionally.

### 7.4 Acceptance criteria

- Duplicate and original have distinct stable IDs.
- Their initial scopes are equivalent.
- Their subsequent edits and renames are independent.
- A failed duplication leaves the original unchanged.
- Duplicate creation persists atomically with activation if activation is part of the operation.

## 8. Deleting profiles

### 8.1 Behavior

Deleting a profile removes the named configuration. It must not uninstall providers or extensions, alter repository configuration, or disable providers globally.

### 8.2 Deleting an inactive profile

The profile can be deleted after confirmation if the action is destructive enough to warrant confirmation under the established design system.

The current active profile and effective scope remain unchanged.

### 8.3 Deleting the active profile

The application must not leave an active profile ID pointing to a deleted profile.

The recommended behavior is to switch to the unnamed draft or an explicitly defined fallback mode, using the existing state machine's semantics.

If another named profile is activated as the fallback, that choice must be explicit and deterministic.

The transition must:

1. Resolve the destination configuration.
2. Validate its scope representation.
3. Commit the new profile state and effective scope.
4. Remove the deleted profile.
5. Persist the resulting state.
6. Return the complete authoritative state.

If the operation fails, the previous profile must remain available and active.

### 8.4 Last profile

Deleting the final named profile must not break search or force the application to create an undocumented profile.

The unnamed draft and existing all-sources mode must remain usable according to the current state machine.

### 8.5 Acceptance criteria

- Deleting a profile never removes providers or extensions.
- Inactive-profile deletion does not affect the active scope.
- Active-profile deletion cannot leave an invalid active ID.
- The last profile can be deleted without corrupting the state.
- Failure is reported, and the previous usable state is preserved.

## 9. Switching profiles

### 9.1 Standard switching

When a user selects another profile:

1. CS3 identifies the target profile by stable ID.
2. The current draft state is checked for unsaved changes.
3. If switching is allowed, the target profile's saved scope is resolved.
4. The effective scope is written through `SearchScopeStore`.
5. The active profile ID and full profile state are committed.
6. Persistence completes.
7. The UI renders the returned authoritative state.

Switching must not merge the target profile with the previous profile's selections.

### 9.2 Switching with a dirty draft

If the user has unsaved changes, display a small confirmation dialog:

**Unsaved changes**

You have unsaved changes to your source selection.

- Save changes
- Discard changes
- Cancel

The behavior is:

| Action | Result |
|---|---|
| Save changes | Commit changes to the appropriate profile or save as a new profile, depending on the current draft context, then switch |
| Discard changes | Restore the destination profile's saved scope and switch |
| Cancel | Keep the current selection and active profile unchanged |

If saving fails, do not switch profiles. The draft and its changes must remain available for recovery.

Do not show this confirmation for clean profiles.

### 9.3 Rapid switching

Concurrent switch operations must not produce a mixed state.

If a user rapidly selects multiple profiles, CS3 must either serialize the operations or invalidate stale requests so the final state matches the last successfully committed action.

A delayed response from an earlier request must never overwrite a newer active selection.

### 9.4 Acceptance criteria

- Switching restores the exact saved configuration of the destination.
- A dirty draft is never silently discarded.
- Cancel leaves the current state unchanged.
- Failed activation preserves a recoverable state.
- Active profile and effective scope are consistent after every completed transition.

## 10. Dirty drafts and editing

### 10.1 Definition

A draft is dirty when the effective configuration differs from its committed baseline.

Dirty state should be derived from a stable snapshot or version comparison, not maintained as an unrelated boolean that can drift from the actual scope.

The comparison must account for the scope's semantics. If source selections are set-based, ordering-only differences must not mark the draft dirty unless ordering is part of the persisted configuration.

### 10.2 Editing a saved profile

The user should be able to change source selections while a named profile is active.

The UI must clearly indicate that the configuration has unsaved changes.

Recommended actions:

- Save changes
- Discard changes
- Save as new profile

Saving changes updates the current profile. Saving as new profile preserves the original and creates an independent configuration.

### 10.3 Draft editing

If the user edits the unnamed draft, changes must remain separate from every saved profile until the user explicitly saves or creates a profile.

The draft is not an implicit alias for the active named profile.

### 10.4 Closing the dialog

When the user attempts to close a dialog containing a dirty draft, CS3 must not silently discard the draft.

Offer the appropriate choices:

- Save changes
- Discard changes
- Continue editing

If the current UI already applies changes immediately, do not add a second, contradictory draft mechanism. The implementation must establish one consistent transaction boundary for source-selection edits.

### 10.5 Dirty state across restart

The application must define whether drafts survive a restart.

Recommended behavior:

- Persist the last committed profile state and effective scope reliably.
- Persist a recoverable draft if the existing profile model supports it without introducing inconsistent state.
- If drafts are not persisted, discard them only after a clear warning when necessary.
- Never mark a discarded draft as saved.

The existing architecture includes an unnamed draft in the profile state. Its exact restart and recovery semantics must be verified in `sourceProfiles.ts` and `sourceProfileStore.ts` before implementation.

## 11. Persistence and atomicity

### 11.1 Source of truth

`cs3_source_profiles` stores named profiles and profile state.

`cs3_search_scope` stores the effective search scope consumed by the search subsystem.

The profile store is responsible for keeping them consistent.

The renderer must not write either persistence key directly.

### 11.2 Atomic logical transitions

Operations that affect both profile state and effective scope must be treated as one logical transaction.

Examples include:

- Activating a profile.
- Creating and activating a profile.
- Saving a modified profile.
- Deleting the active profile.
- Switching from a dirty draft.

If the underlying storage does not support a multi-key atomic transaction, the store must implement a safe ordering and recovery strategy.

At no point should the UI claim a profile was activated when the effective scope still represents the previous profile.

### 11.3 Error handling

Every fallible profile operation must return a failure result with a useful explanation, following the existing IPC response conventions.

The UI should distinguish:

- Invalid profile name.
- Profile no longer exists.
- Selected source cannot be resolved.
- Persistence failure.
- Concurrent state change.
- Invalid stored profile data.

Do not convert a failed operation into a successful empty configuration.

### 11.4 Restart behavior

On application startup:

1. Load and validate persisted profile state.
2. Restore the active profile ID and draft state.
3. Resolve the effective scope.
4. Reconcile it with the persisted search scope according to the profile store's authoritative rules.
5. Report corrupt or missing references without silently broadening the selection.
6. Expose the complete state to the renderer.

If stored profile state is invalid, recovery must preserve as much valid configuration as possible and provide a clear explanation.

### 11.5 Backup and restore

Profile data must continue to participate in the existing backup and restore mechanism if included by the current datastore snapshot.

After restore, the active profile and effective scope must be reconciled through the profile store. Restoring profile data must not bypass the strict-scope rules.

## 12. Applying profiles to strict search scope

This is the most important functional requirement.

### 12.1 Strict means exact

A profile defines which sources a search may use.

It does not merely prioritize those sources while allowing all others to participate.

When the profile selects specific providers, only those selected and effectively eligible providers may be queried under the existing search contract.

When indexers are selected, only those selected indexers may be title-searched under that contract.

When the profile represents all-sources mode, the existing all-sources search behavior applies.

### 12.2 Missing providers and indexers

A selected provider may be missing because an extension was removed, a repository became unavailable, or the provider registry changed.

CS3 must report the missing selection.

It must not:

- Replace the missing provider with every enabled provider.
- Remove the missing provider silently from the saved profile.
- Widen the scope to all sources.
- Claim that the missing provider was searched successfully.

The profile may remain saved even when some of its source identifiers are currently unresolved.

The UI should distinguish the saved selection from the currently resolvable subset.

### 12.3 Provider enablement

A profile selection does not override global provider, extension, repository, native-provider, or adult-content enablement.

A selected provider can be excluded from execution by the existing enablement cascade.

The UI should explain the reason and provide a route to the relevant settings or repair workflow where appropriate.

Re-enabling a provider globally should not require rebuilding the profile.

### 12.4 Catalogues

Selecting providers invokes the existing provider-only search plan and excludes catalogues.

An all-sources configuration follows the existing behavior that includes enabled providers and catalogues.

The profile system must not introduce a separate catalogue toggle unless the search-scope model and search planner are deliberately extended to support it.

### 12.5 Per-search overrides

Any explicit per-search override must remain temporary and must not rewrite the stored profile unless the user deliberately saves the change.

Existing discovery scope, origin-based discovery, playback recovery, and other narrowly scoped operations must retain their current semantics.

A profile must not cause a discovery request to expand unexpectedly, nor should a profile override disable an existing user-requested recovery action.

### 12.6 Empty results

If a strict profile returns no results, CS3 should explain that the selected scope produced no results.

It must not automatically broaden the stored profile.

If the product offers an explicit action to search more sources, that action must be separate, understandable, and governed by the existing search or recovery contract. It must not silently change the active profile.

## 13. IPC and state consistency

The existing `profiles:*` API should remain the only profile-management boundary.

### 13.1 Required operation behavior

| Operation | Required result |
|---|---|
| `list` | Complete profile state |
| `activate` | Complete state after successful activation |
| `create` | Complete state after creation |
| `rename` | Complete state after rename |
| `duplicate` | Complete state after duplication |
| `delete` | Complete state after deletion |

Every response must contain the complete authoritative state, including:

- Named profiles.
- Active profile ID.
- Unnamed draft.
- Any existing state metadata required by the implementation.

### 13.2 Renderer behavior

The renderer must replace its local profile state from the complete response rather than attempt to merge partial changes.

On failure, it must retain a recoverable state and display the error.

The renderer must not independently update the active profile ID and search scope in separate state stores.

### 13.3 Concurrent mutations

Profile mutations should be serialized or protected by version checks so two concurrent actions cannot overwrite each other's changes.

Stale responses must not restore an obsolete active profile or draft.

If a mutation is rejected because the underlying state changed, the renderer should refresh the full state and let the user retry.

## 14. Accessibility and interaction design

- All profile actions must be keyboard accessible.
- Dialogs must use the existing CS3 `Dialog` and `DialogActions` components.
- Focus must return to the invoking control when a dialog closes.
- Escape must not silently discard a dirty draft.
- Active state must be communicated by more than color alone.
- Destructive actions must use the established destructive-action style.
- Buttons must use the shared design system rather than custom one-off button styling.
- Error messages must identify the failed action and provide a useful next step.
- The profile selector should remain compact and should not display all profile-management controls simultaneously.

## 15. Non-functional requirements

### Performance

- Switching profiles must not load every provider archive merely to resolve the profile.
- Profile operations must use the existing registry and scope resolution mechanisms.
- Source counts should be derived from the current source inventory and selection, not from repeated expensive provider calls.
- Large selections must not freeze the renderer.
- The UI should remain responsive while profile persistence completes.

### Reliability

- Profile mutations must be deterministic.
- Persistence failures must not silently corrupt the effective scope.
- Repeated activation of the already-active profile should be idempotent.
- Duplicate operations must create distinct profiles only when the user explicitly requests them.
- Deleted profile IDs must not remain active.

### Privacy

Profiles should store configuration identifiers and the minimal metadata needed for their operation. They must not store search queries, viewing history, resolved stream URLs, or unrelated provider analytics.

## 16. Acceptance test matrix

| Scenario | Expected result |
|---|---|
| Create a profile from the current selection | New profile preserves the selected scope and becomes active after successful commit |
| Create a profile with an empty name | Rejected without changing current state |
| Rename the active profile | Name changes; scope and active ID remain consistent |
| Rename an inactive profile | Active scope remains unchanged |
| Duplicate a profile | New ID and independent configuration |
| Delete an inactive profile | Active profile remains unchanged |
| Delete the active profile | Valid destination state is activated; no dangling active ID |
| Delete the last named profile | Unnamed draft and existing all-sources mode remain usable |
| Switch from a clean profile | Exact target configuration becomes effective |
| Switch from a dirty profile | User must save, discard, or cancel |
| Save a dirty profile and persistence fails | Draft remains recoverable; no false success |
| Search with selected providers | Only those selected providers are eligible; catalogues are not queried |
| Search with selected indexers | Only the selected indexers are title-searched under the existing contract |
| Search with an unresolved provider | Missing source is reported; scope is not widened |
| Provider is disabled globally | Profile remains saved; execution follows the enablement cascade |
| Restart after successful save | Profile and effective scope are restored consistently |
| Restore a backup containing profiles | Profile state is reconciled through the profile store |
| Rapidly activate two profiles | Final state corresponds to the last committed operation |
| Search filters hide selected sources | Hidden sources remain selected unless explicitly changed |
| Use an all-sources mode | Existing all-sources semantics apply without deleting profiles |

## 17. Implementation sequence

### Phase 1: Audit and establish invariants

Review `sourceProfiles.ts`, `sourceProfileStore.ts`, `searchScope.ts`, the `profiles:*` handlers, and the renderer's profile selector.

Document the actual state machine, the current meaning of the unnamed draft, and the transaction boundaries.

Add or update pure tests for the profile state machine before changing the UI.

### Phase 2: Make state transitions reliable

Ensure every operation returns the complete state, keeps the active ID and effective scope consistent, and handles persistence errors without silent scope widening.

Add tests for active-profile deletion, missing source references, dirty-draft transitions, and concurrent mutations.

### Phase 3: Implement the profile UX

Introduce the compact profile selector, contextual actions, clear dirty-state indication, and a consistent save/discard/cancel flow.

Preserve existing source-selection and bulk-selection capabilities.

### Phase 4: Verify integration

Test search execution against real resolved scopes, including provider-only searches, indexer-only selections, all-sources mode, missing providers, disabled providers, and restart recovery.

Confirm that no downstream service needs to know which profile is active.

### Phase 5: Migration and regression testing

Preserve existing profile and scope data. Do not silently reset users' configurations during schema changes.

Test backup/restore, application restart, failed persistence, and existing source-selection workflows before release.

## 18. Definition of done

The feature is complete when:

1. All six existing profile operations work reliably.
2. Profiles can be created, renamed, duplicated, deleted, and switched without corrupting the effective scope.
3. Dirty drafts are clearly represented and cannot be silently discarded.
4. Persistence and restart recovery preserve the authoritative state.
5. Profile activation writes through to the existing `SearchScopeStore`.
6. Search continues to enforce strict selection semantics.
7. Missing sources are reported rather than silently replaced.
8. Provider installation and global enablement remain independent of profile selection.
9. The interface exposes common profile actions without overwhelming the source-selection dialog.
10. The existing source-scope, bulk-selection, backup/restore, and search tests continue to pass.

**Core rule:** a profile is a named configuration over the existing strict search scope. It must simplify how users manage that configuration without introducing a second source of truth or changing what a selected source means. With our design system and reusing design principles, profiles should feel like a natural extension of the existing search experience rather than a separate layer of complexity. here is our design should follow 
UI/UX Refinement

## UI/UX Refinement: Minimal, Clean, and Enterprise-Grade Experience

Review and improve the overall UI/UX across the application to create a clean, modern, intuitive, and visually consistent experience inspired by well-designed applications such as VS Code and Chrome.

The goal is to make the application **feature-complete without feeling feature-bloated**. Preserve all existing features, functionality, and capabilities while reducing unnecessary visual complexity, excessive information, oversized components, redundant controls, and competing visual elements.

### Design Principles

1. **Minimal and Clean Interface:** Reduce visual clutter, excessive spacing, oversized elements, unnecessary borders, prominent containers, and redundant controls. Maintain a balanced visual hierarchy with consistent sizing, spacing, typography, and styling across the application.

2. **Progressive Disclosure:** Do not display all available information, instructions, settings, and controls at once. Show only what users need for the current context. Move secondary information, advanced options, detailed explanations, and less frequently used actions into tooltips, popovers, hover interactions, contextual menus, expandable sections, or other appropriate UI patterns.

3. **Intuitive Interactions:** Improve the design and usability of interactive components, especially enable/disable controls, toggles, buttons, selectors, settings, and configuration panels. Their purpose and current state should be immediately understandable without requiring users to study the interface.

4. **Concise and Clear Content:** Keep labels, descriptions, instructions, tooltips, and helper text short, simple, and easy to understand at a glance. Avoid lengthy explanations, verbose descriptions, redundant information, and unnecessary instructional text. Use plain, direct language that communicates the purpose of a feature without overwhelming the interface.

5. **Subtle but Accessible Controls:** Keep frequently used actions easy to discover and access without making them visually dominant. Make secondary actions visually quieter while ensuring essential actions remain discoverable and accessible. Use contextual visibility where appropriate, without making important functionality difficult to find.

6. **Consistent Component Design:** Review existing components and establish consistent interaction patterns, visual hierarchy, spacing, sizing, states, and styling. Similar components should behave and look consistent throughout the application rather than using different patterns for the same purpose.

7. **Reduce Cognitive Load:** Users should be able to understand the interface and complete common tasks without needing to learn the application beforehand. Make functionality self-explanatory through clear labels, familiar interaction patterns, sensible defaults, and contextual guidance only when necessary.

8. **Preserve Functionality:** Do not remove existing features, capabilities, actions, configuration options, or essential information simply to achieve a minimal appearance. Refine how they are presented, organized, and accessed instead. Avoid unnecessary changes to underlying business logic or behavior.

### Implementation Guidelines

Review the application as a whole, including individual screens, shared components, dialogs, forms, settings panels, toolbars, menus, and other interactive elements.

Identify areas where the interface feels bloated, crowded, repetitive, visually dominant, or unnecessarily complicated. Prioritize improvements that meaningfully simplify the experience without compromising functionality, discoverability, accessibility, or usability.

Prefer contextual help over permanently visible explanations. Use tooltips or popovers for supplementary information, concise descriptions for primary context, and expandable sections for advanced or optional details. Ensure that these patterns are accessible and work appropriately across supported interaction methods, including keyboard and touch where applicable.

Avoid introducing unnecessary components, decorative elements, extra containers, excessive animations, or new layers of navigation merely to make the interface appear modern. Reuse and improve existing shared components wherever practical.

Follow the application's established design system and technical conventions. Make reusable improvements at the component level when appropriate so that the same refinement is applied consistently across all relevant screens.

### Expected Outcome

The final interface should feel lightweight, polished, professional, and intuitive, with a clear visual hierarchy and minimal unnecessary information. Users should immediately understand what matters, find common actions easily, and access additional functionality when needed without being overwhelmed.

**Success criterion:** Retain the full functionality of the application while making its interface significantly cleaner, more consistent, less visually dominant, and easier to use. Every visible element should serve a clear purpose, and every secondary detail should appear only when it adds value to the current interaction.


