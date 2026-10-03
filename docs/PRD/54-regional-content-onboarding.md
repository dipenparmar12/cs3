# PRD-54 — Regional content onboarding and configuration

Status: **built** (2026-10-03). Code: `electron/cs3/regions.ts` (pure, tested), `electron/cs3/bootstrap.ts`,
`src/components/regions/`. Supersedes the locale-only half of `starterPlugins.ts`'s first-run rule.

## 1. Problem

The catalogue (`electron/official_repositories.json`, 43 repositories) spans India, Indonesia, Vietnam,
the Arab world, Germany, Italy, France, Turkey and the UK. First run picked what to install from two
signals only: the hand-set `bundled` flag and the system locale (`preferredLanguages`). Consequences:

- An Indian viewer on an `en-US` Windows install got no Hindi/Tamil providers and none of the Indian
  OTT repositories (NetMirror, CNC Verse, Desi), because none of them is `bundled`.
- An Indonesian viewer got none of the three Indonesian repositories, for the same reason.
- There was no way to say "I watch Indian **and** global content" — the locale is one value.
- The set the app starts with was a hard-coded list (`bundled`) rather than something derived.

## 2. Goal

A global app that does not enable everything globally. The viewer says where their content comes from
(one or more regions); the app derives which repositories to add, which extensions to install and which
providers are enabled from **metadata the repositories declare**, never from a per-region default list.

Non-goals: per-title geo-filtering of catalogues; region-locking anything; changing the adult gate's
enforcement point (`PluginManager.enabledProviderNames` stays the only one).

## 3. Regions

A closed table in `regions.ts`. Each region owns the ISO 639-1 languages its content is in.

| id | Label | Languages |
|---|---|---|
| `GLOBAL` | Global (English & multilingual) | en |
| `IN` | India | hi ta te ml kn bn gu mr pa ur or as |
| `SEA` | Southeast Asia | id ms th vi tl fil my km |
| `CN` | China & Chinese-speaking | zh |
| `JP` | Japan | ja |
| `KR` | Korea | ko |
| `EU` | Europe | de fr it es pt nl pl ru uk sv no da fi cs el ro hu |
| `NA` | North America | en es fr |
| `LATAM` | Latin & South America | es pt |
| `ME` | Middle East & Turkey | ar tr fa he ku |
| `AF` | Africa | sw am ha yo zu af ar fr |
| `ALL` | All regions | every language |

