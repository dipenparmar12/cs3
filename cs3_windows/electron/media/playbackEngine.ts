import type {
  AudioStreamMetadata,
  EmbeddedSubtitleTrack,
  HostEncodeCapability,
  MediaTransport,
  NativeEngineCapability,
  PlaybackDiagnosticEvent,
  PlaybackStreamRequest,
  PlaybackStreamResponse,
  ProbeFailure,
  RendererCapabilities,
  SourceCapabilityModel,
} from '../../src/types/media';
import type { MediaProxy } from '../mediaProxy';
import type { MediaTranscoder } from '../mediaTranscoder';
import {
  blindFallbackPlan,
  decideStrategy,
  isTextSubtitle,
  planForAudioTrack,
} from './decisionEngine.ts';
import { MediaInspector, drmRequiresEme, transportFromUrl } from './mediaInspector.ts';
import type { InspectionStore } from './inspectionStore.ts';
import { getLogger } from '../logging/logger.ts';

/**
 * The Universal Media Compatibility Engine (PRD-37), assembled.
 *
 * Owns the sequence that used to race: proxy-wrap, inspect, decide, open the
 * stream, and only then hand a URL to the renderer. The player no longer probes
 * *while* playing — it asks for a prepared stream and attaches what comes back,
 * which is INV-RACE-1 through INV-RACE-4 in one place instead of four.
 *
 * The four invariants, and where each is enforced:
 *
 * - **INV-RACE-1 (no blind playback)** — `prepare()` never returns a URL before
 *   inspection has completed or failed, and the renderer has nothing else to
 *   attach.
 * - **INV-RACE-2 (probe gate)** — the caller stays in `preparing` for the
 *   duration; there is no code path that starts playback and inspects behind it.
 * - **INV-RACE-3 (no copy on incomplete probe)** — a failed inspection produces
 *   {@link blindFallbackPlan}, which re-encodes. The old fallback ran `-c:v copy`
 *   on unknown video and re-wrapped an undecodable HEVC bitstream into MP4, so
 *   the second attempt failed identically to the first and looked like the same
 *   bug twice.
 * - **INV-RACE-4 (capability sync)** — `setCapabilities` is called from the
 *   renderer at startup and every decision reads it; a decision made before it
 *   arrives falls back to the conservative static table rather than assuming.
 */

/** Provider links expire; a capability record older than this is re-measured. */
const CAPABILITY_TTL_MS = 10 * 60 * 1000;
const MAX_CACHED_CAPABILITIES = 64;
/** Enough of a manifest to classify it and find its DRM declarations. */
const MANIFEST_SNIFF_BYTES = 64 * 1024;

interface CachedCapability {
  model: SourceCapabilityModel;
  at: number;
}

export interface PlaybackEngineDeps {
  proxy: MediaProxy;
  transcoder: MediaTranscoder;
  /**
   * Whether mpv is installed and how eagerly the user wants it used.
   *
   * A function rather than a value because both halves move while the app is
   * running: mpv can be provisioned mid-session, and the policy is a setting.
   * Reading it per decision is what lets a viewer install the engine and have
   * the very next source routed to it, with no restart and no stale cache — the
   * capability cache is keyed on the URL, so `setNativeEngine` clears it for the
   * same reason `setCapabilities` does.
   */
  nativeEngine: () => NativeEngineCapability;
  /**
   * Remembers what previous probes found, across restarts.
   *
   * Optional so the engine still works without one — every test constructs it
   * bare, and a missing store costs a probe rather than correctness.
   */
  inspections?: InspectionStore;
  fetchText: (url: string, bytes: number) => Promise<string | null>;
  /** Asks the source itself why it could not be read. See `main.ts`. */
  describeUnreadable: (url: string) => Promise<ProbeFailure>;
  diagnostics: {
    record(entry: {
      level: 'error' | 'warn' | 'info';
      stage: 'playback';
      url?: string;
      source?: string;
      message: string;
      detail?: string;
    }): void;
  };
}

