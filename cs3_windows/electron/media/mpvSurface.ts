import { BrowserWindow, screen } from 'electron';

import { getLogger } from '../logging/logger.ts';

/**
 * A native window for mpv to render into, positioned inside our own.
 *
 * ## Why this exists, and what it is not
 *
 * mpv renders with its own GPU context. Chromium composites the DOM with a
 * different one, and there is no supported way to make a Chromium element and
 * an external decoder share a surface — the roadmap's Option B, libmpv's render
 * API through a native addon, is the only true embedding and it needs a
 * compiled addon this repository does not build.
 *
 * What *is* available is `--wid`: mpv will render into an existing native
 * window handle instead of creating a top-level one. So this creates a
 * frameless child window, hands mpv its HWND, and moves it to track the
 * player's video area inside the main window. The user sees one application
 * with video in it. It is a genuine improvement over a second window on the
 * taskbar, and it is honestly a *positioned overlay* rather than a composited
 * one — which has consequences worth stating plainly rather than discovering:
 *
 * - **It is always on top of the DOM inside its rectangle.** A native child
 *   window is not part of Chromium's compositor, so nothing can be drawn over
 *   it. The player therefore keeps its controls *outside* the surface rect
 *   rather than overlaying them; see `NativeEngineStage`, which reserves the
 *   band it needs and reports only the remaining area here.
 * - **It cannot be rounded, faded, or animated** with the rest of the UI. Moves
 *   are discrete.
 * - **Windows only.** `--wid` takes an `NSView*` on macOS and an X11 window id
 *   on Linux, neither of which an Electron `BrowserWindow` hands out usefully.
 *   Elsewhere this declines to attach and mpv opens its own window, which is
 *   the previous behaviour and still works.
 *
 * Attaching is therefore an *attempt*, and every caller must cope with it
 * failing. Reporting embedding that did not happen would leave the player
 * hiding controls for a surface that is not there.
 */

const log = getLogger().child('mpv', { component: 'surface' });

/** The video area, in CSS pixels relative to the parent window's content area. */
export interface SurfaceBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class MpvSurface {
  private window: BrowserWindow | null = null;
  private parent: BrowserWindow | null = null;
  private bounds: SurfaceBounds | null = null;
  private detachers: Array<() => void> = [];

  /** Whether this platform can host an embedded surface at all. */
  public static get supported(): boolean {
    return process.platform === 'win32';
  }

  public get attached(): boolean {
    return Boolean(this.window && !this.window.isDestroyed());
  }

