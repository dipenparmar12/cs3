> **Built 2026-10-29.** On screen, search profiles are **source sets**, and **Start from** (one set, radio marks) is drawn unlike **Narrow down** (filters, checkbox pills). `SourceProfileBar.tsx` (sets as visible choices, Save as source set, name checks in `profileNaming.ts`, Replace), `SourceScopeDialog.tsx` (all chips, ⓘ help, one footer summary), `SearchScopePicker.tsx` (`onReplace`, save feedback), styles in `sources.css`. Checked in the built app on a copy of the scratch profile. Status lives in `ROADMAP.md`.

# PRD: Simplify and Redesign the Search Source Scope Dialog

## 1. Objective

Redesign `src/components/search/SourceScopeDialog.tsx` to make source selection simpler, cleaner, more intuitive, and visually appealing without removing any existing functionality.

The current panel has useful capabilities, but the interface feels crowded and requires users to navigate dropdowns and read lengthy explanations to understand how source selection works.

The goal is to make the available source-selection options immediately visible, reduce unnecessary text, and allow users to configure and save their preferred source-selection profiles with minimal effort.

**Core principle: Users should understand how to select their search sources simply by looking at the interface, without needing to learn how it works first.**

## 2. Current UX Problems

Review the existing component and identify the specific UI patterns contributing to the current experience.

Known issues include:

- The panel contains too much information and feels visually crowded.
- Long explanatory sentences and paragraphs compete with the actual controls.
- Source-selection options are hidden inside a dropdown, requiring additional navigation.
- Users cannot immediately see all the available source-selection choices.
- The purpose of some controls is not obvious without reading their descriptions.
- The workflow for saving the current selection as a reusable profile is not sufficiently simple.
- The visual hierarchy does not adequately distinguish primary actions, source-selection controls, and secondary information.

Preserve the useful functionality of the existing panel. This task is primarily a UX and interaction redesign, not a reason to remove capabilities or rewrite unrelated search logic.

## 3. Design Principles

### 3.1 Minimal and intuitive

- Prefer clear labels, familiar controls, and concise wording.
- Remove unnecessary explanatory paragraphs from the main interface.
- Use visual hierarchy and spacing instead of additional text.
- Make the primary actions obvious without overwhelming the user.
- Avoid decorative elements that do not help users understand or operate the panel.

### 3.2 Keep source-selection controls visible

Users should be able to see and access all relevant source-selection options directly in the panel.

Do not require users to open a dropdown merely to discover or select all available sources.

Use an appropriate layout for the existing source categories and selection modes. All important options should remain discoverable without navigating through nested controls.

If the number of available sources is large, use compact groups, clear section headings, and appropriate scrolling rather than hiding essential controls behind an additional interaction.

### 3.3 Progressive disclosure

Not every explanation needs to remain visible all the time.

Keep essential controls and short labels visible. Move detailed explanations, advanced information, and longer descriptions into the existing eye-icon information popovers used elsewhere in CS3.

The interface should remain understandable even when users never open those popovers.

### 3.4 Preserve functionality

Before modifying the component, inspect its existing state model, selection modes, profile behavior, persistence, validation, and integration with the search workflow.

Retain all supported source-selection capabilities and ensure that the redesign does not change their semantics.

## 4. Proposed Interface Structure

Redesign the panel around a small number of clearly organized sections.

### 4.1 Header

Use a concise title such as **Search Sources** or retain the current title if it already communicates the purpose clearly.

The header should contain:

- A short title.
- An optional eye-icon information control for detailed guidance.
- A clear close or dismiss control, consistent with the existing dialog behavior.

Avoid placing a long explanatory paragraph below the title.

### 4.2 Current Profile

Make the active source-selection profile easy to understand.

Show the current profile name or selection mode and provide a compact way to change it, consistent with the existing profile functionality.

The active state should be visually clear without using excessive badges, labels, or decorative containers.

### 4.3 Visible Source Selection

Display the available source-selection choices directly in the panel.

Requirements:

- Keep all important selection modes visible.
- Make the option to select all sources immediately accessible.
- Make it easy to select or deselect individual source categories or providers where supported.
- Show the selected state clearly.
- Provide a concise selection summary, such as the number of selected sources, when useful.
- Avoid duplicating the same information in multiple places.
- Keep existing selection semantics and provider identities intact.

Use familiar controls such as checkboxes, compact selection rows, or segmented controls where appropriate to the actual data model.

Do not invent additional selection modes that the current implementation does not support.

### 4.4 Save Current Selection as a Profile

Add a simple, visible **Save Profile** action for the current selection.

The workflow should allow users to configure their sources and save the current configuration for reuse without navigating through unrelated settings.

Expected behavior:

1. The user changes the source selections.
2. The interface reflects the current configuration immediately.
3. The user selects **Save Profile**.
4. A compact dialog or inline control asks for a profile name when necessary.
5. The user confirms.
6. CS3 saves the configuration using the existing profile persistence mechanism.
7. The saved profile becomes available for later selection.

If the current implementation already supports named profiles, reuse its data model and persistence behavior.

Handle existing profile names, invalid names, empty names, and cancelled saves appropriately. Do not silently overwrite an existing profile without clear confirmation when that behavior could destroy user preferences.

Distinguish between an unsaved selection and a saved profile when that distinction is meaningful. Avoid unnecessary save prompts when the current selection already matches the active saved profile.

### 4.5 Secondary Actions

Keep secondary actions visually quieter than the main selection controls.

Examples may include:

- Reset to defaults.
- Manage saved profiles.
- Additional selection settings.
- Detailed source-selection guidance.

