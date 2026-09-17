# PRD-49 — Security, Anti-Bot Challenge Solving & Headless Session Interception

> **Document ID**: `PRD-49-SECURITY-ANTIBOT-INTERCEPTION`  
> **Status**: Active / Implemented  
> **Scope**: CloudStream 3 Desktop Application (`cs3_windows`)  
> **Source Files**: `electron/cs3/webViewHost.ts`, `webViewMatch.ts`, `torrent/botChallenge.ts`, `logging/redact.ts`, `main.ts`  
> **Test Suites**: `electron/cs3/webViewMatch.test.mts` (21 cases), `electron/torrent/botChallenge.test.mts` (14 cases), `electron/logging/logger.test.mts`  
> **Date**: 2026-09-17  

---

## 1. Executive Summary

Many community media providers and public torrent indexers sit behind anti-bot and DDoS protection networks (Cloudflare Turnstile, Cloudflare "I'm Under Attack" Mode, DDoS-Guard). When scraped through basic HTTP clients, these sites return HTTP 403 / 503 challenge pages, rendering scrapers dead.

The **Security & Headless Session Interception Subsystem** solves these challenges using an invisible background Electron `WebContents` worker (`webViewHost.ts`). When an anti-bot challenge is detected, the URL is routed through a headless browser instance that executes the challenge JavaScript, captures the resulting session clearance cookies (`cf_clearance`, `__cf_bm`), and injects them back into the Node HTTP and JVM OkHttp client pipelines.

Simultaneously, the subsystem enforces strict **privacy redaction** across all logs and a **centralized adult content security gate**.

```text
               Scraper Request Returns HTTP 403/503 Challenge Page
                                        │
                                        ▼
                  +───────────────────────────────────────────+
                  |  WebViewMatch (electron/cs3/webViewMatch) |
                  |  Verifies domain requires browser session |
                  +───────────────────────────────────────────+
                                        │
                                        ▼
                  +───────────────────────────────────────────+
                  |   WebViewHost (electron/cs3/webViewHost)  |
                  |  Spawns invisible background WebContents  |
                  |  Executes challenge JS / Turnstile scripts|
                  +───────────────────────────────────────────+
                                        │
                                        ▼
                  +───────────────────────────────────────────+
                  |      Harvests Clearance Cookies & UA       |
                  |   (cf_clearance, __cf_bm, custom tokens)  |
                  +───────────────────────────────────────────+
                                        │
                   ┌────────────────────┴────────────────────┐
                   │                                         │
                   ▼                                         ▼
+──────────────────────────────────────+ +──────────────────────────────────────+
|          Node HTTP Client            | |         JVM Sidecar OkHttp           |
| (Injects clearance cookies into Node | | (Syncs cookies to Android OkHttp jar |
|   fetch & FastDownloader pipelines)  | |  via WebViewResolver RPC bridge)     |
+──────────────────────────────────────+ +──────────────────────────────────────+
```

---

## 2. Headless Challenge Interception (`webViewHost.ts`, `webViewMatch.ts`)

### 2.1 Headless WebContents Architecture
* Spawns an offscreen `BrowserWindow` with custom partition storage (`persist:webview_resolver`).
* User interaction is zero: window is invisible, never takes focus, and does not show in the Windows taskbar.
* Listens to navigation events (`did-finish-load`, `did-navigate`, `response` headers).
* Times out automatically after 15 seconds if the challenge does not resolve.

### 2.2 Pattern Matching (`webViewMatch.ts`)
* Uses regular expression and domain lookup tables to categorize target URLs:
  * Detects known anti-bot domains (e.g. streaming cyberlockers, protected indexers).
  * Distinguishes between static media resources (which do not need browser resolution) and protected HTML landing pages.

### 2.3 Bi-Directional Cookie Synchronization
* Once clearance is achieved, `webViewHost` extracts all session cookies for the origin domain.
* Synchronizes the cookies to:
  1. **Node Process**: Stored in shared cookie jar for `httpDownloader`, `fastDownloader`, and `mediaProxy`.
  2. **JVM Sidecar**: Pushed via RPC to `com.lagradost.cloudstream3.network.WebViewResolver` so `.cs3` plugins run transparently with valid browser session tokens.

---

## 3. Privacy Redaction Engine (`electron/logging/redact.ts`)

Diagnostic logs and error reports must never leak sensitive user credentials, personal file paths, or private authentication tokens.

### 3.1 Redaction Rules
* **Authentication Tokens**: Matches and scrubs `Bearer [a-zA-Z0-9_\-\.]+`, `token=...`, `apiKey=...`, `secret=...`, and `password=...`.
* **Personal File System Paths**: Transforms Windows user directories (`C:\Users\<username>\...`) to generic placeholders (`%USERPROFILE%\...`).
* **Signed CDN Parameters**: Strips temporary query tokens (`?token=...`, `?expires=...`, `&sig=...`) from video stream URLs in log output while preserving the host and path.
* **Redaction Guarantees**: Applied automatically to all log sinks before writing to disk or emitting over IPC (`log:getLogs`).

---

## 4. Centralized Adult Content Security Gate

The desktop application centralizes adult content controls to ensure community extensions declaring adult material cannot bypass user preferences.

### 4.1 Gate Operating Modes
* **`block`**: All adult-flagged providers, repositories, and search results are hidden and disabled.
* **`ask`**: Adult providers are hidden by default; user must explicitly trigger an unlock action to view adult content.
* **`allow`**: Adult providers are accessible according to user configuration.

### 4.2 Strict In-Memory Session Unlock
* The unlock state is **strictly in-memory** within the main process:
  * Closing or restarting the application immediately relocks adult content.
  * The unlocked state is never written to disk or stored in `cs3_datastore.json`.
* **Tamper Prevention**:
  * The IPC handler `unlockAdultForSession` strictly refuses to unlock unless the persistent mode is already configured to `ask`. A malicious renderer cannot forge an unlock call to switch modes from `block` to `allow`.
