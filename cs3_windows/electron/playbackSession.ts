import { randomUUID } from 'crypto';
import type { TorrentResult } from '../src/types/torrent';
import type { ContentService, SourceQuery, StreamAttempt } from './contentService';
import type { StreamHandle } from './torrent/torrentEngine';

/**
 * Owns one "the user pressed play" interaction, from the first click to the
 * moment the player is torn down.
 *
 * The problem this solves: source discovery and stream startup used to be a
 * single blocking call, so the viewer stared at a detail page for up to half a
 * minute before anything appeared. That wait is not one slow step — it is the
 * slowest of ~6 independent indexers, and the useful answer usually arrives in
 * the first second. Torrentio typically answers immediately while a DNS-blocked
 * scraper burns its whole 20s timeout contributing nothing.
 *
 * So the session inverts the flow: the player opens first and the session
 * reports into it. Sources accumulate visibly, the viewer may start the best
 * one found so far at any moment, and discovery continues in the background so
 * the in-player source list keeps filling for switching later.
 *
 * The session also retains the {@link SourceQuery} that produced its sources.
 * That is what makes "refresh sources" possible without the viewer navigating
 * back — the query is the durable thing, a resolved link is not.
 */

export type PlaybackPhase = 'searching' | 'starting' | 'playing' | 'error';

export interface PlaybackSnapshot {
  sessionId: string;
  phase: PlaybackPhase;
  /** Best-ranked sources known so far; grows while `searchDone` is false. */
  sources: TorrentResult[];
  /** Indexers that have answered, and how many will be asked in total. */
  searched: number;
  totalIndexers: number;
  lastIndexerName?: string;
  searchDone: boolean;
  /** Set once a stream is starting or playing. */
  activeInfoHash?: string;
  handle?: StreamHandle;
  /** Sources tried and rejected during failover, so the UI can say what failed. */
  attempts: StreamAttempt[];
  error?: string;
  /** Why zero sources were found, when that is the outcome. */
  emptyReason?: string;
  title: string;
  episodeTitle?: string;
}

interface Session {
  id: string;
  request: SourceQuery;
  title: string;
  episodeTitle?: string;
  phase: PlaybackPhase;
  sources: TorrentResult[];
  searched: number;
  totalIndexers: number;
  lastIndexerName?: string;
  searchDone: boolean;
  activeInfoHash?: string;
  handle?: StreamHandle;
  attempts: StreamAttempt[];
  error?: string;
  emptyReason?: string;
  /**
   * Bumped on every start attempt. A start that loses the race — because the
   * viewer picked a different source while the previous one was still
   * negotiating a swarm — must not overwrite the winner's state.
   */
  generation: number;
  /** True once any stream start has been initiated, so auto-start fires once. */
  started: boolean;
  /** Cancels the in-flight start when a newer one supersedes it. */
  inFlight?: AbortController;
  disposed: boolean;
}

export class PlaybackSessionManager {
  private sessions = new Map<string, Session>();
  private content: ContentService;
  private notify: (snapshot: PlaybackSnapshot) => void = () => {};

  constructor(content: ContentService) {
    this.content = content;
  }

  public setNotifier(notify: (snapshot: PlaybackSnapshot) => void): void {
    this.notify = notify;
  }

  private snapshot(session: Session): PlaybackSnapshot {
    return {
      sessionId: session.id,
      phase: session.phase,
      sources: session.sources,
      searched: session.searched,
      totalIndexers: session.totalIndexers,
      lastIndexerName: session.lastIndexerName,
      searchDone: session.searchDone,
      activeInfoHash: session.activeInfoHash,
      handle: session.handle,
      attempts: session.attempts,
      error: session.error,
      emptyReason: session.emptyReason,
      title: session.title,
      episodeTitle: session.episodeTitle,
    };
  }

  private emit(session: Session): void {
    if (session.disposed) return;
    this.notify(this.snapshot(session));
  }

  // --- lifecycle -----------------------------------------------------------

  /**
   * Opens a session and begins discovery, returning as soon as the session
   * exists rather than when a stream is ready.
   *
   * The caller is expected to show the player immediately on this return and
   * render progress from the emitted snapshots.
   */
  public start(request: SourceQuery, title: string, episodeTitle?: string): PlaybackSnapshot {
    const session: Session = {
      id: randomUUID(),
      request,
      title,
      episodeTitle,
      phase: 'searching',
      sources: [],
      searched: 0,
      totalIndexers: 0,
      searchDone: false,
      attempts: [],
      generation: 0,
      started: false,
      disposed: false,
    };
    this.sessions.set(session.id, session);

    void this.discover(session, { autoStartWhenDone: true });
    return this.snapshot(session);
  }

