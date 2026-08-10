# 03. Extension & Plugin System Architecture

## 1. Overview of the Plugin System

The defining feature of CloudStream is its **decoupled plugin architecture**. CloudStream itself contains zero hardcoded media scrapers or video streaming providers. Instead, all provider logic is dynamically loaded at runtime through extensions (plugins).

Plugins are compiled Kotlin artifacts (`.cs3` or `.zip` files) containing Android DEX (Dalvik Executable) bytecode targeting the `:library` SDK contract.

---

## 2. Dynamic DEX Loading Mechanism (`PluginManager.kt`)

CloudStream uses Android's native `dalvik.system.PathClassLoader` to load plugin bytecode directly into the application JVM at runtime without requiring an app reinstall or update.

```mermaid
graph LR
    A[Plugin Repository / Local File .cs3] -->|1. Download / Read File| B[PluginManager.kt]
    B -->|2. Instantiate PathClassLoader| C[PathClassLoader]
    C -->|3. Load Plugin Class| D[CloudstreamPlugin / BasePlugin]
    D -->|4. Call load() method| E[Register MainAPI & ExtractorApi]
    E -->|5. Store in APIHolder| F[APIHolder.apis & extractorApis]
```

### Key Steps in the Plugin Lifecycle:
1. **Discovery**: `PluginManager` reads installed plugin metadata (`PluginData`) stored in local `DataStore` key-value storage (`PLUGINS_KEY`).
2. **ClassLoader Initialization**: `PluginManager` creates a dedicated `PathClassLoader` pointing to the `.cs3` file path on disk:
   ```kotlin
   val classLoader = PathClassLoader(file.absolutePath, context.classLoader)
   ```
3. **Class Reflection & Instantiation**: `PluginManager` inspects `manifest.json` embedded in the plugin `.cs3` archive to locate the plugin's entry point class (extending `CloudstreamPlugin` or `BasePlugin`).
4. **Registration**: When the plugin's `load()` function is invoked:
   * `registerMainAPI(api: MainAPI)` registers the provider with `APIHolder`.
   * `registerExtractorAPI(api: ExtractorApi)` registers video extractors with `extractorApis`.
5. **OAT Cache Management**: To prevent SIGSEGV crashes when updating the main app while old Dalvik OAT (Ahead-Of-Time) compiled files remain on disk, `PluginManager.deleteAllOatFiles(context)` purges old OAT directories.

---

## 3. Extension API Contracts (`:library`)

All extensions implement standard interface contracts defined in the `:library` module:

### A. `MainAPI` Abstract Class
Every media provider extension extends `com.lagradost.cloudstream3.MainAPI`.

#### Essential Properties & Methods:
* `name`: String (Human-readable provider name, e.g. "Librevox", "YouTube")
* `mainUrl`: String (Base URL of the media service)
* `supportedTypes`: Set<TvType> (`TvType.Movie`, `TvType.TvSeries`, `TvType.Anime`, `TvType.Cartoon`, `TvType.Live`, `TvType.Torrent`, `TvType.Audio`)
* `hasMainPage`: Boolean (Whether provider supports home screen rows)
* `async fun getMainPage(page: Int, request: ProviderData): MainPageResponse?`
* `async fun search(query: String): List<SearchResponse>`
* `async fun load(url: String): LoadResponse?`
* `async fun loadLinks(data: String, isCasting: Boolean, subtitleCallback: (SubtitleFile) -> Unit, callback: (ExtractorLink) -> Unit): Boolean`

### B. `ExtractorApi` Base Class
Used for extracting playable direct video stream URLs (HLS `.m3u8`, MP4, DASH `.mpd`) from third-party video hosters.

#### Essential Properties & Methods:
* `name`: String (Hoster name, e.g., "Filemoon")
* `mainUrl`: String
* `requiresReferer`: Boolean
* `async fun getUrl(url: String, referer: String?, subtitleCallback: (SubtitleFile) -> Unit, callback: (ExtractorLink) -> Unit)`

---

## 4. Repository & Update Infrastructure (`RepositoryManager.kt`)

Plugins are hosted and distributed through **Plugin Repositories**.

### Repository Architecture:
* **Repository Manifest**: A remote JSON file (`plugins.json`) listing available plugins, version numbers, minimum required app version, author information, icon URLs, status flags (`PROVIDER_STATUS_OK`, `PROVIDER_STATUS_DOWN`), and SHA-256 hash checksums.
* **Custom URI Deep-Linking**: CloudStream registers custom URI handlers in `AndroidManifest.xml` to allow users to add repositories with a single click from their browser:
  * `cloudstreamrepo://https://example.com/plugins.json`
  * `https://cs.repo/https://example.com/plugins.json`

### Update Logic:
* When the app launches, `RepositoryManager` queries all registered repositories.
* If `onlineData.plugin.version > savedData.version`, `PluginManager` automatically downloads the updated `.cs3` file, replaces the local file, verifies its SHA-256 hash, and reloads the classloader.
