> **Filed 2026-10-20: Partial / pending.** Some parts are built; the rest is roadmap. See [docs-audit-2026-10-20](../roadmap/docs-audit-2026-10-20.md).

# PRD: Improve Search Sources Selection, Profiles, and Bulk Actions

## 1. Objective

Improve the Search Sources dialog and selection panel in `src/components/search/SourceScopeDialog.tsx`, with particular attention to usability, profile management, bulk-selection safety, and visual clarity.

The current interface supports extensions, torrent providers, content-type and language filters, saved source profiles, and a hierarchical source list. However, profile creation is not sufficiently discoverable, bulk changes lack clear impact feedback, language and content-type options rely heavily on text labels, and the **Done** action mixes source configuration with search execution.

The goal is to make source selection safer, more intuitive, and faster while keeping the interface minimal, compact, and consistent with the existing application.

## 2. Requirements

### 2.1 Confirm Destructive or Large-Scale Selection Changes

Users can select providers and extensions through individual checkboxes, repository-level controls, bulk actions, and the selected-sources tray. Actions such as **Clear all**, **Select all**, **Invert**, **Reset**, or switching profiles can significantly change the active selection.

Implement a confirmation step for actions that would remove or substantially change the current selection.

The confirmation must:
- Clearly identify the action the user initiated.
- Summarize the expected selection changes before they are applied.
- Show the number of sources to be added, removed, and retained or otherwise unchanged, where applicable.
- Distinguish extensions from torrent indexers when the breakdown is available.
- Provide explicit **Cancel** and **Confirm changes** actions.
- Preserve the current selection if the user cancels.
- Avoid unnecessary confirmation dialogs for routine, low-impact individual checkbox changes.

For example:

> **Clear all selected sources?**
>
> This will remove 381 selected sources from your current selection.
>
> - Sources removed: 381
> - Sources added: 0
>
> Cancel · Clear selection

Calculate the impact from the actual current and proposed selections. Do not rely on fixed counts or generic warning text.

### 2.2 Improve Source Profile Management

Profile management must be discoverable and accessible directly from the Search Sources dialog.

#### Profile creation
- Add a clearly visible **+ Create profile** action in the profile bar.
- Allow users to create a profile from their current source selection without duplicating an existing profile first.
- Provide a straightforward way to name and save the profile.
- Keep profile creation optional. Users must be able to select sources without creating a profile.
- Support multiple custom profiles and make the active profile or unsaved selection state clear.

#### Profile actions
Provide appropriate actions for existing profiles, including:
- Activate a profile.
- Create a new profile.
- Duplicate a profile.
- Rename a profile.
- Delete a profile, with confirmation when deletion is consequential.
- Identify unsaved changes to the active profile without forcing users to save them.

When switching profiles would substantially alter the current selection, show the selection-impact confirmation described in Section 2.1.

Do not conflate changing a profile's saved configuration with initiating a search.

### 2.3 Provide Useful Built-In Profiles

Offer a small set of predefined profiles so users can get started without manually selecting providers from a potentially large list.

Suggested profiles include:

- **All Sources**: Use all eligible installed sources.
- **English**: Prioritize sources associated with English-language content.
- **Hindi**: Prioritize sources associated with Hindi-language content.
- **Anime**: Focus on sources suitable for anime.
- **Asian Drama**: Focus on sources suitable for Asian dramas.
- **NSFW**: Focus on sources categorized for NSFW content, subject to the application's existing adult-content settings.

These are proposed defaults and should be finalized against the actual provider metadata and selection behavior.

Requirements:
- Present built-in profiles alongside custom profiles in a clear, compact profile selector.
- Use concise names and recognizable visual indicators where helpful.
- Include a short description or tooltip explaining each profile's purpose.
- Make the default **All Sources** behavior easy to restore.
- Keep built-in profiles distinct from user-created profiles.
- Do not imply that a profile guarantees content availability or provider compatibility.
- Respect existing adult-content restrictions. An NSFW profile must not bypass the application's adult-content gate.

Profile activation must update the selection state only. It must not automatically initiate a search.

### 2.4 Separate Source Configuration from Search Execution

The current **Done** interaction must not automatically trigger a new search merely because the user closes or confirms the source-selection dialog.

Separate these responsibilities:

**Source selection dialog**
- Manages the selected sources and profiles.
- Applies or commits the user's source-selection changes according to the existing state-management model.
- Closes when the user finishes configuring the selection.
- Does not automatically execute a search.

