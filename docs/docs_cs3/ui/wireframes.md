# Low-Fidelity Wireframes

Structure only — control names and placement follow the source (see [screens.md](screens.md)); sizes and styling
are not represented. `[ ]` = button, `( )` = chip/tab, `▢` = poster.

## App shell
```
+------------+------------------------------------------------------------------+
| SIDEBAR    | NAVBAR: [ 🔍 search …………………… x ][.torrent][stop][search] [scope▾] [🕶][F12]|
|            +------------------------------------------------------------------+
| Home       | (offline banner / first-run banner)                               |
| Search     +------------------------------------------------------------------+
| Library    |                                                                  |
| History    |                    ACTIVE VIEW (lazy, own ErrorBoundary)         |
| Downloads ③|                                                                  |
| Extensions |                                                                  |
| Settings   |                                                                  |
|------------|                                                                  |
| STREAMING  |                                                                  |
|  Netflix   |                                                                  |
|  Prime     |                                                                  |
|  Disney+   |                                                                  |
|  [find][⚙] |   [ mini / floating VideoPlayer lives above the view ]           |
+------------+------------------------------------------------------------------+
```

## Home
```
+------------------------------------------------------------------+
| HERO  eyebrow · Title · year           [ Watch now ]              |
+------------------------------------------------------------------+
| (All)(Movies)(Series)(Anime)…            [Catalogue▾][Rows▾]      |
| Continue watching ▾                                  [clear]      |
|  ▢ ▢ ▢ ▢ ▢ ▢ ▢ →            (progress bars, dismiss ×)           |
| Trending now                                         [Show all]   |
|  ▢ ▢ ▢ ▢ ▢ ▢ ▢ →                                                  |
| <native-provider rows: Documentaries, Public-domain, Live …>      |
+------------------------------------------------------------------+
```

## Search results
```
+------------------------------------------------------------------+
| Search Results for "dune"        ████░░ 7/15 sources · 1 failed   |
| [Save results]  (All)(Movies)(Series)…   [Source ▾]  [Search all] |
|  ▢ Dune: Part Two  ▢ Dune  ▢ Dune (1984) …   (state badges)       |
|  ▸ N results hidden (no sources before)   [show]                  |
|  empty state: reason + [Search all sources]                       |
+------------------------------------------------------------------+
```

## Detail
```
+------------------------------------------------------------------+
| [backdrop]                                          [Back]        |
| ▢ poster   Title (year) · runtime · genres · ★ ratings            |
|            [▶ Play]  [Bucket ▾]  [⬇]  [Share]  [Trailer]  [⋯]     |
|            "3 sources ready"                       ⋯ = Find more   |
|            plot                                    sources/Refresh/ |
|                                                    Search title/    |
|                                                    Download season  |
+------------------------------------------------------------------+
| Seasons (1)(2)(3)      Episodes list  [▶][⬇] …                    |
| Cast & crew (photos, characters)   Behind the scenes (notes)       |
| Trailers & videos rail                                            |
| Franchise / More like this rail                                   |
| Reviews & explanations                                            |
+------------------------------------------------------------------+
| (SourcePicker modal) filter bar · rows: provider ▸ ext ▸ repo ·   |
|  quality · size · [Play] [Download] · [Export ▾]                  |
+------------------------------------------------------------------+
```

## Player (full)
```
+------------------------------------------------------------------+
| [←] Title · Ep badge · provenance · 🕶 · peers/speed      [–][x]  |
|                                                                  |
|                       video / mpv window                          |
|    (overlays: resolving · error panel · up-next · notices)        |
|                                                                  |
| ───●━━━━━━━━━━━━━━░░░░░  hover preview                            |
| [⏮][▶][⏭] 🔊━━  12:03 / 1:42:10 ⇄   [Episodes][Sources][CC][⬇][⧉][⛶]|
+------------------------------------------------------------------+
Mini: drag handle · picture · scrubber row · [⏯][vol][expand][float][x] · 8 resize edges
```

## Library / History
```
Library: (Watching)(Saved)(Searches)       History: (All)(Played)(Failed)(Downloaded)…
  Watching: ▢ cards + progress + bucket       grouped list: title · source · status pill · date
  Saved: per title → sources by episode       [reopen][copy][delete]   [export][clear all]
         [Play] or [Find again]
```

## Downloads
```
+------------------------------------------------------------------+
| [search downloads…] [sort ▾]  [Pause all][Resume all][Retry failed]|
|                               [Clear completed][Open folder]       |
| Downloading  ▢ Title 2160p·WEB-DL·Provider  ███░░ 41%  4.2 MB/s [⏸][x]|
| Paused / Failed (reason) / Completed [Play here][Show in folder]   |
+------------------------------------------------------------------+
```

## Extensions
```
+------------------------------------------------------------------+
| JOBS TRAY: ▓▓ 3 running · 5 waiting · [cancel queued][clear]       |
| (Installed)(Browse)(Built-in Sources)(Updates)                    |
| [filters…] [bulk: Enable/Disable]                                 |
| ▾ Repository  [on]                                                |
|    ▾ Extension [on]  ⓘ provenance · compatibility                 |
|        Provider [on] (greyed with reason if a parent is off)       |
+------------------------------------------------------------------+
```

## Settings
```
+----------+-------------------------------------------------------+
| [Find a  |  Simple ◉ / Everything ○  (states what it hides)       |
|  setting]|                                                       |
| General  |  SettingGroup "Search"   rows…                         |
| Playback |  SettingGroup "Starting downloads" …                   |
| Sources  |                                                       |
| Downloads|                                                       |
| Connection                                                       |
| Setup &  |                                                       |
|  repair  |                                                       |
| Advanced |                                                       |
| Everything                                                       |
+----------+-------------------------------------------------------+
```
