# CS3 Desktop: Enterprise UI and UX Design Standard

## 1. Objective

We want to elevate CloudStream 3 Desktop into a polished, enterprise-grade application with a consistent, minimal, calm, and highly usable interface.

The current application already has a strong visual foundation, a recognisable identity, and extensive functionality. However, several areas still need significant improvements in information hierarchy, content readability, component consistency, settings organisation, spacing, interaction patterns, and overall visual refinement.

This is not a request to replace the existing application design with an unrelated visual system. It is an application-wide design improvement that should build on the existing foundation.

The objective is to make the application feel:

- Professional and visually consistent.
- Clean, minimal, and comfortable to use for extended periods.
- Information-rich without feeling crowded.
- Easy to understand without requiring users to study the interface.
- Powerful without exposing every available control simultaneously.
- Predictable across screens, workflows, and components.
- Responsive to different window sizes and display configurations.

**Core principle: The application content must remain the primary focus. Controls, labels, statuses, badges, and decorative elements must support the content rather than compete with it.**

## 2. Design philosophy

Follow these principles throughout the application.

### 2.1 Content first, controls second

Every screen must prioritise the information users came to access.

For example:
- Library: users want to identify and manage their saved content.
- Search: users want to discover and compare matching titles.
- History: users want to understand previous activity and continue their work.
- Downloads: users want to understand progress, status, and available actions.
- Settings: users want to find and configure a particular behaviour.
- Extensions: users want to manage providers, repositories, and extension health.

Do not allow controls, labels, icons, or status indicators to occupy more visual attention than the information they support.

### 2.2 Minimal does not mean hiding information

Do not simplify screens by removing useful information or making users navigate through multiple menus to access ordinary functionality.

Instead:
- Show important information immediately.
- Keep supporting information visible when space allows.
- Reveal secondary actions contextually.
- Group advanced controls into meaningful sections.
- Keep specialist options accessible through one clearly identifiable entry point.

Users should not have to sacrifice functionality to get a clean interface.

### 2.3 Reduce cognitive load

Avoid requiring users to interpret too many visual elements simultaneously.

Reduce unnecessary:
- Badges and status labels.
- Repeated headings and descriptions.
- Borders and nested containers.
- Competing accent colours.
- Decorative icons.
- Repeated metadata.
- Unnecessary buttons.
- Permanently expanded configuration sections.

Use emphasis only where it communicates meaningful importance.

### 2.4 Consistency over individual screen creativity

Every screen must feel like part of the same application.

A button, card, section heading, dropdown, tab, status indicator, or settings group should not behave or appear differently without a meaningful reason.

Do not independently redesign every screen. Establish shared rules and apply them consistently.

## 3. Visual design system

Before changing individual screens, inspect the existing design system, tokens, shared UI components, and styles.

Use the existing implementation as the foundation. Improve it where necessary rather than introducing a competing design system.

### 3.1 Design tokens

Establish and consistently use shared tokens for:

| Category | Requirements |
|---|---|
| Typography | Font family, sizes, weights, line heights, hierarchy |
| Spacing | Consistent spacing scale for layouts and components |
| Colours | Background, surface, text, muted text, borders, accent, semantic states |
| Radius | Consistent corner-radius scale |
| Borders | Subtle separators and component boundaries |
| Elevation | Restrained shadows and layered surfaces |
| Controls | Standard heights, padding, icon sizes, and focus states |
| Motion | Consistent duration, easing, and interaction transitions |
| Density | Comfortable and compact presentation where appropriate |

Avoid arbitrary values and one-off styling when an existing token or shared component can serve the same purpose.

### 3.2 Typography

Typography should establish hierarchy without relying on excessive font sizes or bold text.

Use a consistent hierarchy:

1. Screen title.
2. Section title.
3. Primary content or item title.
4. Supporting information.
5. Secondary metadata.
6. Helper text and technical details.

Important content must remain readable. Do not make supporting information so muted or small that users cannot comfortably read it.

Use consistent typography across Library, Search, History, Downloads, Settings, Extensions, detail pages, and player interfaces.

### 3.3 Colour and surfaces

Retain the application's dark visual identity while improving its depth and readability.

Use:
- A consistent application background.
- Clearly differentiated but restrained surface layers.
- Subtle borders where they improve separation.
- One primary accent for important actions and selected states.
- Semantic colours for meaningful warnings, failures, and success states.

Avoid placing every component inside another bordered or differently coloured container.

Not every element needs a background, border, shadow, or badge.

### 3.4 Spacing and alignment

Establish consistent spacing between:
- Navigation items.
- Page headers.
- Section headings.
- Cards and list items.
- Content and metadata.
- Controls and their labels.
- Related settings.
- Panels and their surrounding content.

