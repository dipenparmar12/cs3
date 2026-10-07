# Conventions

* **Branching:** agents work on their assigned branch; never push to `master`; no PR unless asked.
* **Commits:** Conventional Commits with an area scope (`feat(library):`, `fix(cs3):`, `feat(torrent):`, `feat(player):`, `docs:`, `chore(cs3_windows):`).
* **TypeScript `strict`**; avoid `any` (existing ones are IPC plumbing). `.ts` extensions on imports inside `electron/media/` are load-bearing (Node type-stripping). `erasableSyntaxOnly` forbids constructor parameter properties.
* **Comments explain why, not what.** Match surrounding density.
* **Pure rules in plain `.ts`, React in `.tsx`**, because Node's type stripping cannot load JSX and the pure half is the half worth testing (`settingsLevel.ts` vs `SettingsLevelContext.tsx`).
* **Tables over switches** for criteria/sections/aliases; **whole-state** returns from stores; **exceptions-not-members** for enable sets.
* **Do not vendor/commit:** `.cs3` archives, `library-jvm.jar`, `node_modules/`, `target/`, `dist/`, `dist-electron/`, downloaded `aria2c`/`yt-dlp`, exploded jars. **Anchor** ignore rules naming runtime dirs (`/extensions/`), or they swallow `src/components/extensions/`.
* **Licensing:** GPL-3.0 (`LICENSE`, `THIRD-PARTY-NOTICES.md`, reachable from About). Bundled FFmpeg is the GPL build.
* **Docs:** domain detail in `docs/agents/<area>.md`; map/rules in `CLAUDE.md`; keep dense (rule + number, not narrative).
* **Merging from other branches:** cherry-pick additively; never take a whole-file rewrite or a prebuilt jar from a branch whose sources you have not compared.
