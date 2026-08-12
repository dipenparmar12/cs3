/// <reference types="vite/client" />

// Path was previously './electron/preload', which resolves to src/electron/preload
// and does not exist — so `window.cloudstream` silently degraded to `any` and the
// whole IPC surface went unchecked in the renderer.
import type { CloudStreamElectronAPI } from '../electron/preload';

declare global {
  interface Window {
    cloudstream?: CloudStreamElectronAPI;
  }
}