  /**
   * Runs source discovery, streaming partial results into the session.
   *
   * `autoStartWhenDone` is false for an explicit refresh: a viewer refreshing
   * the source list of something already playing wants a fresh list, not to be
   * yanked onto a different release mid-scene.
   */
  private async discover(
    session: Session,
    options: { autoStartWhenDone: boolean; bypassCache?: boolean }
  ): Promise<void> {
    session.searchDone = false;
    session.searched = 0;
    session.emptyReason = undefined;
    this.emit(session);

    try {
      const response = await this.content.getSources(
        session.request,
        (progress) => {
          if (session.disposed) return;
          session.sources = progress.results;
          session.searched = progress.settled;
          session.totalIndexers = progress.totalRelevant;
          session.lastIndexerName = progress.lastIndexerName || session.lastIndexerName;
          this.emit(session);
        },
        { bypassCache: options.bypassCache }
      );

      if (session.disposed) return;
      session.sources = response.sources;
      session.emptyReason = response.emptyReason;
    } catch (error) {
      if (session.disposed) return;
      session.emptyReason = error instanceof Error ? error.message : String(error);
    }

    session.searchDone = true;
    this.emit(session);

    if (!options.autoStartWhenDone || session.started || session.disposed) return;

    if (session.sources.length === 0) {
      session.phase = 'error';
      session.error =
        session.emptyReason ?? 'No sources were found for this title.';
      this.emit(session);
      return;
    }
    await this.beginStream(session, session.sources);
  }

  /**
   * Starts the best source found so far, without waiting for discovery.
   *
   * Discovery is deliberately left running: the sources that arrive after this
   * point are what the in-player switcher offers, and cancelling them would
   * make "play now" quietly cost the viewer their alternatives.
   */
  public async playNow(sessionId: string): Promise<PlaybackSnapshot | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    if (session.started) return this.snapshot(session);
    if (session.sources.length === 0) return this.snapshot(session);