`ALL` is a mode, not a member: it subsumes every other selection (same rule as "All sources is a mode,
not an erasure" — it never discards the stored list of named regions shown when it is turned off).

## 4. Metadata

Each catalogue entry declares:

```json
{ "regions": ["IN"], "languages": ["hi", "en"] }
```

`"regions": ["*"]` marks a **global** repository (English or multilingual content with no single home).
A repository may carry both (`CSX`: `["*", "IN"]`). `adult` already exists and is unchanged.

**Fallback derivation.** A repository without `regions` (a custom repository, PRD-52, or a future
catalogue row someone forgot to tag) is derived from its free-text `language` field: "Multilingual",
"Global" and plain "English" → `*`; otherwise each named language maps to every region that owns it.
Explicit metadata always wins.

**Extensions** already declare `language` (ISO code) and `tvTypes` (incl. `NSFW`) in every published
`plugins.json`; no new extension metadata is required. Providers inherit their extension's.

**Content types** are not a selection axis here — they are already faceted from `tvTypes` in the
extensions screen and scope picker.

## 5. Selection → configuration (the rule)

Given a selection `S` (set of region ids):

1. **Repository matches** when `S` contains `ALL`; or the repository is global (`*`) and `S` contains
   `GLOBAL`; or `regions ∩ S ≠ ∅`. Adult repositories match only while adult content is allowed.
   Unverified repositories (`verified: false` — known-dead hosts) never match.
2. **Every matching repository is added** (index fetched and persisted — cheap, reversible). It appears
   enabled in the extensions screen with its whole catalogue one click away.
3. **Starter extensions are installed** (the expensive step, ≤16 per repository, working before beta
   before slow, nothing marked down — `pickStarterPlugins`) from:
   - matching repositories reached **through a named region** (not only through `*`): every language,
     because a repository that is Indonesian is relevant to an Indonesian viewer whatever its plugins'
     language tags say (NetMirror's Netflix provider is tagged `en`);
   - matching **bundled** global repositories, filtered to the languages of `S` (plus multilingual /
     undeclared). An `IN + GLOBAL` viewer gets phisher98's Hindi and Tamil scrapers; a `GLOBAL`-only
     viewer gets its English ones.
   - Unbundled global repositories are added, not installed: `bundled` remains the claim that
     `provider-e2e.mjs` drove them end to end, and auto-installing twenty unverified community packs is
     the construction-kit first run `bootstrap.ts` exists to avoid.
   - Adult repositories are added (when allowed) but never auto-installed from; NSFW extensions are
     never auto-installed while adult content is off.
4. **Providers** registered by installed extensions are enabled by default (the enable list is a
   disable list) and pass through the unchanged cascade. OTT platform pages and provider catalogues
   follow automatically: they are discovered from enabled providers (`OttService`).

## 6. First run

- `BootstrapService.start()` no longer installs anything until a selection exists. With none stored it
  reports `phase: 'needs-regions'` and waits.
- The renderer shows **Content preferences** (modal) on `needs-regions`: a region grid, pre-ticked from
  the system locale (`en-IN` → India + Global; `id-ID` → Southeast Asia + Global; `en-US` → Global),
  an **All regions** option, and — below a quiet divider, collapsed under "Optional content" — an
  **Include adult / 18+ content** checkbox, off by default, with one line saying it can be changed in
  Settings. Not a headline, not a question with a reason attached.
- Confirm → adult mode written (`on`/`off`) → regions stored → bootstrap runs with progress on the
  existing `extension:bootstrapProgress` banner.
- "Skip" stores the locale suggestion, so the prompt is never a wall.
- **Existing installs** with no stored selection are asked once too. Because bootstrap skips any
  repository already installed, the answer is purely additive: nothing they set up is touched.

## 7. Changing regions later

Settings → Content → **Regions** (beside the adult setting). Same grid.

- **Adding** a region runs the §5 rule for the newly matching repositories only, in the background,
  through the same progress banner.
- **Removing** a region deletes nothing and disables nothing by itself. The answer lists the installed
  catalogue repositories that matched only through removed regions; the viewer reviews the list and
  presses **Turn these off** (→ `setRepositoriesEnabled(false)`, reversible, no archives deleted) or
  leaves them.
- Custom repositories (not in the catalogue) are never listed as affected.

## 8. Persistence and overrides

- Selection: datastore key `cs3_content_regions` (JSON array). Travels in backups (datastore section).
- Adult: the existing `cs3_adult_content_mode` — independent of regions.
- Repositories, extensions, providers: existing stores. **The region system only ever adds.** A
  repository already installed is skipped, so a repository/extension/provider the viewer switched off is
  never switched back on by a later region change; disabling only happens on the viewer's explicit
  review in §7.
- Languages are derived from regions, not stored separately — two records of one decision drift.

## 9. IPC

`regions:get` → `{ selected, needsSelection, suggested, regions }`;
`regions:set(selected)` → `{ ok, state, affected: {url,name}[] }`. Applying is background work reported
on `extension:bootstrapProgress`.

## 10. Acceptance

- Pure rules pinned by `bun run test regions`: matching, the global/regional install split, language
  filtering, `ALL`, adult exclusion, unverified exclusion, fallback derivation, locale suggestion,
  removal review never naming a repository still covered.
- `tsc -b` clean. `needs-app-run`: the modal and the settings panel have not been driven in a running
  Electron app by the author of this change.
