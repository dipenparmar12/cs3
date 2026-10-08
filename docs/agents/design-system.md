# Design system — controls and forms

One design language for every interactive control in `cs3_windows/src`. This file is the
audit that started it (2026-10-07), the decisions, the component catalogue, and what is
still to migrate. **New controls use these components; a one-off control needs a reason
written next to it.**

## 1. Audit (before)

Counted over `src/**/*.tsx` and the four stylesheets, 2026-10-07.

| Finding | Count | Consequence |
|---|---|---|
| `.btn` family (`btn-primary/secondary/ghost/danger/sm/icon`) | 253 uses | The de-facto system — kept as the source of truth. |
| `ext-btn` — a second button system on the extensions screen | 39 uses, 8 files | Same roles, different radius/height/font; looked like another app. |
| `icon-button` + `ext-icon-button` — two icon-only buttons | 36 + 5 | Different hover, no shared focus or disabled style. |
| Bespoke `*__btn` classes in `sources.css` | 55 | Each with its own sizing. |
| `<button style={{…}}>` — inline-styled buttons | 39 in 19 files | Sizes hand-typed per call site (`0.76rem`, `0.75rem`, `0.72rem` for the same "compact" role). |
| `.input` class | used in History, **defined nowhere** | Those selects rendered as unstyled native controls with inline overrides. |
| Search fields | 6 hand-built (navbar, Settings, extensions filter, streaming picker, History, facet search) | Different Escape behaviour (some cleared, some closed, some did nothing), different clear buttons. |
| Switches | 2: `settings__switch` (a checkbox dressed as a switch, 11 uses) and the extensions `Toggle` (`aria-pressed` on an icon) | Neither announced itself as a switch. |
| Dialogs | 8 `modal-backdrop` shells + 6 hand-built `position: fixed` overlays | Escape on bubble in some (the player behind also saw it), close buttons in different places, Cancel left in some and right in others. |
| Action menus | 8 `role="menu"` implementations | No keyboard navigation in any. |
| Dropdown filter (`FacetMenu`) | 11 uses | Good model — but no arrow-key navigation and no `role="option"`. |
| Distinct `font-size` values / `border-radius` values in the CSS | 55 / 33 | The visible symptom of all of the above. |
| A "Select all visible" button that selected everything | 1 | Extensions screen; fixed in the bulk-management work. |
| A Settings "Download folder" control that saved nothing | 1 | Fixed in the storage work (`download_directory`). |

## 2. Decisions

- **Extend, don't add.** `.btn` and `FacetMenu` were already right in shape; they became the
  system. The new layer is `src/components/ui/` (components) + `src/styles/ui.css` (styles,
  loaded after `index.css`/`sources.css` so it wins equal-specificity ties) + control tokens
  in `index.css :root`.
- **Tokens, not numbers.** `--control-height` (36) / `-compact` (28), `--control-radius`
  (8) / `-compact` (6), `--control-font-size` (0.85rem) / `-compact` (0.78rem),
  `--control-padding-x`, `--control-bg/-hover/-active`, `--control-border/-hover`,
  `--control-focus-ring`, `--control-disabled-opacity` (0.45), `--control-danger*`,
  `--control-ambient-hover/-active`, `--control-selected-bg`, `--field-gap`.
