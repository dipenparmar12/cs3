# CloudStream 3 Desktop — Windows Client (`cs3_windows`)

This directory contains the desktop frontend and Electron main process for **CloudStream 3 Desktop**.

For the complete project overview, end-to-end architecture, JVM sidecar explanation, and contribution guidelines, see the root [**README.md**](../README.md).

---

## 🛠 Tech Stack

- **Desktop Shell:** [Electron](https://www.electronjs.org/) (v43+) with isolated context bridge (`electron/preload.ts`)
- **Frontend:** [React 19](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [Vite 8](https://vitejs.dev/)
- **Streaming & Media:** [hls.js](https://github.com/video-dev/hls.js/), [WebTorrent](https://webtorrent.io/), custom FFmpeg / ffprobe adaptive transcode engine
- **UI Icons & Styling:** [Lucide React](https://lucide.dev/), Modular Vanilla CSS design tokens

---

## 🚀 Quick Development Scripts

Run all commands from within `cs3_windows/`:

| Command | Action |
|---|---|
| `bun install` | Install all dependencies |
| `bun run dev` | Start Vite dev server + Electron with HMR and live reload |
| `bun run typecheck` | Typecheck entire project via `tsc -b` |
| `bun run test:electron` | Run main-process, media decision, source cache and native-engine tests (99) |
| `bun run test:media` | Run codec decision engine tests (no FFmpeg required) |
| `bun run test:pipeline` | Run full media transcode pipeline tests (requires FFmpeg) |
| `bun run test:cache` | Run source-cache expiry and invalidation tests |
| `bun run test:native` | Drive a real mpv process (skips itself when mpv is absent) |
| `bun run electron:build` | Build production installer and portable `.exe` into `release/` |

---

## 📂 Directory Layout

- [`electron/`](./electron/): Node.js main process services
  - `main.ts`: Electron window lifecycle, background services, IPC routing
  - `preload.ts`: Type-safe context bridge (`window.electronAPI`)
  - `contentService.ts`: Search, metadata, and link resolution pipeline
  - `playbackSession.ts`: Live streaming sessions and source switching
  - `media/`: Media inspection, capability probing, and adaptive transcoding
  - `cs3/`: JVM sidecar supervision, plugin management, and title enrichment
  - `torrent/`: WebTorrent streaming engine and indexer integration
  - `datastore.ts`: Android-compatible SharedPreferences JSON persistence
- [`src/`](./src/): React 19 Renderer application
  - `views/`: Home, Search, Detail, Library, History, Settings
  - `components/`: Video player, extensions manager, search scope picker, download center
  - `types/`: Shared IPC and domain type definitions