  /**
   * Creates the surface and returns the handle to give mpv, or `null`.
   *
   * `null` is a normal answer — an unsupported platform, or a window handle the
   * OS would not give us — and every caller treats it as "open a detached mpv
   * window instead" rather than as an error.
   */
  public attach(parent: BrowserWindow, bounds: SurfaceBounds): string | null {
    if (!MpvSurface.supported) {
      log.debug('embed_unsupported', { platform: process.platform });
      return null;
    }
    this.detach();

    try {
      const child = new BrowserWindow({
        parent,
        /**
         * Not `modal`, and deliberately not `transparent`. A transparent window
         * on Windows forces a composited path that fights mpv's own
         * presentation and produces tearing; opaque black is also the correct
         * letterbox colour behind video that does not fill the rect.
         */
        frame: false,
        show: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        hasShadow: false,
        backgroundColor: '#000000',
        /**
         * Never takes focus. Keyboard shortcuts belong to the player, and a
         * surface that stole focus would break every one of them the moment the
         * viewer clicked the picture.
         */
        focusable: false,
        acceptFirstMouse: false,
        webPreferences: {
          // Nothing is ever loaded into it: mpv paints this window. A renderer
          // process here would be a second compositor fighting for the surface.
          offscreen: false,
          nodeIntegration: false,
          contextIsolation: true,
        },
      });

      const handle = child.getNativeWindowHandle();
      if (!handle || handle.length === 0) {
        child.destroy();
        log.warn('embed_no_handle');
        return null;
      }

      this.window = child;
      this.parent = parent;
      this.setBounds(bounds);
      child.showInactive();

      this.follow(parent);

      /**
       * The handle as a decimal integer, which is what `--wid` parses. On
       * 64-bit Windows an HWND is a 64-bit value, so it is read as one — a
       * 32-bit read produces a plausible-looking wrong number and mpv then
       * renders into nothing.
       */
      const hwnd = handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0));
      log.info('embed_attached', { handle: hwnd.toString(), ...bounds });
      return hwnd.toString();
    } catch (error) {
      log.warn('embed_failed', { error: error instanceof Error ? error.message : String(error) });
      this.detach();
      return null;
    }
  }

  /**
   * Keeps the surface glued to the parent.
   *
   * A native child window has its own screen position and does not move when
   * its owner does — so without this, dragging the app leaves the video behind
   * on the desktop. Minimise and hide are handled too: an owned window is not
   * automatically hidden with its owner on Windows, and a video panel floating
   * over the desktop after the app is minimised is the worst version of this
   * feature.
   */
  private follow(parent: BrowserWindow): void {
    const reposition = () => this.bounds && this.setBounds(this.bounds);
    const hide = () => {
      if (this.window && !this.window.isDestroyed()) this.window.hide();
    };
    const show = () => {
      if (this.window && !this.window.isDestroyed()) {
        this.window.showInactive();
        reposition();
      }
    };

    const bindings: Array<[string, () => void]> = [
      ['move', reposition],
      ['moved', reposition],
      ['resize', reposition],
      ['resized', reposition],
      ['enter-full-screen', reposition],
      ['leave-full-screen', reposition],
      ['minimize', hide],
      ['hide', hide],
      ['restore', show],
      ['show', show],
      ['closed', () => this.detach()],
    ];

    for (const [event, handler] of bindings) {
      parent.on(event as 'move', handler);
      this.detachers.push(() => parent.removeListener(event as 'move', handler));
    }
  }

  /**
   * Positions the surface over the player's video area.
   *
   * The renderer reports a rect in CSS pixels relative to the content area;
   * this converts to the screen coordinates a native window needs. The scale
   * factor matters and is easy to miss: on a 150% display, CSS pixels and
   * physical pixels differ by half again, and using them interchangeably puts
   * the video a third of the way off the window on exactly the machines most
   * likely to be running 4K content.
   */
  public setBounds(bounds: SurfaceBounds): void {
    this.bounds = bounds;
    if (!this.window || this.window.isDestroyed() || !this.parent || this.parent.isDestroyed()) {
      return;
    }

    try {
      const content = this.parent.getContentBounds();
      const rect = {
        x: Math.round(content.x + bounds.x),
        y: Math.round(content.y + bounds.y),
        // A zero-sized native window is invalid and throws; a 1px one is
        // harmless and is what a collapsed layout should produce.
        width: Math.max(1, Math.round(bounds.width)),
        height: Math.max(1, Math.round(bounds.height)),
      };
      this.window.setBounds(rect);
    } catch (error) {
      log.debug('embed_bounds_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Screen scale where the parent currently sits, for the renderer to report in. */
  public scaleFactor(): number {
    if (!this.parent || this.parent.isDestroyed()) return 1;
    try {
      return screen.getDisplayMatching(this.parent.getBounds()).scaleFactor;
    } catch {
      return 1;
    }
  }

  public detach(): void {
    for (const off of this.detachers) {
      try {
        off();
      } catch {
        // The parent may already be destroyed, which removes its listeners.
      }
    }
    this.detachers = [];

    if (this.window && !this.window.isDestroyed()) {
      try {
        this.window.destroy();
      } catch {
        // Already gone.
      }
    }
    this.window = null;
    this.parent = null;
    this.bounds = null;
  }
}