const log = getLogger().child('playback');

export class PlaybackEngine {
  private capabilities: RendererCapabilities | null = null;
  private cache = new Map<string, CachedCapability>();
  private inspector: MediaInspector;
  private host: HostEncodeCapability | null = null;
  /** Ring buffer of playback telemetry; see `PlaybackDiagnosticEvent`. */
  private events: PlaybackDiagnosticEvent[] = [];
  /**
   * The audio tracks each open session was built from.
   *
   * Held here rather than looked up from the capability cache, which is keyed by
   * URL and evicted on a ten-minute TTL: a session outlives its cache entry on
   * any film longer than that, and losing the tracks mid-playback would turn
   * track switching into a no-op halfway through.
   */
  private sessionTracks = new Map<string, AudioStreamMetadata[]>();
  private nextSession = 1;

  private deps: PlaybackEngineDeps;

  constructor(deps: PlaybackEngineDeps) {
    this.deps = deps;
    this.inspector = new MediaInspector(
      () => deps.transcoder.resolveFfprobe(),
      (url) => deps.fetchText(url, MANIFEST_SNIFF_BYTES)
    );
  }

  /**
   * Records what the renderer's own decoders support.
   *
   * Believed over the static table in both directions. Chromium's HEVC support
   * depends on the build and on platform decoders being present, so a table
   * compiled in the main process is a guess about someone else's machine while
   * `canPlayType` in the renderer is a measurement of the machine in question.
   * A build that *can* decode HEVC must not be made to re-encode it for nothing.
   */
  public setCapabilities(capabilities: RendererCapabilities): void {
    this.capabilities = capabilities;
    // Every cached verdict was reached without this and may now be wrong in the
    // expensive direction — a source marked "transcode" that plays natively.
    this.cache.clear();
  }

  /**
   * Drops every cached verdict after the native engine appears or the policy moves.
   *
   * Same reasoning as {@link setCapabilities}: a capability record decided
   * without mpv says `FULL_TRANSCODE` for a file that would now play untouched,
   * and it would keep saying so for the ten minutes of its TTL. Provisioning the
   * engine and then watching the next film re-encode anyway is exactly the kind
   * of "it did not take effect" that makes a setting look broken.
   */
  public invalidateCapabilityCache(): void {
    this.cache.clear();
  }

  public getCapabilities(): RendererCapabilities | null {
    return this.capabilities;
  }

  public getDiagnostics(sessionId?: string): PlaybackDiagnosticEvent[] {
    return sessionId ? this.events.filter((e) => e.sessionId === sessionId) : [...this.events];
  }

  private async hostCapability(): Promise<HostEncodeCapability> {
    if (!this.host) this.host = await this.deps.transcoder.hostCapability();
    return this.host;
  }

  // --- inspection ----------------------------------------------------------

