# Repositories, Bootstrap and Regions

## 1. What a repository is
A URL to a `repo.json` pointing at `pluginLists`/`plugins.json` (each plugin: `name`, `internalName`, `version`,
`url`, `fileHash`, `status`, `language`, `tvTypes`, optional `jarUrl/jarHash/jarFileSize`). Project-page URLs
(`https://github.com/owner/repo`) are resolved to raw documents by probing branch/filename combinations — there is no
convention. Installed repository identity is the URL string, so one repository may be known by two; `installPathFor`
keys directories on it (the updater downloads from the update's repository and installs into the record's).

Catalogue data (verified repositories) is a data file; `bun run test repositories` pins what it may claim (unique ids/URLs,
https, raw documents, adult never bundled, bundled never unverified). Liveness is measured separately with
`node tools/research/survey-repositories.mjs`.

## 2. Caches and listing
* `cs3/repositoryListingCache.ts` → `cs3-repository-listings.json`: last successful non-empty listing per repository
  address (max 80), shown at once and revalidated behind the viewer; a down repository never replaces a good listing.
* Browse opens as a full-width panel under the repository card (not a tab).
* The "Refreshing the lists of add-ons you can install" startup task (priority 20, lane `catalogue`) revalidates.

## 3. Bootstrap (first run)
`cs3/bootstrap.ts` `BootstrapService` (`BOOTSTRAP_VERSION = 2`, `PLUGINS_PER_REPOSITORY = 16`) installs the repositories marked
`bundled` (a claim that `provider-e2e.mjs` drove them end to end) in the background with progress
(`extension:bootstrapProgress`). A re-run installs only what is new. Adult repositories are never downloaded while the
gate is off. `starterPlugins.ts` picks starters: the viewer's languages, working before beta before slow, nothing marked down.

## 4. Regions (PRD-54) {#regions}
`cs3/regions.ts`: table of regions `GLOBAL, IN, SEA, CN, JP, KR, EU, NA, LATAM, ME, AF, ALL`, each with languages.
Nothing installs until the viewer picks regions (`RegionOnboarding` modal, pre-ticked from the locale; existing installs
asked once; later in `RegionSettings`). `regions:get` → `{selected, needsSelection, suggested, regions}`;
`regions:set(selection, {crossRegion?})` adds matching repositories and installs starter extensions in the
background, returning `affected` — repositories a removed region leaves behind, **for review only**. Cross-region
(default on) searches unmatched non-adult repositories for plugins whose `language` is *exactly* a selected one
(`strictLanguage`) and removes the repository again if none found. The region system only adds; a manual off is never undone.

## 5. Enable/disable vs remove
Disable keeps archives (re-enabling costs no downloads). `removeRepository` cascades to uninstall what it installed
and reports how many. Stores keep *exceptions*, so everything new defaults to enabled.

## 6. Backup
Repository records, disabled sets and provider origins are sections of `BackupService` (`cs3/backupSections.ts`, a table).
See [persistence.md](persistence.md#backup-and-restore).