Maintain predictable alignment across screens. Avoid arbitrary offsets, inconsistent padding, and components that appear slightly misaligned.

## 4. Information hierarchy and visibility rules

Every visible element must have a defined priority.

| Priority | Content | Presentation |
|---|---|---|
| Primary | Main information, selected item, important result, primary action | Immediately visible |
| Secondary | Supporting metadata, context, useful counts | Visible but quieter |
| Contextual | Actions relevant to the current item or selection | Revealed on engagement |
| Advanced | Specialist options and infrequent configuration | Available through a relevant entry point |

Apply the following rules:

- Important information must never depend on hover to become readable.
- Critical states must remain visible.
- Secondary actions may appear on hover, keyboard focus, or selection.
- Advanced controls should be grouped by user intent.
- Do not use tooltips to compensate for missing essential information.
- Do not show a status badge unless it helps users understand or act.
- Do not repeat information already communicated by the surrounding content.

Use the principle of signalling by exception. Normal items should remain visually quiet. Emphasise items that need attention or require an action.

## 5. Cards, lists, and information density

This is a major application-wide improvement area.

Cards and list items should present their information in a balanced, readable, and consistent manner.

### 5.1 Card design requirements

Every card should have a clear hierarchy:

1. Main visual or identity, such as a poster, thumbnail, or icon.
2. Primary title.
3. Important identifying information.
4. Relevant state or progress.
5. Secondary metadata.
6. Contextual actions.

Do not force every card to use the same layout regardless of its content. Establish shared card principles while allowing appropriate variations for posters, downloads, saved searches, extensions, and other content types.

### 5.2 Prevent information clipping

Do not allow important information to become inaccessible because a card has an unsuitable fixed height, excessive image area, or insufficient text space.

For every card:
- Check its minimum readable content area.
- Handle long titles predictably.
- Prevent metadata from being clipped.
- Keep controls inside their intended boundaries.
- Maintain consistent image proportions.
- Avoid overlapping badges and text.
- Ensure the card remains usable at different window sizes.

If the full information cannot reasonably fit into the card, display the essential information and provide a clear detail or expansion interaction.

Do not attempt to display every available attribute simultaneously. Prioritise the information users need to identify and act on the item.

### 5.3 Consistent image and poster presentation

Posters and thumbnails should retain their correct aspect ratios.

Use consistent image containers, predictable cropping, and appropriate fallback states.

Do not allow images to distort, stretch, or consume disproportionate space.

Text and image areas should remain visually balanced.

### 5.4 Responsive layouts

Card dimensions and grid columns must adapt to the available content width.

Do not rely on a fixed number of columns or fixed card dimensions that only work at one window size.

Consider:
- Window resizing.
- Different display resolutions.
- Fullscreen and maximised windows.
- Minimum supported window dimensions.
- Long titles and metadata.
- Empty and partially populated cards.

## 6. Specific issue: Library screen

**File:** `src/views/LibraryView.tsx`

**Reported issue:** Around line 139, the information displayed on the listed items is difficult to read. The current item presentation does not provide a sufficiently balanced relationship between content, posters, metadata, and controls.

Review the actual implementation and identify the precise cause before changing it.

The Library should make it easy to understand and manage:
- What the saved item is.
- Its identity and media type.
- Relevant progress or state.
- Supporting information.
- Available actions.

Review all Library sections, not only Watching:

- Watching.
- Plan to watch.
- Completed.
- On hold.
- Dropped.
- Saved pages.
- Saved searches.
- Saved sources.

Different Library sections may need different item layouts. For example, a saved search is not the same kind of object as a movie poster.

Do not force all sections into a single card template if doing so reduces readability.

### Library acceptance criteria

- Titles and relevant metadata are readable without unnecessary interaction.
- Posters and text have a balanced visual relationship.
- Important item information is not clipped.
- Item actions are easy to discover.
- Cards maintain consistent alignment and spacing.
- Different item types use appropriate layouts.
- The screen adapts correctly to different window sizes.
- Large libraries remain usable without introducing unnecessary rendering or layout overhead.
- Existing filtering, selection, navigation, and management behaviour remains unchanged.

## 7. Navigation and global application layout

Review the shared application shell, including the sidebar, top navigation, page header, content area, and global controls.

### Sidebar

The sidebar should provide a stable navigation structure without consuming unnecessary attention.

Improve:
- Icon and label alignment.
- Navigation item spacing.
- Active-state treatment.
- Group headings.
- Streaming service presentation.
- Sidebar scrolling.
- Collapsed and expanded behaviour, if supported.

Avoid excessive borders, accent outlines, and strong backgrounds on ordinary navigation items.

The active destination should be immediately recognisable without making every navigation item visually prominent.

### Top navigation

