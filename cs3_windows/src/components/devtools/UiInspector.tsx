import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpToLine,
  Check,
  ChevronRight,
  Copy,
  Crosshair,
  ExternalLink,
  X,
} from 'lucide-react';
import {
  firstHostNode,
  formatForAgent,
  inspect,
  parseLocation,
  preview,
  shortLocation,
  type ComponentInfo,
  type Inspection,
} from './inspectorModel';
import './uiInspector.css';

/**
 * The Developer mode UI inspector: point at anything, learn which component
 * draws it and which file to change, and copy that as a reference an AI agent
 * can act on without a screenshot.
 *
 * Mounted only in Developer mode (and loaded as its own chunk), so standard
 * mode carries no listeners, no overlay and no shortcut. Inside Developer mode
 * it is idle until asked: Ctrl+Shift+C (the browser's own "inspect element"
 * chord) starts picking, Alt+click inspects in one gesture, Escape steps back
 * — picking, then the panel — and is consumed only when it closed something.
 *
 * Picking swallows the click it ends on, in the capture phase, so selecting a
 * Play button inspects it rather than starting a film.
 */

const EDITOR_KEY = 'cs3.uiInspector.editor';
const WIDTH_KEY = 'cs3.uiInspector.width';
const SECTIONS_KEY = 'cs3.uiInspector.sections';
const LIBRARY_KEY = 'cs3.uiInspector.showLibrary';
export const UI_INSPECTOR_EVENT = 'cs3:ui-inspector';

export type InspectorEditor = 'vscode' | 'vscode-insiders' | 'cursor' | 'windsurf' | 'system';

function readStore<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}
function writeStore(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

const isInspectorUi = (node: EventTarget | null) =>
  node instanceof Element && Boolean(node.closest('[data-cs3-inspector]'));

interface Selection {
  element: Element;
  inspection: Inspection;
  /** Index into `inspection.hierarchy` of the component being shown. */
  focus: number;
}

function initialFocus(inspection: Inspection): number {
  const target = inspection.responsible ?? inspection.owner;
  const index = target ? inspection.hierarchy.findIndex((entry) => entry.fiber === target.fiber) : -1;
  return index >= 0 ? index : inspection.hierarchy.length - 1;
}

/** A box that follows an element through scrolls, resizes and re-renders. */
function useTrackedRect(element: Element | null): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    if (!element) {
      setRect(null);
      return;
    }
    /*
     * Event-driven rather than a requestAnimationFrame loop: a loop that never
     * stops keeps the renderer busy for as long as the inspector is open, for
     * a box that moves only when something scrolls, resizes or re-lays out.
     * The slow interval catches layout shifts no event announces.
     */
    let last = '';
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = element.isConnected ? element.getBoundingClientRect() : null;
        const key = next ? `${next.x}|${next.y}|${next.width}|${next.height}` : '';
        if (key !== last) {
          last = key;
          setRect(next);
        }
      });
    };
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(element);
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    const interval = window.setInterval(measure, 400);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
      window.clearInterval(interval);
    };
  }, [element]);
  return rect;
}

const Box: React.FC<{ rect: DOMRect | null; variant: 'hover' | 'selected'; label?: string }> = ({
  rect,
  variant,
  label,
}) => {
  if (!rect) return null;
  const labelAbove = rect.top > 24;
  return (
    <div
      className={`ui-inspector__box ui-inspector__box--${variant}`}
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
      aria-hidden
    >
      {label && (
        <span className={`ui-inspector__tag${labelAbove ? '' : ' ui-inspector__tag--below'}`}>{label}</span>
      )}
    </div>
  );
};

function hoverLabel(element: Element): string {
  const inspection = inspect(element);
  const owner = inspection.responsible?.name;
  const tag = element.tagName.toLowerCase();
  const cls = element.classList[0] ? `.${element.classList[0]}` : '';
  const rect = element.getBoundingClientRect();
  return `${owner ? `${owner} · ` : ''}${tag}${cls}  ${Math.round(rect.width)}×${Math.round(rect.height)}`;
}

