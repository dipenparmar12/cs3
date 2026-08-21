import { handle, handleRaw } from './channel.ts';
import type { RegisterHandlers } from './services.ts';
import type { SourceQuery } from '../contentService';

/**
 * The app-managed copy of the sidecar and provider runtime.
 *
 * Moved out of `main.ts` unchanged; see `services.ts` for why the dependencies
 * are named rather than reached for.
 */
export const registerRuntimeHandlers: RegisterHandlers = (services) => {
  const {
    binaryDownloader,
    contentService,
    pluginManager,
  } = services;

  // --- runtime provisioner -------------------------------------------------------
  handle(
    'runtime:getStatus',
    async () => {
      const status = pluginManager.getSidecar().getProvisioner().getStatus();
      return { ...status };
    },
    { ready: false, javaReady: false, sidecarReady: false, bridgeReady: false, isAppManaged: false }
  );

  handle(
    'runtime:provision',
    async () => {
      const provisioner = pluginManager.getSidecar().getProvisioner();
      const ready = await provisioner.provisionRuntime();
      if (ready) {
        await pluginManager.loadProviders().catch((err) => {
          console.warn('[runtime:provision] Post-provision provider load failed:', err);
        });
      }
      // A provision that ran without throwing but did not produce a usable
      // runtime is not a success, so `ok` tracks `ready` rather than the absence
      // of an exception.
      return { ok: ready, ready };
    },
    { ready: false }
  );

  handle(
    'runtime:test',
    async () => {
      const provisioner = pluginManager.getSidecar().getProvisioner();
      // The provisioner reports its own verdict; spreading it last lets that
      // verdict stand rather than being overwritten with a blanket success.
      return { ...(await provisioner.testRuntime()) };
    },
    { ok: false }
  );

  handle(
    'runtime:clean',
    async () => ({ ...(await pluginManager.getSidecar().getProvisioner().cleanRuntime()) }),
    { ok: false }
  );

  handle(
    'components:getStatus',
    () => {
      const runtime = pluginManager.getSidecar().getProvisioner().getStatus();
      const binaries = binaryDownloader.checkBinaries();
      const mediaReady = Boolean(binaries.ffmpeg && binaries.ffprobe);
      const downloadReady = Boolean(binaries.aria2 && binaries.ytdlp);
      const runtimeReady = Boolean(runtime.ready);

      /**
       * The native engine is deliberately not counted here.
       *
       * `missingCount` drives a "components missing" prompt, and mpv is optional
       * by design — someone who only watches H.264 web releases never needs it,
       * and nagging them into a 32 MB download to clear a warning badge would be
       * asking for bandwidth to fix a problem they do not have. `binaries.mpv` is
       * still reported so a screen that wants to show its state can.
       */
      let missingCount = 0;
      if (!runtimeReady) missingCount++;
      if (!downloadReady) missingCount++;
      if (!mediaReady) missingCount++;

      return {
        ok: true,
        allReady: missingCount === 0,
        missingCount,
        runtime,
        binaries,
        suites: {
          runtime: runtimeReady,
          downloads: downloadReady,
          media: mediaReady,
        },
      };
    },
    { ok: false, allReady: false, missingCount: 3 }
  );

  /** Catalogue browsing for the home screen. Fast by construction; see `browse`. */
  handle(
    'api:browse',
    async (query: string, provider?: string) => {
      return { results: await contentService.browse(query, provider) };
    },
    { results: [] }
  );

  handle(
    'api:loadMedia',
    async (url: string) => {
      return { detail: await contentService.load(url) };
    },
    { detail: null }
  );

  handle(
    'api:getSources',
    async (request: SourceQuery) => {
      return { ...(await contentService.getSources(request)) };
    },
    { sources: [],
        filtered: [],
        indexerOutcomes: [],
        query: { title: '' }, }
  );

  handleRaw('api:getPluginRuntimeStatus', async () => pluginManager.getRuntimeStatus());

  handleRaw('extension:getRuntimeReport', async (internalName: string) => pluginManager.getRuntimeReport(internalName));
};