The top bar should prioritise global tasks such as search, source scope, profile selection, and other genuinely global actions.

Review spacing, control sizing, alignment, and grouping.

Avoid making the top bar feel like a collection of unrelated buttons.

Keep global controls visually distinct from controls that belong to an individual screen.

### Page layout

Every page should have a consistent structure for:
- Page title.
- Primary actions.
- Main content.
- Section navigation.
- Filters and view options.
- Empty and loading states.

Do not introduce unnecessary page headers or repeated titles when the current context is already clear.

## 8. Settings redesign

The current Settings experience needs particular attention.

Settings are difficult to navigate and understand. The application has many capabilities, but the organisation and presentation make it harder than necessary to find the relevant option.

The objective is to make Settings feel like a well-organised control centre rather than a collection of unrelated configuration panels.

### 8.1 Organise by user intent

Review the existing settings inventory and organise options around the behaviour users want to configure.

Potential categories include:

- General preferences.
- Playback and player.
- Subtitles and audio.
- Search and discovery.
- Library and history.
- Downloads.
- Torrents and indexers.
- Extensions and providers.
- Network and connections.
- Privacy and security.
- Appearance and accessibility.
- Storage and maintenance.
- Developer and diagnostics.
- About and support.

These are organisational candidates, not instructions to create duplicate categories or move settings without examining their existing relationships.

### 8.2 Improve settings navigation

Users should be able to find a setting through:

- A clear category structure.
- A searchable settings interface.
- Descriptive setting names.
- Relevant grouping.
- Search terms and aliases.
- Clear current values.

Retain and improve the existing settings search functionality.

A search result should take the user directly to the relevant setting or section rather than merely showing which category contains it.

### 8.3 Improve settings presentation

Each setting should communicate:

- What it controls.
- Its current value.
- Whether it takes effect immediately or requires saving.
- Any important consequence or dependency.

Use the appropriate control for the task:
- Switch for immediate on/off behaviour.
- Dropdown for a single choice.
- Slider for continuous values.
- Text field for explicit input.
- Grouped controls for related configuration.

Avoid excessive descriptions, unnecessary information icons, and nested collapsible sections.

### 8.4 Progressive disclosure

Show frequently used settings directly.

Group less common settings in clearly named sections.

Specialist settings should remain accessible without forcing users through several nested menus.

Provide an easy way to restore defaults where appropriate.

### 8.5 Consistent settings behaviour

Settings must have predictable:
- Labels.
- Descriptions.
- Control alignment.
- Spacing.
- Validation.
- Save behaviour.
- Reset behaviour.
- Disabled states.
- Feedback.

Do not redesign the underlying settings logic as part of this visual task.

## 9. Interaction design

The interface should feel responsive and natural without unnecessary animation or visual noise.

### 9.1 Control visibility

Use three visibility levels:

**Persistent**
- Essential controls.
- Main actions.
- Important state indicators.
- Navigation and global scope.

**Contextual**
- Item-specific actions.
- Edit, remove, inspect, and similar actions.
- Actions relevant to a selected object.

**On-demand**
- Advanced filters.
- View customisation.
- Specialist options.
- Technical configuration.

Do not hide frequently used actions behind generic overflow menus simply to make a screen look cleaner.

### 9.2 Interaction feedback

Every meaningful action must provide an appropriate response.

Support:
- Hover.
- Keyboard focus.
- Pressed state.
- Selected state.
- Loading state.
- Disabled state.
- Success and failure feedback.

Keep transitions short and purposeful.

Avoid decorative animations that delay interaction or distract from the content.

Respect reduced-motion preferences.

### 9.3 Accessibility

Ensure:
- Readable contrast.
- Consistent keyboard navigation.
- Visible focus indicators.
- Accessible names for icon-only buttons.
- Predictable Escape behaviour.
- Appropriate target sizes.
- No hover-only functionality.
- Readable text at supported display scales.

## 10. Screen-by-screen redesign

Review the entire application rather than treating Library as an isolated issue.

At minimum, inspect:

1. Home.
2. Search.
3. Library.
4. History.
5. Downloads.
6. Extensions.
7. Settings.
8. Media detail pages.
9. Video player.
10. Source selection.
11. Subtitle controls.
12. Streaming service navigation and management.
13. Dialogs, menus, popovers, and shared components.

For each screen:

1. Identify its primary user task.
2. Identify the information users need immediately.
3. Identify what currently competes for attention.
4. Review content density and readability.
5. Review alignment and spacing.
6. Review cards, lists, and reusable components.
7. Review action visibility and discoverability.
8. Review loading, empty, partial, error, and populated states.
9. Identify inconsistencies with the shared design system.
10. Define the smallest practical presentation improvement.