const CopyButton: React.FC<{ value: string; label?: string; onCopied: (what: string) => void }> = ({
  value,
  label = 'Copy',
  onCopied,
}) => (
  <button
    type="button"
    className="ui-inspector__icon"
    title={label}
    aria-label={label}
    onClick={() => {
      void navigator.clipboard.writeText(value).then(
        () => onCopied('Copied'),
        () => onCopied('Copy failed')
      );
    }}
  >
    <Copy size={12} />
  </button>
);

const Section: React.FC<{
  id: string;
  title: string;
  count?: number;
  open: boolean;
  onToggle: (id: string, open: boolean) => void;
  children: React.ReactNode;
}> = ({ id, title, count, open, onToggle, children }) => (
  <details
    className="ui-inspector__section"
    open={open}
    onToggle={(event) => onToggle(id, (event.currentTarget as HTMLDetailsElement).open)}
  >
    <summary>
      <ChevronRight size={13} className="ui-inspector__chevron" aria-hidden />
      {title}
      {count !== undefined && <span className="ui-inspector__count">{count}</span>}
    </summary>
    <div className="ui-inspector__section-body">{children}</div>
  </details>
);

const DEFAULT_SECTIONS: Record<string, boolean> = {
  hierarchy: true,
  props: true,
  state: false,
  interaction: true,
  element: false,
};