  /**
   * Measures a source and classifies it, without starting anything.
   *
   * Cached by proxied URL: the detail screen, the player and the failover ladder
   * all ask about the same stream, and inspecting a remote 4K file three times
   * costs three round trips to a CDN that is already the slow part.
   */
  public async inspect(
    request: Pick<PlaybackStreamRequest, 'url' | 'headers' | 'isM3u8' | 'refresh'>
  ): Promise<SourceCapabilityModel> {
    const resolvedUrl = await this.deps.proxy.wrap(request.url, request.headers);

    if (!request.refresh) {
      const hit = this.cache.get(resolvedUrl);
      if (hit && Date.now() - hit.at < CAPABILITY_TTL_MS) return hit.model;
    }

    const model = await this.measure(resolvedUrl, request.url, request.isM3u8);

    if (this.cache.size >= MAX_CACHED_CAPABILITIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(resolvedUrl, { model, at: Date.now() });
    return model;
  }

  private async measure(
    resolvedUrl: string,
    originUrl: string,
    isM3u8?: boolean
  ): Promise<SourceCapabilityModel> {
    const host = await this.hostCapability();

    if (!this.deps.transcoder.isAvailable()) {
      /**
       * Without ffprobe there is nothing to measure, and guessing is what this
       * engine exists to stop. The stream is attached as-is and the UI is told
       * why — a source that happens to be MP4/H.264/AAC still plays, and one
       * that is not fails with an accurate reason rather than a silent stall.
       */
      return this.unmeasured(
        resolvedUrl,
        transportFromUrl(originUrl, isM3u8),
        'Media components are not installed, so this stream could not be inspected. ' +
          'Install them in Settings to play Matroska, HEVC and Dolby audio sources.'
      );
    }

    /**
     * A measurement we already have is not taken again.
     *
     * Keyed on the *origin* URL rather than the proxied one, because the
     * loopback address is minted per session. The verdict is still computed
     * below from this machine's current capabilities — only the ffprobe round
     * trip is skipped, which is the 1.6-second part.
     */
    const remembered = this.deps.inspections?.read(originUrl);
    const inspection = remembered
      ? { ...remembered, error: undefined, timedOut: false, latencyMs: 0 }
      : await this.inspector.inspect(resolvedUrl, isM3u8);

    if (!remembered && inspection.metadata) {
      this.deps.inspections?.write(
        originUrl,
        inspection.metadata,
        inspection.transport,
        inspection.drm
      );
    }

    const requiresEme = drmRequiresEme(inspection.drm);

    if (!inspection.metadata) {
      if (requiresEme) {
        const decision = decideStrategy(
          { formatName: inspection.transport, video: null, audio: [], subtitles: [] },
          inspection.transport,
          this.capabilities,
          host,
          true,
          this.deps.nativeEngine()
        );
        return {
          resolvedUrl,
          transport: inspection.transport,
          supportsRangeRequests: inspection.transport === 'progressive',
          inspectionStatus: 'skipped',
          metadata: null,
          failure: null,
          directPlayable: decision.directPlayable,
          requiredStrategy: decision.strategy,
          transformationPlan: decision.plan,
          drm: inspection.drm,
          requiresEmeDecryption: true,
          explanation: decision.explanation,
          probeLatencyMs: inspection.latencyMs,
        };
      }

      /**
       * A probe that produced nothing has not said why, and the two reasons need
       * different responses. A dead link is one click — try another source. An
       * undecodable codec is not, and may be worth an external player. Both were
       * previously reported as one sentence offering both guesses, when a single
       * HTTP request answers it: a reported failure turned out to be a plain 404
       * while the message on screen was still speculating about codecs.
       */
      const failure = await this.deps.describeUnreadable(resolvedUrl);
      this.deps.diagnostics.record({
        level: 'error',
        stage: 'playback',
        url: originUrl,
        message: failure.reason,
        detail: [inspection.error, failure.status ? `HTTP ${failure.status}` : undefined]
          .filter(Boolean)
          .join(' · ') || undefined,
      });

      return {
        resolvedUrl,
        transport: inspection.transport,
        supportsRangeRequests: false,
        inspectionStatus: 'failed',
        metadata: null,
        failure,
        directPlayable: false,
        // INV-RACE-3: unknown video is never copied.
        requiredStrategy: 'FULL_TRANSCODE',
        transformationPlan: blindFallbackPlan(host),
        drm: inspection.drm,
        requiresEmeDecryption: false,
        explanation: failure.reason,
        probeLatencyMs: inspection.latencyMs,
      };
    }

    const decision = decideStrategy(
      inspection.metadata,
      inspection.transport,
      this.capabilities,
      host,
      requiresEme,
      this.deps.nativeEngine()
    );

    return {
      resolvedUrl,
      transport: inspection.transport,
      supportsRangeRequests: inspection.transport === 'progressive',
      inspectionStatus: 'inspected',
      metadata: inspection.metadata,
      failure: null,
      directPlayable: decision.directPlayable,
      requiredStrategy: decision.strategy,
      transformationPlan: decision.plan,
      drm: inspection.drm,
      requiresEmeDecryption: requiresEme,
      explanation: decision.explanation,
      probeLatencyMs: inspection.latencyMs,
    };
  }

  private unmeasured(
    resolvedUrl: string,
    transport: MediaTransport,
    explanation: string
  ): SourceCapabilityModel {
    return {
      resolvedUrl,
      transport,
      supportsRangeRequests: transport === 'progressive',
      inspectionStatus: 'skipped',
      metadata: null,
      failure: null,
      directPlayable: true,
      requiredStrategy: transport === 'hls' ? 'HLS_NATIVE' : 'DIRECT',
      transformationPlan: {
        videoAction: 'none',
        audioAction: 'none',
        selectedAudioIndex: -1,
        containerAction: 'passthrough',
        subtitleAction: 'ignore',
      },
      drm: { type: 'none' },
      requiresEmeDecryption: false,
      explanation,
      probeLatencyMs: 0,
    };
  }

  // --- preparation ---------------------------------------------------------

  /**
   * Inspects, decides, and opens whatever the decision calls for.
   *
   * Returns the URL to attach and nothing to do afterwards. The renderer's whole
   * job becomes: ask, wait, attach — which is the shape that removes the race,
   * because there is no longer a moment where the element is playing something
   * the main process has not yet classified.
   */
  public async prepare(request: PlaybackStreamRequest): Promise<PlaybackStreamResponse> {
    const startedAt = Date.now();
    const capability = await this.inspect(request);

    /**
     * The forced pass, and the reason it does not consult the capability model.
     *
     * It runs precisely when the model has already been disproved: inspection
     * said this would play, the element disagreed, and the only remaining move
     * that is *guaranteed* to produce something decodable is a re-encode. The
     * previous implementation guessed here from the URL string — `x265`,
     * `10bit`, `hevc` — which is a guess about a filename a scraper produced.
     */
    const plan = request.force
      ? blindFallbackPlan(await this.hostCapability())
      : capability.transformationPlan;
    const strategy = request.force ? 'FULL_TRANSCODE' : capability.requiredStrategy;

    /**
     * A dead link is reported now rather than discovered by ffmpeg.
     *
     * The source answered 404 or 403 to a one-byte range request, so there is
     * nothing to convert and no decoder that would help. Opening a conversion
     * anyway costs the ffmpeg startup, the pipe, and the wait for the element to
     * give up — and PRD-38's acceptance criterion for the mirror ladder is that
     * the next candidate starts within 1.5 seconds. Expired signed URLs from
     * Cloudflare Workers and Googleusercontent are the routine case here, and
     * the session above this one still holds the query that can regenerate one.
     */
    if (capability.failure?.dead) {
      this.record(request, capability, strategy, startedAt, {
        stage: 'proxy',
        message: capability.failure.reason,
      });
      return {
        ok: false,
        error: capability.failure.reason,
        playbackUrl: '',
        sessionId: '',
        capability,
        subtitles: [],
      };
    }

    /**
     * Nothing is opened for the native engine either.
     *
     * mpv demuxes and decodes the source itself, so there is no transcode
     * session and no loopback stream to create — only the proxied URL, which
     * already carries the provider's `Referer`. The renderer sees
     * `requiredStrategy === 'NATIVE_MPV'` and hands that URL to `mpv:open`
     * instead of assigning it to the `<video>` element.
     */
    if (
      strategy === 'DIRECT' ||
      strategy === 'HLS_NATIVE' ||
      strategy === 'EME_NATIVE' ||
      strategy === 'NATIVE_MPV'
    ) {
      this.record(request, capability, strategy, startedAt);
      return {
        ok: true,
        playbackUrl: capability.resolvedUrl,
        sessionId: '',
        capability,
        subtitles: [],
      };
    }

    if (!this.deps.transcoder.isAvailable()) {
      this.record(request, capability, strategy, startedAt, {
        stage: 'ffmpeg',
        message: 'media components missing',
      });
      return {
        ok: false,
        needsComponents: true,
        error:
          'This stream needs conversion to play here, and the media components are not ' +
          'installed. Install them in Settings → Advanced.',
        playbackUrl: capability.resolvedUrl,
        sessionId: '',
        capability,
        subtitles: [],
      };
    }

    const streamUrl = await this.deps.transcoder.createSession(
      capability.resolvedUrl,
      plan,
      capability.transport
    );
    if (!streamUrl) {
      this.record(request, capability, strategy, startedAt, {
        stage: 'ffmpeg',
        message: 'transcode session could not be opened',
      });
      return {
        ok: false,
        error: 'The conversion pipeline could not be started for this stream.',
        playbackUrl: capability.resolvedUrl,
        sessionId: '',
        capability,
        subtitles: [],
      };
    }

    const sessionId = streamUrl.split('/').pop() ?? '';
    this.sessionTracks.set(sessionId, capability.metadata?.audio ?? []);
    this.record(request, capability, strategy, startedAt);
    return {
      ok: true,
      playbackUrl: streamUrl,
      sessionId,
      capability,
      subtitles: this.subtitleTracks(sessionId, capability),
    };
  }

  /**
   * Embedded text subtitle tracks, as loopback WebVTT URLs.
   *
   * Only offered on a session that already exists, because extraction reads the
   * source through the same ffmpeg the session opened. Bitmap tracks (PGS, DVB,
   * VOBSUB) are pictures rather than text and are deliberately not listed: an
   * empty WebVTT file named "English" is worse than no track at all, because it
   * looks like broken subtitles rather than absent ones.
   */
  private subtitleTracks(
    sessionId: string,
    capability: SourceCapabilityModel
  ): EmbeddedSubtitleTrack[] {
    if (capability.transformationPlan.subtitleAction !== 'extract_webvtt') return [];
    const tracks: EmbeddedSubtitleTrack[] = [];
    for (const sub of capability.metadata?.subtitles ?? []) {
      if (!isTextSubtitle(sub.codec)) continue;
      const url = this.deps.transcoder.subtitleUrl(sessionId, sub.index);
      if (!url) continue;
      const language = sub.language && sub.language !== 'und' ? sub.language.toUpperCase() : null;
      tracks.push({
        index: sub.index,
        language: sub.language,
        label: [sub.title || language || `Track ${sub.index + 1}`, sub.isForced ? '(forced)' : '']
          .filter(Boolean)
          .join(' ') + ' — embedded',
        url,
      });
    }
    return tracks;
  }

  /**
   * Switches audio track on a live session, resuming where the viewer was.
   *
   * The element only ever receives the one track mapped for it, so switching
   * means restarting ffmpeg with a different `-map` — the returned URL carries
   * the seek so playback resumes rather than starting over, which is the
   * difference between a track switch and losing your place in a film.
   */
  public switchAudio(
    sessionId: string,
    audioIndex: number,
    positionSeconds: number
  ): { ok: boolean; url?: string; error?: string } {
    const plan = this.deps.transcoder.planFor(sessionId);
    if (!plan) return { ok: false, error: 'That playback session is no longer open.' };

    /**
     * The plan is re-derived, not just re-indexed.
     *
     * The new track may need transcoding where the old one was copied — picking
     * a 6-channel AC-3 dub under a plan built for stereo AAC makes ffmpeg refuse
     * to write the header at all. See `planForAudioTrack`.
     */
    const track = this.sessionTracks
      .get(sessionId)
      ?.find((candidate) => candidate.index === audioIndex);
    this.deps.transcoder.updatePlan(sessionId, planForAudioTrack(plan, track));

    const url = this.deps.transcoder.streamUrl(sessionId);
    if (!url) return { ok: false, error: 'That playback session is no longer open.' };

    const at = Math.max(0, Math.floor(positionSeconds));
    return { ok: true, url: `${url}?t=${at}` };
  }

  public close(sessionId: string): void {
    if (!sessionId) return;
    this.sessionTracks.delete(sessionId);
    this.deps.transcoder.closeSession(sessionId);
  }

  // --- telemetry -----------------------------------------------------------

  private record(
    request: PlaybackStreamRequest,
    capability: SourceCapabilityModel,
    strategy: PlaybackDiagnosticEvent['selectedStrategy'],
    startedAt: number,
    error?: { stage: PlaybackDiagnosticEvent['errorStage']; message: string }
  ): void {
    const video = capability.metadata?.video;
    const audio = capability.metadata?.audio.find(
      (track) => track.index === capability.transformationPlan.selectedAudioIndex
    );

    /**
     * The structured mirror of this event.
     *
     * Emitted here rather than at each `return` because `record` is the one
     * place every outcome of `prepare` passes through — success, dead link,
     * missing transcoder, every strategy. Instrumenting the returns instead
     * would mean six call sites and, reliably, a seventh added later without
     * one.
     */
    log.write(error ? 'warn' : 'info', 'playback_prepared', {
      url: request.url,
      provider: request.provider,
      engine: strategy === 'NATIVE_MPV' ? 'mpv' : strategy === 'DIRECT' ? 'element' : 'ffmpeg',
      operation: 'prepare',
      status: error ? 'failed' : 'ok',
      strategy,
      container: capability.metadata?.formatName ?? capability.transport,
      videoCodec: capability.metadata?.video?.codec,
      videoBitDepth: capability.metadata?.video?.bitDepth,
      audioCodec: audio?.codec,
      audioChannels: audio?.channels,
      directPlayable: capability.directPlayable,
      probeLatencyMs: capability.probeLatencyMs,
      durationMs: Date.now() - startedAt,
      errorStage: error?.stage,
      error: error?.message,
    });

    const event: PlaybackDiagnosticEvent = {
      timestamp: new Date().toISOString(),
      sessionId: String(this.nextSession++),
      sourceUrl: request.url,
      provider: request.provider,
      container: capability.metadata?.formatName ?? capability.transport,
      videoCodec: video?.codec ?? 'unknown',
      videoProfile: video?.profile,
      videoBitDepth: video?.bitDepth ?? 0,
      resolution: video ? `${video.width}x${video.height}` : 'unknown',
      audioCodec: audio?.codec ?? 'none',
      audioChannels: audio?.channels ?? 0,
      directPlayable: capability.directPlayable,
      selectedStrategy: strategy,
      hardwareAccelerator: capability.transformationPlan.hardwareAccelerator ?? 'none',
      probeLatencyMs: capability.probeLatencyMs,
      startupLatencyMs: Date.now() - startedAt,
      errorStage: error?.stage,
      errorMessage: error?.message,
    };

    // Bounded: this is playback exhaust, and an app left open for days would
    // otherwise accumulate one record per source it ever considered.
    this.events.push(event);
    if (this.events.length > 200) this.events.splice(0, this.events.length - 200);

    /**
     * Anything but a direct play is worth a diagnostics line.
     *
     * The tuple is what makes a playback failure reproducible — which provider,
     * which container, which codecs, which strategy — and it is exactly what a
     * reporter cannot supply afterwards, because by then the stream is gone.
     */
    if (strategy !== 'DIRECT' || error) {
      this.deps.diagnostics.record({
        level: error ? 'error' : 'info',
        stage: 'playback',
        url: request.url,
        source: request.provider,
        message: error
          ? `${error.message} (${strategy})`
          : `${strategy}: ${capability.explanation}`,
        detail:
          `container=${event.container} video=${event.videoCodec}` +
          `${event.videoBitDepth > 8 ? `/${event.videoBitDepth}-bit` : ''}@${event.resolution} ` +
          `audio=${event.audioCodec}/${event.audioChannels}ch ` +
          `encoder=${event.hardwareAccelerator} probe=${event.probeLatencyMs}ms`,
      });
    }
  }
}