- **Variants are emphasis, not new controls.**

  | Variant | Use | Button class |
  |---|---|---|
  | default | most actions, Cancel | `btn-secondary` |
  | prominent | the one main action of a view or dialog | `btn-primary` |
  | ambient | blends into the surface until pointed at: toolbars, Select all, contextual search | `btn-ghost` |
  | destructive | uninstall, delete, clear — the confirming button | `btn-danger` |
  | *(modifier)* compact | dense toolbars, rows, filters | `btn-sm` |
  | *(modifier)* danger text | a destructive action that is **not** the main one (a row's trash, "Clear all" in a header) | `btn--danger-text` |

- **Native where native is better.** `Select` is a styled native `<select>` (keyboard,
  type-to-find, screen readers for free). `Checkbox`/`RadioGroup` are native inputs.
  `Switch` is a `button role="switch"`. Custom popups only where a native one cannot do
  the job: `FacetMenu` (counts, search inside, multi-select) and `Menu` (commands).
- **One behaviour per control.** Search: Escape clears, then blurs, consumed only when it did
  something. Dialog: Escape consumed in capture, focus moved in (to Cancel for a destructive
  dialog) and restored on close, Tab trapped, `dismissable={false}` while work it started is
  running. Menus and dropdowns: ArrowDown opens, Up/Down/Home/End move, Enter/Space choose,
  Escape closes and refocuses the trigger, Tab closes.
- **Dialog actions:** bottom right, Cancel before the main action; optional content (a
  "remember" checkbox, a secondary Refresh) at the start of the row (`DialogActions start`).
- **Forms:** `FormField` owns label/`htmlFor`, `aria-describedby` (helper or error),
  `aria-invalid`, required marker `*` / "(optional)". Error replaces helper; never both.

## 3. Catalogue — `src/components/ui`

| Component | What | Notes |
|---|---|---|
| `Button` | every button | `variant`, `size="compact"`, `icon` (lucide, sized by `BUTTON_ICON_SIZE`), `loading` (spinner, `aria-busy`, disabled), `iconOnly` (TypeScript requires `aria-label`). |
| `Dialog`, `DialogActions` | every modal | `title`, `description`, `icon`, `tone`, `size` sm/md/lg/xl (xl: poster grids — "View all", filmography), `footer`, `initialFocus`, `dismissable`. |
| `FormField` | label + control + helper/error | render-prop gives the control its id and aria wiring. |
| `Input` | text-like input | `.ui-input`; `size="compact"`; `aria-invalid` turns it red. |
| `SearchInput` | every search field | variants `default` / `compact` / `ambient`; `meta` (a count), `shortcut` hint, clear button. The navbar's media search is deliberately its own, larger control. |
| `Select` | native select | `options` or children; `size="compact"`. |
| `Checkbox`, `RadioGroup` | choices | label + description in one click target; `indeterminate`. |
| `Switch` | an immediate on/off setting | `muted` for "on, but silenced by an ancestor" (extensions tree). |
| `Menu` | a list of commands | items with `description`, `icon`, `tone: 'danger'`, `disabled`; `trigger` render-prop for an icon-only `Button`. The **list-screen header** pattern (History, Library, Downloads; Extensions keeps its facet bar): compact title, one muted status line (`.screen-head__meta`), then on the right **find (`ScreenSearch`) first**, the one bulk action that applies now, and the rest in one `MoreHorizontal` menu. Under it, `.screen-toolbar`: `type-tabs` for what to show on the left, compact `Select`s / view tabs on the right. Explanations go in an `InfoHint` (ⓘ), not a paragraph under the control. |
| `FacetMenu` (`components/FacetMenu.tsx`) | dropdown / filter / selector / multi-select | counts, search inside the list, clear on the trigger, `multiple`, `loading`, `emptyLabel`. |
| `ScreenSearch` (`components/ScreenSearch.tsx`) | find on this screen | `SearchInput` ambient behind an icon; Ctrl+F. |

## 4. Migration status

Done in this pass:

- Extensions: all 39 `ext-btn` → `.btn` family; `ext-icon-button` → `icon-button`; `Toggle`
  draws `Switch`; filter-bar search → `SearchInput`, status select → `Select`; bulk bar,
  confirmation and catalogue toolbar on `Button`/`Dialog`. `.ext-btn*`, `.ext-toggle*`,
  `.ext-search*`, `.ext-select` CSS deleted.
- Settings: 11 `settings__switch` → `Switch` (CSS deleted); "Find a setting" → `SearchInput`;
  Storage panel on the `.btn` family.
- Library: status select → `Select`; "N saved sources" → `Button`; the hand-built sources
  overlay → `Dialog`; search → `ScreenSearch`.
- History: header actions → `Button`; export dropdown → `Menu`; type/sort selects → `Select`
  (the undefined `.input` is now defined anyway); confirm-clear overlay → `Dialog`.
- Dialogs: delete download, download confirmation, season download → `Dialog`
  (their own Escape listeners removed).
- Source export menu → `Menu`. Streaming-service picker search → `SearchInput`.
- Downloads, Extension updates, Components, Player settings, Error boundary: inline-sized
  buttons → `btn-sm` (/ `btn--danger-text`), disclosures → ambient buttons with `aria-expanded`.
- `.btn`, `.btn-*`, `.icon-button` restyled on the tokens; `.input` defined.

After: `<button style={{…}}>` 39 → 21; `ext-btn` 39 → 0; `settings__switch` 11 → 0;
hand-built `position: fixed` overlays 6 → 4; dialog shells outside `ui/Dialog` 8 → 4.

Still to migrate — each is a bounded follow-up, listed so nobody re-audits:

| Where | What | Why it was left |
|---|---|---|
| `VideoPlayer`, `MiniPlayerBar`, `PlayerDownloadPanel`, `SubtitlePanel` | player overlay buttons | The player is a deliberate "glass over video" variant; it needs a `player` tone on `Button` designed against video, not a mechanical swap. |
| `SourcePicker`, `BinarySetupModal`, `RegionOnboarding`, `TrailerPopup` | dialog shells | Large custom layouts (and a focus trap in `BinarySetupModal`); move the shell to `Dialog` one at a time, with a look at each. |
| `ProviderInspector`, `HistoryView` inspector drawer | `position: fixed` side panels | A drawer is a different pattern from a dialog; add `ui/Drawer` first. |
| `LibraryBucketSelector`, `ContentHoverCard`, `Navbar`, `HomeView`, `SearchView`, `MediaComponentsCard`, `SubtitleSettings` | 1–2 inline-styled buttons each | Small; take them with the next change to each file. |
| `CopyErrorButton`, `PlayerCopyMenu`, `SourceProfileBar`, `CataloguePicker`, `Sidebar`, `DetailHero`, `LibraryBucketSelector` | own `role="menu"` implementations | Move to `Menu` (or `FacetMenu` where they select a value). |
| 37 native checkboxes outside Settings switches | `<input type="checkbox">` | Move to `Checkbox` where a label sits beside it. |
| `sources.css` bespoke `*__btn` classes | 55 | Delete as their call sites move to `Button`. |

**Not verified in a running Electron app** (it cannot launch in the cloud container). Checked:
`tsc -b`, oxlint, the test suites, and static renders of the components with the real
stylesheets in headless Chromium.