export const UiInspector: React.FC = () => {
  const [picking, setPicking] = useState(false);
  const [hovered, setHovered] = useState<Element | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [editor, setEditor] = useState<InspectorEditor>(() => readStore(EDITOR_KEY, 'vscode'));
  const [width, setWidth] = useState<number>(() => readStore(WIDTH_KEY, 400));
  const [sections, setSections] = useState<Record<string, boolean>>(() => ({
    ...DEFAULT_SECTIONS,
    ...readStore<Record<string, boolean>>(SECTIONS_KEY, {}),
  }));
  const [showLibrary, setShowLibrary] = useState<boolean>(() => readStore(LIBRARY_KEY, false));

  const pickingRef = useRef(picking);
  pickingRef.current = picking;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  const flashTimer = useRef<number | null>(null);
  const notify = useCallback((text: string) => {
    setFlash(text);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 1800);
  }, []);

  const select = useCallback((element: Element, focus?: number) => {
    const inspection = inspect(element);
    setSelection({ element, inspection, focus: focus ?? initialFocus(inspection) });
    setHovered(null);
    setPicking(false);
  }, []);

  // --- global gestures -----------------------------------------------------
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        event.stopPropagation();
        setPicking((current) => !current);
        setHovered(null);
        return;
      }
      if (event.key === 'Escape') {
        if (pickingRef.current) {
          event.preventDefault();
          event.stopImmediatePropagation();
          setPicking(false);
          setHovered(null);
        } else if (selectionRef.current) {
          event.preventDefault();
          event.stopImmediatePropagation();
          setSelection(null);
        }
        return;
      }
      const current = selectionRef.current;
      if (current && event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        const next =
          event.key === 'ArrowUp' ? current.element.parentElement : current.element.firstElementChild;
        if (next && !isInspectorUi(next) && next !== document.body.parentElement) {
          event.preventDefault();
          select(next);
        }
      }
    };
    const onStart = () => {
      setPicking(true);
      setHovered(null);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener(UI_INSPECTOR_EVENT, onStart);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener(UI_INSPECTOR_EVENT, onStart);
    };
  }, [select]);

  useEffect(() => {
    const swallow = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };
    const onMove = (event: MouseEvent) => {
      if (!pickingRef.current || isInspectorUi(event.target)) return;
      const target = event.target instanceof Element ? event.target : null;
      setHovered((current) => (current === target ? current : target));
    };
    const onPress = (event: MouseEvent) => {
      if (isInspectorUi(event.target)) return;
      if (pickingRef.current || (event.altKey && event.button === 0)) swallow(event);
    };
    const onClick = (event: MouseEvent) => {
      if (isInspectorUi(event.target)) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      if (pickingRef.current || event.altKey) {
        swallow(event);
        select(target);
      }
    };
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('pointerdown', onPress, true);
    window.addEventListener('mousedown', onPress, true);
    window.addEventListener('mouseup', onPress, true);
    window.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('pointerdown', onPress, true);
      window.removeEventListener('mousedown', onPress, true);
      window.removeEventListener('mouseup', onPress, true);
      window.removeEventListener('click', onClick, true);
    };
  }, [select]);

  useEffect(() => {
    document.body.classList.toggle('ui-inspector-picking', picking);
    return () => document.body.classList.remove('ui-inspector-picking');
  }, [picking]);

  // --- what is highlighted ---------------------------------------------------
  const focused: ComponentInfo | undefined = selection?.inspection.hierarchy[selection.focus];
  const focusNode = useMemo(() => {
    if (!selection || !focused) return selection?.element ?? null;
    // The clicked element when the focus is the component that drew it,
    // otherwise that component's own first element.
    if (focused === selection.inspection.responsible || focused === selection.inspection.owner) {
      return selection.element;
    }
    return firstHostNode(focused.fiber) ?? selection.element;
  }, [selection, focused]);

  const hoverRect = useTrackedRect(picking ? hovered : null);
  const selectedRect = useTrackedRect(focusNode);
  const hoverText = useMemo(() => (hovered ? hoverLabel(hovered) : undefined), [hovered]);

  const dockLeft = selectedRect ? selectedRect.left + selectedRect.width / 2 > window.innerWidth / 2 : false;

  // --- actions ---------------------------------------------------------------
  const openSource = useCallback(
    async (location: string | undefined) => {
      const parsed = parseLocation(location);
      if (!parsed) return;
      const result = await window.cloudstream?.openInEditor?.(parsed.file, parsed.line, parsed.column, editor);
      if (!result?.ok) {
        const copied = await navigator.clipboard.writeText(location ?? '').then(
          () => true,
          () => false
        );
        notify(`${result?.error ?? 'Could not open the editor'}${copied ? ' — path copied' : ''}`);
      }
    },
    [editor, notify]
  );

  const toggleSection = useCallback((id: string, open: boolean) => {
    setSections((current) => {
      if (current[id] === open) return current;
      const next = { ...current, [id]: open };
      writeStore(SECTIONS_KEY, next);
      return next;
    });
  }, []);

  const startResize = (event: React.PointerEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const move = (e: PointerEvent) => {
      const delta = dockLeft ? e.clientX - startX : startX - e.clientX;
      setWidth(Math.max(300, Math.min(window.innerWidth - 120, startWidth + delta)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setWidth((current) => {
        writeStore(WIDTH_KEY, current);
        return current;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // --- render ------------------------------------------------------------------
  const hierarchy = selection?.inspection.hierarchy ?? [];
  const shownHierarchy = hierarchy
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => showLibrary || entry.kind === 'app');
  const hiddenCount = hierarchy.length - shownHierarchy.length;
  const element = selection?.inspection.element;
  const props = Object.entries(focused?.props ?? {});
  const handlers = element
    ? [
        ...element.handlers.map((handler) => ({
          name: handler.name,
          where: `on <${handler.on}>`,
          at: handler.at,
        })),
        ...props
          .filter(([key, value]) => /^on[A-Z]/.test(key) && typeof value === 'function')
          .map(([key]) => ({ name: key, where: `prop of ${focused?.name}`, at: undefined as string | undefined })),
      ]
    : [];
  const primaryLocation = focused?.definedAt ?? element?.writtenAt;

  return (
    <div data-cs3-inspector>
      {picking && <Box rect={hoverRect} variant="hover" label={hoverText} />}
      {selection && <Box rect={selectedRect} variant="selected" />}

      {picking && (
        <div className="ui-inspector__hint" role="status">
          <Crosshair size={14} /> Click anything to inspect it · Esc to stop
        </div>
      )}

      {selection && element && (
        <aside
          className={`ui-inspector${dockLeft ? ' ui-inspector--left' : ''}`}
          style={{ width }}
          aria-label="UI inspector"
        >
          <div className="ui-inspector__resize" onPointerDown={startResize} aria-hidden />
          <header className="ui-inspector__head">
            <span className="ui-inspector__title">UI Inspector</span>
            <button
              type="button"
              className="ui-inspector__icon"
              onClick={() => setSelection(null)}
              aria-label="Close the inspector"
              title="Close (Esc)"
            >
              <X size={15} />
            </button>
          </header>

          <div className="ui-inspector__scroll">
            <div className="ui-inspector__identity">
              <div className="ui-inspector__name">
                {focused?.name ?? `<${element.tag}>`}
                {focused && focused.kind !== 'app' && (
                  <span className="ui-inspector__kind">{focused.kind}</span>
                )}
              </div>
              {primaryLocation ? (
                <div className="ui-inspector__location">
                  <button
                    type="button"
                    className="ui-inspector__path"
                    title={`Open ${primaryLocation}`}
                    onClick={() => void openSource(primaryLocation)}
                  >
                    {shortLocation(primaryLocation)}
                    <ExternalLink size={12} aria-hidden />
                  </button>
                  <CopyButton value={primaryLocation} label="Copy location" onCopied={notify} />
                </div>
              ) : (
                <p className="ui-inspector__muted">
                  No source location. Source stamps exist only in a development run (`bun run dev`).
                </p>
              )}
              <dl className="ui-inspector__facts">
                {focused?.renderedAt && (
                  <>
                    <dt>Rendered at</dt>
                    <dd>
                      <button type="button" className="ui-inspector__link" onClick={() => void openSource(focused.renderedAt)}>
                        {shortLocation(focused.renderedAt)}
                      </button>
                    </dd>
                  </>
                )}
                {element.writtenAt && element.writtenAt !== primaryLocation && (
                  <>
                    <dt>Element JSX</dt>
                    <dd>
                      <button type="button" className="ui-inspector__link" onClick={() => void openSource(element.writtenAt)}>
                        {shortLocation(element.writtenAt)}
                      </button>
                    </dd>
                  </>
                )}
                {selection.inspection.owner && selection.inspection.owner.fiber !== focused?.fiber && (
                  <>
                    <dt>Drawn by</dt>
                    <dd>{selection.inspection.owner.name}</dd>
                  </>
                )}
                <dt>Element</dt>
                <dd>
                  &lt;{element.tag}&gt; {element.size.width}×{element.size.height}
                </dd>
              </dl>
            </div>

            <Section
              id="hierarchy"
              title="Component hierarchy"
              count={shownHierarchy.length}
              open={sections.hierarchy}
              onToggle={toggleSection}
            >
              <ol className="ui-inspector__tree">
                {shownHierarchy.map(({ entry, index }, depth) => (
                  <li key={index} style={{ paddingLeft: `${Math.min(depth, 14) * 10}px` }}>
                    <button
                      type="button"
                      className={`ui-inspector__node${index === selection.focus ? ' is-focused' : ''}${
                        entry.kind !== 'app' ? ' is-dim' : ''
                      }`}
                      title={entry.definedAt ?? 'No source location'}
                      onClick={() => setSelection({ ...selection, focus: index })}
                    >
                      {depth > 0 && <span className="ui-inspector__branch">└</span>}
                      {entry.name}
                      {index === selection.focus && <span className="ui-inspector__dot" aria-label="selected" />}
                    </button>
                  </li>
                ))}
              </ol>
              <label className="ui-inspector__toggle">
                <input
                  type="checkbox"
                  checked={showLibrary}
                  onChange={(event) => {
                    setShowLibrary(event.target.checked);
                    writeStore(LIBRARY_KEY, event.target.checked);
                  }}
                />
                Show library and framework components{hiddenCount > 0 ? ` (${hiddenCount} hidden)` : ''}
              </label>
              {focused && !firstHostNode(focused.fiber) && (
                <p className="ui-inspector__muted">This component renders no element of its own.</p>
              )}
            </Section>

            <Section id="props" title={`Props${focused ? ` — ${focused.name}` : ''}`} count={props.length} open={sections.props} onToggle={toggleSection}>
              {props.length === 0 ? (
                <p className="ui-inspector__muted">None.</p>
              ) : (
                <table className="ui-inspector__table">
                  <tbody>
                    {props.map(([key, value]) => (
                      <tr key={key}>
                        <th>{key}</th>
                        <td title={preview(value)}>{preview(value)}</td>
                        <td>
                          <CopyButton value={`${key}: ${preview(value)}`} label={`Copy ${key}`} onCopied={notify} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Section>

            <Section id="state" title="State" count={focused?.state.length ?? 0} open={sections.state} onToggle={toggleSection}>
              {!focused?.state.length ? (
                <p className="ui-inspector__muted">No useState or useReducer values.</p>
              ) : (
                <table className="ui-inspector__table">
                  <tbody>
                    {focused.state.map((value, index) => (
                      <tr key={index}>
                        <th>[{index}]</th>
                        <td title={preview(value)}>{preview(value)}</td>
                        <td>
                          <CopyButton value={preview(value)} label={`Copy state ${index}`} onCopied={notify} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Section>

            <Section id="interaction" title="Interaction" count={handlers.length} open={sections.interaction} onToggle={toggleSection}>
              {handlers.length === 0 ? (
                <p className="ui-inspector__muted">No handlers on this element or component.</p>
              ) : (
                <ul className="ui-inspector__list">
                  {handlers.map((handler) => (
                    <li key={`${handler.name}-${handler.where}-${handler.at ?? ''}`}>
                      <code>{handler.name}</code> <span className="ui-inspector__muted">{handler.where}</span>
                      {handler.at && (
                        <button type="button" className="ui-inspector__link" onClick={() => void openSource(handler.at)}>
                          {shortLocation(handler.at)}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section id="element" title="Element" open={sections.element} onToggle={toggleSection}>
              <table className="ui-inspector__table">
                <tbody>
                  <tr>
                    <th>tag</th>
                    <td>{element.tag}</td>
                    <td />
                  </tr>
                  {element.classes.length > 0 && (
                    <tr>
                      <th>class</th>
                      <td title={element.classes.join(' ')}>{element.classes.join(' ')}</td>
                      <td>
                        <CopyButton value={element.classes.join(' ')} label="Copy classes" onCopied={notify} />
                      </td>
                    </tr>
                  )}
                  {element.text && (
                    <tr>
                      <th>text</th>
                      <td title={element.text}>{element.text}</td>
                      <td />
                    </tr>
                  )}
                  {element.attributes.map(([name, value]) => (
                    <tr key={name}>
                      <th>{name}</th>
                      <td title={value}>{value}</td>
                      <td />
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="ui-inspector__nav">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => {
                  const parent = selection.element.parentElement;
                  if (parent && parent !== document.documentElement) select(parent);
                }} title="Alt+↑">
                  <ArrowUpToLine size={13} /> Parent element
                </button>
                <button type="button" className="btn btn-ghost btn-sm" disabled={!selection.element.firstElementChild} onClick={() => {
                  const child = selection.element.firstElementChild;
                  if (child) select(child);
                }} title="Alt+↓">
                  <ArrowDownToLine size={13} /> First child
                </button>
              </div>
            </Section>
          </div>

          <footer className="ui-inspector__foot">
            <select
              className="ui-inspector__editor"
              value={editor}
              aria-label="Open source files in"
              title="Open source files in"
              onChange={(event) => {
                const next = event.target.value as InspectorEditor;
                setEditor(next);
                writeStore(EDITOR_KEY, next);
              }}
            >
              <option value="vscode">VS Code</option>
              <option value="cursor">Cursor</option>
              <option value="windsurf">Windsurf</option>
              <option value="vscode-insiders">VS Code Insiders</option>
              <option value="system">Default app</option>
            </select>
            <span className="ui-inspector__spacer" />
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPicking(true)}>
              <Crosshair size={13} /> Inspect another
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                void navigator.clipboard
                  .writeText(formatForAgent(selection.inspection, focused))
                  .then(
                    () => notify('Inspection copied'),
                    () => notify('Copy failed')
                  );
              }}
            >
              {flash === 'Inspection copied' ? <Check size={13} /> : <Copy size={13} />} Copy inspection
            </button>
          </footer>
          {flash && (
            <div className="ui-inspector__flash" role="status">
              <Check size={12} /> {flash}
            </div>
          )}
        </aside>
      )}
    </div>
  );
};

export default UiInspector;