    await this.beginStream(session, session.sources);
    return this.snapshot(session);
  }

  /** Switches to a specific source, replacing whatever is playing. */
  public async selectSource(
    sessionId: string,
    infoHash: string
  ): Promise<PlaybackSnapshot | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const chosen = session.sources.find((s) => s.infoHash === infoHash);
    if (!chosen) {
      session.error = 'That source is no longer in the list; refresh sources and try again.';
      this.emit(session);
      return this.snapshot(session);
    }

    // Only this source is attempted, and it starts immediately. The viewer
    // picked it deliberately: failing over to a different release would be a
    // worse answer than saying it did not work, and making them wait out a
    // readiness check before anything happens is what made choosing a source
    // feel like it had been ignored.
    await this.beginStream(session, [chosen], { failover: false, immediate: true });
    return this.snapshot(session);
  }

  /**
   * Abandons the playing source and starts the next one down.
   *
   * The renderer is the only place this can be triggered from, because the
   * failure it responds to is invisible here: source discovery already fails
   * over when a stream will not *start*, but a source that starts perfectly and
   * then cannot be decoded looks like success from the main process. That is
   * not a rare case — a file downloads at full speed and simply will not play —
   * and it left the viewer on a dead frame with a list of working sources one
   * click away that they had no reason to think would be any different.
   *
   * Already-attempted sources are excluded so a repeated failure walks down the
   * list instead of retrying the same one. Running out is a real outcome and is
   * reported as such rather than silently doing nothing.
   */
  public async skipCurrentSource(
    sessionId: string,
    reason: string
  ): Promise<PlaybackSnapshot | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const current = session.sources.find((s) => s.infoHash === session.activeInfoHash);
    if (current) {
      session.attempts.push({
        title: current.title,
        indexerName: current.indexerName,
        error: reason,
      });
    }

    const failed = new Set(session.attempts.map((attempt) => attempt.title));
    const remaining = session.sources.filter(
      (source) => source.infoHash !== session.activeInfoHash && !failed.has(source.title)
    );

    if (remaining.length === 0) {
      session.phase = 'error';
      session.error =
        `No source could be played. ${session.attempts.length} were tried; the last said: ${reason}`;
      this.emit(session);
      return this.snapshot(session);
    }

    // Failover off: this *is* the failover step, and letting `beginStream` run
    // its own would burn the rest of the list on one decode failure.
    await this.beginStream(session, [remaining[0]], { failover: false, immediate: true });
    return this.snapshot(session);
  }

  /**
   * Re-runs discovery for the same query, keeping the current stream playing.
   *
   * Bypasses the cache, necessarily: a viewer pressing "refresh" is telling us
   * the cached answer is wrong, and serving it back would make the button
   * appear broken.
   */
  public async refresh(sessionId: string): Promise<PlaybackSnapshot | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    await this.discover(session, { autoStartWhenDone: false, bypassCache: true });
    return this.snapshot(session);
  }

  private async beginStream(
    session: Session,
    candidates: TorrentResult[],
    options: { failover?: boolean; isRecovery?: boolean; immediate?: boolean } = {}
  ): Promise<void> {
    const generation = ++session.generation;
    const previousInfoHash = session.activeInfoHash;

    /**
     * Cancel whatever was in flight, for real.
     *
     * Bumping the generation only stops a stale result from *overwriting*
     * state; the work itself carried on. A failover walk can spend four
     * candidates × a 25 s readiness budget, so after picking a different
     * source the app could spend a minute and a half still downloading the
     * release the viewer had just rejected — competing for the same bandwidth
     * as their actual choice. That is the "it just keeps loading" report.
     */
    session.inFlight?.abort();
    const controller = new AbortController();
    session.inFlight = controller;

    session.started = true;
    session.phase = 'starting';
    session.error = undefined;
    session.attempts = [];
    this.emit(session);

    // The superseded stream is dropped now rather than when its own walk
    // eventually notices, so the chosen source gets the bandwidth immediately.
    if (options.immediate && previousInfoHash) {
      await this.content.getEngine().stopStream(previousInfoHash, true);
      session.activeInfoHash = undefined;
      session.handle = undefined;
    }

    try {
      const result = await this.content.startBestStream(
        candidates,
        session.request.season,
        session.request.episode,
        {
          ...(options.failover === false ? { maxAttempts: 1 } : {}),
          signal: controller.signal,
          returnImmediately: options.immediate,
        }
      );

      // A newer start superseded this one while it was negotiating; its stream
      // is the one the viewer is waiting on, so this one is surplus and must be
      // torn down rather than left holding a swarm.
      if (session.disposed || generation !== session.generation) {
        await this.content.getEngine().stopStream(result.handle.infoHash, false);
        return;
      }

      session.handle = result.handle;
      session.activeInfoHash = result.handle.infoHash;
      session.attempts = result.attempts;
      session.phase = 'playing';
      this.emit(session);

      // Files are kept: the viewer may promote this stream to a download.
      if (previousInfoHash && previousInfoHash !== result.handle.infoHash) {
        await this.content.getEngine().stopStream(previousInfoHash, true);
      }
    } catch (error) {
      // An abort is the expected outcome of the viewer changing their mind,
      // not a failure to report at them.
      if (error instanceof Error && error.name === 'AbortError') return;
      if (session.disposed || generation !== session.generation) return;

      /**
       * A provider link that will not start is usually an expired one, and the
       * fix is mechanical: the query that produced it is still held, so the
       * link can be regenerated without the viewer navigating anywhere. This
       * runs once — a second failure is a real failure, not a stale URL, and
       * retrying forever would just hide it.
       */
      const wasDirect = candidates.some((c) => c.directUrl);
      if (wasDirect && !options.isRecovery) {
        session.error = undefined;
        this.content
          .getCache()
          .invalidate(session.request.mediaUrl, session.request.season, session.request.episode);

        await this.discover(session, { autoStartWhenDone: false, bypassCache: true });
        if (session.disposed || generation !== session.generation) return;

        if (session.sources.length > 0) {
          await this.beginStream(session, session.sources, { ...options, isRecovery: true });
          return;
        }
      }

      session.phase = 'error';
      session.error = error instanceof Error ? error.message : String(error);
      // A failed switch leaves the previous stream alone, so the viewer is
      // returned to something that still plays rather than a dead player.
      session.started = Boolean(previousInfoHash);
      this.emit(session);
    }
  }

  public get(sessionId: string): PlaybackSnapshot | null {
    const session = this.sessions.get(sessionId);
    return session ? this.snapshot(session) : null;
  }

  /** Ends a session and stops its stream, keeping downloaded files. */
  public async stop(sessionId: string, keepFiles = true): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.disposed = true;
    // Closing the player must stop the search too, or a walk keeps running and
    // starting swarms for a session nobody is watching.
    session.inFlight?.abort();
    this.sessions.delete(sessionId);

    if (session.activeInfoHash) {
      await this.content.getEngine().stopStream(session.activeInfoHash, keepFiles);
    }
  }

  public async stopAll(): Promise<void> {
    await Promise.allSettled([...this.sessions.keys()].map((id) => this.stop(id)));
  }
}