Retain only actions supported by the existing implementation or explicitly required by the redesigned workflow.

Avoid turning every available action into a prominent button.

## 5. Eye-Icon Information Popovers

Use the application's existing eye-icon information popover pattern to display explanations that do not need to remain visible in the main UI.

### 5.1 Content to move into popovers

Where applicable, move lengthy explanations about:

- What a source-selection mode does.
- How source profiles affect searches.
- How source inclusion or exclusion works.
- Advanced selection behavior.
- Any non-obvious limitations or consequences of a selection.

### 5.2 Popover requirements

- Use the same eye-icon and popover pattern already established in CS3.
- Keep the main control labels short and understandable.
- Make the popover content concise and relevant to the associated control.
- Avoid duplicating information already obvious from the control itself.
- Ensure popovers work with mouse, keyboard, and supported touch interactions.
- Keep popovers readable at different window sizes and application layouts.

Do not create a new, inconsistent information-tooltip system if a suitable shared component already exists.

## 6. Visual Design and Layout

The redesigned panel should feel lightweight, structured, and easy to scan.

### Layout requirements

- Establish a clear hierarchy between the title, active profile, source controls, and actions.
- Use consistent spacing and alignment.
- Reduce unnecessary borders, nested cards, and decorative backgrounds.
- Avoid excessive vertical stacking when a compact layout can present the same information clearly.
- Keep source-selection controls visually grouped by their actual purpose.
- Make selected and unselected states easy to distinguish.
- Ensure primary actions remain easy to locate.
- Support the application's existing light and dark themes.
- Respect the current design system, typography, icon conventions, and component patterns.

The goal is not to make the panel smaller at any cost. It is to remove unnecessary visual noise while keeping every important option discoverable.

## 7. Interaction and State Requirements

The redesign must preserve predictable behavior across the complete selection workflow.

- Selection changes should immediately update the visible selected state.
- The current selection must remain consistent with the underlying search configuration.
- Saving a profile must persist the exact intended selection.
- Selecting a saved profile must restore its configuration accurately.
- Switching profiles must not leave stale or partially applied selections.
- Resetting or cancelling must follow the existing behavior and communicate destructive changes when appropriate.
- Closing the dialog must follow the established unsaved-change behavior.
- Search execution must use the intended active selection.
- Loading, saving, and error states must be communicated clearly without excessive messages.

If the component currently has unclear or inconsistent state handling, document the issue and fix it as part of the redesign without unnecessarily expanding the scope.

## 8. Responsive and Accessibility Requirements

- Ensure the panel remains usable at the application's supported desktop window sizes.
- Avoid clipping source controls or primary actions.
- Keep the layout manageable when many providers or categories are available.
- Provide appropriate labels for controls and icon-only actions.
- Preserve keyboard navigation and visible focus states.
- Ensure checkbox and selection states are accessible.
- Maintain sufficient contrast in both themes.
- Avoid relying on color alone to communicate selection state.
- Ensure popovers do not obscure essential controls or become difficult to dismiss.

## 9. Implementation Requirements

Before implementation:

1. Inspect `src/components/search/SourceScopeDialog.tsx`.
2. Identify its child components, styles, state management, and existing selection model.
3. Locate the current dropdown that hides source-selection options.
4. Inspect the existing saved-profile workflow and persistence mechanism.
5. Find and reuse the eye-icon information popover components used elsewhere in CS3.
6. Review adjacent search components to ensure consistent behavior and styling.

Implement the redesign using the existing component architecture and shared UI patterns.

Avoid:

- Rewriting the search engine or provider-resolution system.
- Introducing a second profile persistence mechanism.
- Duplicating selection state unnecessarily.
- Removing existing source-selection options to make the panel appear simpler.
- Adding lengthy descriptions directly beside every control.
- Introducing a new visual design system for this component alone.

## 10. Testing and Validation

Verify the redesigned panel against the following scenarios:

- All relevant source-selection options are visible and accessible.
- Selecting all sources works correctly.
- Individual source selections behave exactly as before.
- The selected state is immediately understandable.
- Saving a new profile persists the current selection.
- Existing profiles can still be selected and restored.
- Profile-name conflicts and invalid inputs are handled correctly.
- Cancelled actions do not unexpectedly modify saved profiles.
- Search uses the intended selection after the dialog closes.
- Eye-icon popovers display the correct contextual explanations.
- The panel remains usable with many providers.
- The layout works in light and dark themes.
- Keyboard navigation and accessibility remain intact.
- Existing search and source-selection tests continue to pass.

## 11. Acceptance Criteria

The redesign is complete when:

1. The source-selection panel looks visibly cleaner and less crowded.
2. Users can discover the available selection options without opening the current source dropdown.
3. All existing source-selection capabilities remain available.
4. Primary controls use concise, intuitive labels.
5. Long explanations are moved to contextual eye-icon popovers where appropriate.
6. Users can save the current selection as a reusable profile through a simple workflow.
7. Saved profiles restore their configurations correctly.
8. The active selection and saved-profile state are clear.
9. The interface follows existing CS3 design conventions and supports the existing themes.
10. No regressions are introduced in search behavior, source selection, or profile persistence.

## 12. Expected Outcome

Transform `SourceScopeDialog.tsx` into a clean, minimal, and intuitive source-selection panel where users can immediately see their options, configure their preferred sources, and save the selection for future searches.

The interface should explain itself through clear controls and visual hierarchy, while detailed information remains available on demand through the existing eye-icon popovers. The result should feel simpler to use without sacrificing any of the functionality that makes the current panel useful.