Do not redesign all screens into identical layouts. Consistency means shared visual and interaction rules, not identical composition.

## 11. Application-wide component consistency

Review shared components before implementing individual screen changes.

Prioritise:
- Buttons.
- Icon buttons.
- Inputs.
- Search fields.
- Dropdowns.
- Menus.
- Tabs.
- Badges.
- Cards.
- List rows.
- Dialogs.
- Popovers.
- Tooltips.
- Empty states.
- Loading placeholders.
- Section headers.
- Settings groups.

A shared component should behave consistently wherever it appears.

Do not create another component when an existing component can be improved and reused.

Avoid one-off CSS overrides that gradually create inconsistent behaviour across the application.

## 12. Implementation boundaries

This is a presentation and user-experience improvement task.

**Do not change application logic.**

Preserve:
- Existing business rules.
- Search behaviour.
- Provider and extension functionality.
- Playback pipelines.
- Download behaviour.
- Torrent functionality.
- Metadata processing.
- Persistence.
- Settings values and effects.
- Permissions and privacy.
- IPC contracts.
- Existing navigation and workflows.

Do not change backend services, database schemas, APIs, data calculations, or provider behaviour to accommodate a visual redesign.

Do not remove an existing feature because its current interface is difficult to present.

Do not introduce unnecessary frameworks, dependencies, state-management layers, or design abstractions.

Reuse existing components, tokens, styles, state, and handlers.

If a presentation change requires a behaviour change, identify that dependency separately rather than silently changing it.

## 13. Implementation workflow

### Phase 0: Audit the existing design system

Inspect:
- `AGENTS.md`.
- Existing design-system documentation.
- Shared UI components.
- Design tokens.
- Global styles.
- Application shell.
- Screen implementations.
- Responsive layout rules.

Identify existing conventions before proposing new ones.

### Phase 1: Establish the shared visual standard

Define or refine:
- Typography.
- Spacing.
- Colour usage.
- Surface hierarchy.
- Borders and radius.
- Control dimensions.
- Component states.
- Interaction transitions.

Document the resulting standards in the existing design-system documentation.

### Phase 2: Fix shared components

Improve shared components first so screen-level changes benefit from the same improvements.

Avoid rebuilding components that already meet the requirements.

### Phase 3: Redesign high-impact screens

Prioritise:
1. Library readability and item presentation.
2. Settings navigation and organisation.
3. Home content hierarchy.
4. Search result readability.
5. History and Downloads information density.
6. Extensions and provider management.
7. Media detail and player interfaces.

### Phase 4: Application-wide consistency pass

Review all screens and correct inconsistencies introduced or exposed by the earlier changes.

Check different window sizes, long content, and all relevant interface states.

### Phase 5: Validation

Run the available checks and verify the application visually.

Confirm that existing functionality and workflows remain intact.

## 14. Acceptance criteria

The redesign is acceptable when:

### Visual consistency
- Shared components follow consistent design rules.
- Typography and spacing are predictable.
- Colours have stable meanings.
- Cards and lists have balanced layouts.
- No unnecessary decorative containers compete with content.

### Information readability
- Important information is visible without hover.
- Text is readable at supported window sizes.
- Metadata is not clipped.
- Long titles are handled predictably.
- Images and content remain balanced.

### Interaction
- Common actions are easy to find.
- Secondary actions do not dominate the interface.
- Advanced settings are accessible through coherent entry points.
- Hover, focus, selected, disabled, and loading states are consistent.
- Keyboard interaction remains functional.

### Settings
- Users can locate settings through navigation or search.
- Settings are grouped by purpose.
- Current values and effects are understandable.
- Common settings do not require excessive navigation.

### Regression protection
- Existing functionality remains unchanged.
- No business logic or data behaviour is modified.
- Existing controls remain accessible.
- No new rendering or navigation regressions are introduced.

### Maintainability
- Existing components and tokens are reused.
- Duplicate styling is avoided.
- Documentation is updated in its existing location.
- No unnecessary dependencies or architectural changes are introduced.

## 15. Final design standard

Use the following principles as the permanent design direction for future CS3 interface work:

1. Content before controls.
2. Clarity before decoration.
3. Consistency before individual styling choices.
4. Useful information before visual minimalism.
5. Contextual actions instead of permanent visual noise.
6. Progressive disclosure without unnecessary navigation depth.
7. Readability before density.
8. Meaningful feedback instead of decorative status indicators.
9. Shared components instead of duplicated implementations.
10. Preserve functionality while improving presentation.

Every future screen, component, and interaction should follow this standard.

The expected result is not simply a darker, cleaner, or more modern-looking application. It is an application where users can immediately understand what they are looking at, find the information they need, and complete their tasks naturally without being distracted by the interface itself.