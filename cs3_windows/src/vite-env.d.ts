/// <reference types="vite/client" />

import { CloudStreamElectronAPI } from './electron/preload';

declare global {
  interface Window {
    cloudstream?: CloudStreamElectronAPI;
  }
}