**Search interface**
- Starts a search only when the user explicitly submits a query or invokes the existing search action.
- Uses the latest committed source selection when the search begins.

Requirements:
- Preserve the current search query when opening or closing the dialog.
- Do not clear or resubmit the query as a side effect of source selection.
- Do not show an unnecessary loading state or refresh results simply because the user clicks **Done**.
- Ensure that the next explicit search uses the updated selection.
- Preserve the distinction between temporary editing, committed selection changes, and saved profiles.

If the existing architecture requires a separate apply/commit operation, implement it without coupling it to search execution.

### 2.5 Improve Bulk-Action Feedback

Bulk operations must provide immediate, understandable feedback about their effects.

Cover:
- Clear all.
- Select all.
- Select filtered.
- Invert selection.
- Reset to the default selection.
- Repository-level All/None actions.
- Bulk changes resulting from profile activation.

Before a consequential bulk operation is applied, display its expected impact. After a successful operation, provide concise feedback when useful.

Examples:
- “12 sources added, 4 removed.”
- “381 sources cleared.”
- “Selection reset to All Sources.”

Avoid redundant notifications for every checkbox or minor interaction. The goal is to prevent accidental changes without overwhelming users with prompts.

### 2.6 Improve Selected Sources Presentation

The current selected-sources section, including labels such as **Selected sources (381)** and the expandable/collapsible controls, should be redesigned to communicate selection state more clearly without consuming excessive vertical space.

Requirements:
- Display the selected-source count prominently but unobtrusively.
- Distinguish selected extensions and torrent indexers when useful.
- Keep selected-source chips compact, readable, and removable.
- Preserve the ability to expand or collapse the section.
- Provide a clear **Clear all** action, subject to the bulk-change confirmation rules.
- Make the collapsed state understandable, including how many selected sources are hidden.
- Prevent the selected-sources section from dominating the dialog when hundreds of sources are selected.
- Ensure that removing a source from the selected-sources tray updates the corresponding selection state consistently in the source tree.

The expanded and collapsed states must remain usable at different window sizes.

### 2.7 Improve Language Selection with Visual Indicators

The language filter currently uses short labels such as `EN`, `HI`, `TA`, and similar codes. Keep the compact labels but supplement them with recognizable visual cues to make scanning and selection easier.

Requirements:
- Use language names and language codes consistently.
- Add relevant flag or regional indicators where they genuinely help users identify a language or locale.
- Keep the visual treatment compact and consistent across the filter rail, profile selector, and source-tree metadata.
- Provide accessible names or tooltips containing the full language name.
- Support keyboard navigation and selected/unselected states.
- Do not rely on flags alone to communicate language. A flag represents a country or region, not a language, and some languages are used across multiple regions.
- Where a language has no clear single regional association, use a neutral language icon or another consistent indicator instead of implying an inaccurate country association.

Examples:
- English: `EN` with an appropriate regional indicator only when the locale is known.
- Hindi: `HI` with an India indicator.
- Tamil: `TA` with an India or Sri Lanka indicator only when the relevant locale is known.

Do not arbitrarily assign a country flag to every language.

### 2.8 Improve Content-Type Filter Presentation

The content-type filter includes categories such as Movies, TV Series, Anime, Asian Drama, Cartoons, Documentaries, and NSFW. Improve their visual hierarchy and scanability while preserving the compact layout.

Requirements:
- Use concise labels with subtle, recognizable icons where they improve recognition.
- Keep the filter controls visually consistent and easy to distinguish between selected, unselected, and unavailable states.
- Use a compact grid or chip layout appropriate to the available width.
- Provide tooltips or accessible labels where an icon may be ambiguous.
- Keep the **All** and **None** actions visible and logically associated with the content-type group.
- Maintain clear spacing and avoid excessive decoration, large icons, or oversized filter controls.
- Ensure NSFW remains visually identifiable without overwhelming the rest of the interface or bypassing existing content restrictions.

Use the same visual language consistently throughout the dialog.

### 2.9 Refine the Source Tree and Expandable Controls

Improve the hierarchy and usability of repository folders, provider rows, and expandable sections.

Requirements:
- Make the distinction between repository rows and individual provider rows immediately apparent.
- Improve alignment of checkboxes, disclosure controls, labels, language indicators, and provider metadata.
- Keep repository-level selection and expansion controls easy to discover.
- Make mixed selection states visually distinct from fully selected and unselected states.
- Reduce unnecessary borders, nested containers, and visual noise.
- Preserve compact row heights and efficient scanning for large source lists.
- Keep search filtering, virtualization, and existing keyboard navigation functional.
- Ensure the selected-sources tray, profile bar, filter rail, and tree remain visually balanced rather than competing for attention.

Avoid introducing decorative complexity that reduces the number of visible sources.

## 3. Interaction and State Requirements

The implementation must preserve clear boundaries between the following states:

1. **Draft selection**: Changes currently being made in the dialog.
2. **Committed selection**: The source set that will be used by the next explicit search.
3. **Saved profile**: A named, reusable source configuration.
4. **Built-in profile**: A predefined configuration supplied by the application.
5. **Display filters**: Filters that narrow which source rows are visible without changing selection by themselves.

Requirements:
- Changing display filters must not silently modify the selected source set.
- Selection changes must be reflected consistently in the tree, selected-sources tray, profile state, and footer summary.
- Saving a profile must not automatically trigger a search.
- Applying a profile must not automatically trigger a search.
- Closing or reopening the dialog must follow a consistent, predictable draft and commit policy.
- Cancelling a confirmation must leave the current selection unchanged.
- Resetting the selection must not delete saved custom profiles.
- Deleting a profile must not accidentally clear the active selection unless that behavior is explicitly intended and communicated.

## 4. Accessibility and Keyboard Support

Preserve existing accessibility and keyboard-navigation behavior while improving the UI.

Requirements:
- All profile actions, filters, source rows, bulk controls, and confirmation dialogs must be keyboard accessible.
- Use accessible names for icon-only controls, including create, expand, collapse, remove, and clear actions.
- Confirmation dialogs must receive appropriate focus when opened and return focus to the initiating control when dismissed.
- Use visible focus indicators and maintain adequate contrast.
- Ensure selected and mixed checkbox states are exposed correctly to assistive technology.
- Provide full language and content-type names through accessible labels or tooltips.
- Avoid communicating state through color or flags alone.

## 5. Performance and Scale

The dialog must remain responsive with hundreds of providers and large repositories.

Requirements:
- Preserve virtualized rendering of the source tree.
- Avoid expensive full-tree rerenders for unrelated profile or filter changes.
- Keep bulk-selection impact calculations efficient.
- Prevent confirmation previews from blocking interaction with the dialog.
- Ensure that expanding selected-source chips does not cause unstable layout or excessive rendering.
- Preserve responsive behavior at different desktop window sizes.

## 6. Acceptance Criteria

The work is complete when all of the following are verified:

1. A user can create a named profile directly from the profile bar without duplicating an existing profile.
2. Built-in profiles are available and clearly distinguished from custom profiles.
3. Consequential bulk actions display an accurate preview of added and removed sources before applying the change.
4. Cancelling a confirmation leaves the selection unchanged.
5. Individual checkbox changes remain straightforward and do not trigger unnecessary confirmation prompts.
6. The selected-sources tray clearly communicates the count, supports compact expansion, and remains synchronized with the tree.
7. Language filters are easier to scan using appropriate visual indicators and accessible full names.
8. Content-type filters use a consistent, compact visual treatment that improves scanability.
9. Switching or saving a profile does not automatically execute a search.
10. Clicking **Done** closes or commits the dialog without automatically submitting the current search.
11. The next explicit search uses the committed source selection.
12. Display filters do not silently change the selected source set.
13. Resetting selection preserves saved custom profiles.
14. The dialog remains responsive with hundreds of sources.
15. Existing keyboard navigation, accessibility, source-tree virtualization, and selection behavior continue to work correctly.

## 7. Implementation Guidance

Use `src/components/search/SourceScopeDialog.tsx` as the primary entry point and inspect the existing profile manager, selected-sources tray, source-tree row renderer, search submission flow, and source-selection state management before making changes.

Reuse existing components, state, and styling conventions wherever possible. Avoid duplicating profile logic or creating parallel selection state.

Treat the attached **Search Sources Panel & Modal — UI & UX Specification** as the baseline for the existing layout and controls. Improve the current implementation incrementally rather than replacing the entire dialog without a demonstrated need.

Prioritize implementation in this order:

1. Separate source selection from search execution.
2. Add accurate confirmation previews for consequential bulk changes.
3. Improve profile creation and provide built-in profiles.
4. Refine selected-source presentation and source-tree hierarchy.
5. Improve language and content-type filter visuals.
6. Validate accessibility, responsiveness, performance, and regression behavior.

The final result should feel minimal, predictable, safe, and efficient, even when the user has hundreds of providers installed.