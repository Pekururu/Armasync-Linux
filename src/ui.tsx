import type { StatusKey } from "./kalmui/index";
import { type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type { StatusKey };

/** Icons KalmUI doesn't have, drawn on its 24px grid with its 2px stroke. */
const EXTRA_ICONS: Record<string, string> = {
  play: '<path d="M7.5 5.5v13l11-6.5z" fill="currentColor"/>',
  radio: '<rect x="6.5" y="8.5" width="11" height="13" rx="2.5"/><path d="M9.5 8.5V5.5M14.5 8.5V2.5"/><rect x="9.5" y="11.5" width="5" height="2.5" rx=".5" fill="currentColor" stroke="none"/><circle cx="9.5" cy="17.5" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="17.5" r="1" fill="currentColor" stroke="none"/><circle cx="14.5" cy="17.5" r="1" fill="currentColor" stroke="none"/>',
};

/** A KalmUI icon, or one of `EXTRA_ICONS` inside KalmUI's own `<svg>` wrapper. */
export function Icon({ name }: { name: string }) {
  const extra = EXTRA_ICONS[name];
  const html = extra ? window.KalmUI.icon("").replace("</svg>", `${extra}</svg>`) : window.KalmUI.icon(name);
  return <span className="as-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Status is always shape plus word. Leave out `children` only where a title beside it carries the word. */
export function Status({ status, children, cut }: { status: StatusKey; children?: ReactNode; cut?: string }) {
  return <span className="k-status" data-status={status} style={cut ? { "--k-cut": cut } as CSSProperties : undefined}><Icon name={status} />{children}</span>;
}

/** The six-dot handle on rows that can be dragged. */
export function Grip() {
  return <span className="as-grip" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <i key={index} />)}</span>;
}

export function Banner({ tone, title, children, action }: { tone?: "danger"; title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="k-banner" data-tone={tone} role={tone === "danger" ? "alert" : "status"}>
    <Icon name={tone === "danger" ? "alert" : "info"} />
    <div className="k-banner-body"><span className="k-banner-title">{title}</span>{children && <span className="k-banner-text">{children}</span>}</div>
    {action}
  </div>;
}

export function Progress({ value, label, indeterminate }: { value: number; label: string; indeterminate?: boolean }) {
  return <div className={`k-focus-track ${indeterminate ? "as-indeterminate" : ""}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={indeterminate ? undefined : value}>
    <span style={{ "--p": `${indeterminate ? 100 : value}%` } as CSSProperties} />
  </div>;
}

export function toast(text: string, options?: { action?: string; onAction?: () => void }) {
  window.KalmUI.toast(text, options);
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied");
  } catch {
    toast("Couldn't copy");
  }
}

// ---------- Menus: pickers, ⋯ menus and the addon context menu ----------

export type MenuEntry = {
  label: string;
  sub?: string;
  /** A keyboard shortcut, shown at the end of the item. */
  keys?: string;
  checked?: boolean;
  disabled?: boolean;
  onSelect: () => void;
} | "separator";

type Anchor = { left: number; top: number; bottom: number; width: number };

export function Menu({ anchor, items, label, onClose, returnFocus }: { anchor: Anchor; items: MenuEntry[]; label: string; onClose: () => void; returnFocus?: HTMLElement | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const radio = items.some((item) => item !== "separator" && item.checked !== undefined);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const { offsetWidth: width, offsetHeight: height } = element;
    const below = anchor.bottom + 6;
    const top = below + height > window.innerHeight - 8 ? Math.max(8, anchor.top - height - 6) : below;
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8));
    setPosition({ left, top });
  }, [anchor]);

  // Focus once the menu is placed and visible, and only on open.
  useEffect(() => {
    const frame = requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>("[aria-checked='true']:not(:disabled), [role^='menuitem']:not(:disabled)")?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    // The button that opened the menu toggles it itself, so a press on it isn't "outside".
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!ref.current?.contains(target) && !returnFocus?.contains(target)) onClose();
    };
    const blur = () => onClose();
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("blur", blur);
    window.addEventListener("resize", blur);
    return () => { window.removeEventListener("pointerdown", close, true); window.removeEventListener("blur", blur); window.removeEventListener("resize", blur); };
  }, [onClose, returnFocus]);

  function close() {
    onClose();
    returnFocus?.focus({ preventScroll: true });
  }

  function move(event: React.KeyboardEvent) {
    const entries = [...(ref.current?.querySelectorAll<HTMLButtonElement>("[role^='menuitem']:not(:disabled)") ?? [])];
    const index = entries.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape" || event.key === "Tab") { event.preventDefault(); close(); return; }
    const next = event.key === "ArrowDown" ? index + 1 : event.key === "ArrowUp" ? index - 1 : event.key === "Home" ? 0 : event.key === "End" ? entries.length - 1 : null;
    if (next === null || !entries.length) return;
    event.preventDefault();
    entries[(next + entries.length) % entries.length].focus();
  }

  return createPortal(
    <div ref={ref} className="as-menu" role="menu" aria-label={label} onKeyDown={move}
      style={{ left: position?.left ?? anchor.left, top: position?.top ?? anchor.bottom, minWidth: Math.max(anchor.width, 200), visibility: position ? "visible" : "hidden" }}>
      {items.map((item, index) => item === "separator"
        ? <div key={`separator-${index}`} className="as-menu-separator" role="separator" />
        : <button key={`${item.label}-${index}`} type="button" role={radio ? "menuitemradio" : "menuitem"} aria-checked={radio ? !!item.checked : undefined} disabled={item.disabled}
          className="as-menu-item" onClick={() => { close(); item.onSelect(); }}>
          <span className="as-menu-text"><span className="label">{item.label}</span>{item.sub && <span className="subtext k-muted">{item.sub}</span>}</span>
          {item.keys && <span className="subtext k-muted k-num as-menu-keys" aria-hidden="true">{item.keys}</span>}
          {item.checked && <Icon name="check" />}
        </button>)}
    </div>,
    document.body,
  );
}

export function anchorOf(element: HTMLElement): Anchor {
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.top, bottom: rect.bottom, width: rect.width };
}

export function pointAnchor(x: number, y: number): Anchor {
  return { left: x, top: y, bottom: y, width: 0 };
}

/** A button that opens a menu. `className` defaults to a neutral picker with a chevron. */
export function MenuButton({ items, label, children, className = "k-btn k-btn-neutral", icon, disabled, title, fill }: {
  items: MenuEntry[] | (() => MenuEntry[]);
  label: string;
  children?: ReactNode;
  className?: string;
  icon?: string;
  disabled?: boolean;
  title?: string;
  fill?: boolean;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const isIcon = className.includes("k-btn-icon");
  return <>
    <button ref={button} type="button" className={`${className} ${fill ? "as-fill" : ""}`} aria-haspopup="menu" aria-expanded={!!anchor}
      aria-label={isIcon ? label : undefined} title={title} disabled={disabled}
      onClick={() => setAnchor((current) => current ? null : anchorOf(button.current!))}>
      {isIcon ? <Icon name={icon ?? "more"} /> : <><span className="as-ellipsis">{children}</span><Icon name={icon ?? "chevron"} /></>}
    </button>
    {anchor && <Menu anchor={anchor} items={typeof items === "function" ? items() : items} label={label} returnFocus={button.current} onClose={() => setAnchor(null)} />}
  </>;
}

// ---------- Sheet and dialog ----------

function useModal(open: boolean, onClose: () => void, container: React.RefObject<HTMLElement | null>) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!open) { setShown(false); return; }
    const previous = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
    const focus = window.setTimeout(() => container.current?.querySelector<HTMLElement>("[autofocus], input, button, textarea")?.focus({ preventScroll: true }), 60);
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab" || !container.current) return;
      const focusable = [...container.current.querySelectorAll<HTMLElement>("button, input, textarea, select, a[href], [tabindex='0']")].filter((item) => !(item as HTMLButtonElement).disabled && item.offsetParent !== null);
      if (!focusable.length) return;
      if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1)!.focus(); }
      else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0].focus(); }
    };
    document.addEventListener("keydown", keys);
    return () => { cancelAnimationFrame(frame); window.clearTimeout(focus); document.removeEventListener("keydown", keys); previous?.focus?.({ preventScroll: true }); };
  }, [open]);
  return shown;
}

export function Sheet({ open, onClose, title, sub, children, footer }: { open: boolean; onClose: () => void; title: string; sub?: string; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const shown = useModal(open, onClose, ref);
  if (!open) return null;
  return createPortal(<>
    <div className={`k-scrim ${shown ? "is-open" : ""}`} onClick={onClose} />
    <aside ref={ref} className={`k-sheet as-sheet ${shown ? "is-open" : ""}`} role="dialog" aria-modal="true" aria-labelledby="as-sheet-title">
      <div className="k-sheet-head">
        <div className="as-stack-tight as-grow"><h2 className="k-sheet-title" id="as-sheet-title">{title}</h2>{sub && <span className="subtext k-muted">{sub}</span>}</div>
        <button type="button" className="k-btn k-btn-icon" aria-label="Close" onClick={onClose}><Icon name="close" /></button>
      </div>
      <div className="as-sheet-body">{children}</div>
      {footer && <div className="as-sheet-footer">{footer}</div>}
    </aside>
  </>, document.body);
}

export function Dialog({ open, onClose, eyebrow, title, children, actions, busy }: { open: boolean; onClose: () => void; eyebrow?: string; title: string; children: ReactNode; actions: ReactNode; busy?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const shown = useModal(open, () => { if (!busy) onClose(); }, ref);
  if (!open) return null;
  return createPortal(<>
    <div className={`k-scrim ${shown ? "is-open" : ""}`} onClick={() => { if (!busy) onClose(); }} />
    <div ref={ref} className={`as-dialog ${shown ? "is-open" : ""}`} role="dialog" aria-modal="true" aria-labelledby="as-dialog-title">
      <div className="as-stack-tight">{eyebrow && <span className="k-eyebrow as-flat">{eyebrow}</span>}<h2 className="title-1 as-flat" id="as-dialog-title">{title}</h2></div>
      {children}
      <div className="k-actions as-end">{actions}</div>
    </div>
  </>, document.body);
}

// ---------- Pointer drag: a lifted row that follows the pointer ----------

export type DragState<P> = { payload: P; x: number; y: number; offsetX: number; offsetY: number; width: number };

/**
 * Pointer-driven drag and drop. HTML drag and drop can't show a live target
 * ("Drop to add as #6") and is unreliable in WebKitGTK, so rows are moved by hand.
 */
export function usePointerDrag<P>(handlers: { move?: (state: DragState<P>) => void; drop: (state: DragState<P>) => void; cancel?: () => void }) {
  const latest = useRef(handlers);
  latest.current = handlers;
  const [drag, setDrag] = useState<DragState<P> | null>(null);

  function begin(event: ReactPointerEvent<HTMLElement>, payload: P) {
    if (event.button !== 0) return;
    // A button inside the row (remove, ⋯) acts on the first click. Pressing it
    // mustn't focus or select the row first, or the click gets lost.
    if ((event.target as HTMLElement).closest("button, input, a")) { event.preventDefault(); return; }
    const rect = event.currentTarget.getBoundingClientRect();
    const startX = event.clientX, startY = event.clientY;
    let current: DragState<P> | null = null;
    const move = (moveEvent: PointerEvent) => {
      if (!current && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 5) return;
      if (!current) {
        document.documentElement.classList.add("as-dragging");
        window.getSelection()?.removeAllRanges();
      }
      current = { payload, x: moveEvent.clientX, y: moveEvent.clientY, offsetX: startX - rect.left, offsetY: startY - rect.top, width: rect.width };
      setDrag(current);
      latest.current.move?.(current);
    };
    const finish = (commit: boolean) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("keydown", key, true);
      document.documentElement.classList.remove("as-dragging");
      if (current && commit) latest.current.drop(current);
      else if (current) latest.current.cancel?.();
      setDrag(null);
    };
    const up = () => finish(true);
    const key = (keyEvent: KeyboardEvent) => { if (keyEvent.key === "Escape") { keyEvent.preventDefault(); keyEvent.stopPropagation(); finish(false); } };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("keydown", key, true);
  }

  return { drag, begin };
}

/** Where a pointer at `y` lands among the rows marked `data-drop-index` inside `list`. */
export function dropIndexAt(list: HTMLElement, y: number) {
  const rows = [...list.querySelectorAll<HTMLElement>("[data-drop-index]")];
  for (const row of rows) {
    const rect = row.getBoundingClientRect();
    if (y < rect.top + rect.height / 2) return Number(row.dataset.dropIndex);
  }
  return rows.length;
}

/** Scrolls a list while a drag hovers near its top or bottom edge. */
export function edgeScroll(list: HTMLElement | null, y: number) {
  if (!list) return;
  const rect = list.getBoundingClientRect();
  if (y < rect.top + 40 && y > rect.top - 20) list.scrollBy({ top: -12 });
  else if (y > rect.bottom - 40 && y < rect.bottom + 20) list.scrollBy({ top: 12 });
}

/** True when an event on a row really came from a control inside it, such as its remove button. */
export function fromControl(event: { target: EventTarget; currentTarget: EventTarget }) {
  return event.target !== event.currentTarget && !!(event.target as HTMLElement).closest("button, input, a");
}

export function inside(element: HTMLElement | null, x: number, y: number) {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

export function DragGhost({ state, title, sub }: { state: DragState<unknown>; title: string; sub: string }) {
  return createPortal(
    <div className="k-row as-ghost" style={{ left: state.x - state.offsetX, top: state.y - state.offsetY, width: Math.min(state.width, 360) }}>
      <Grip />
      <div className="k-row-body"><span className="k-row-title">{title}</span><span className="k-row-sub">{sub}</span></div>
    </div>,
    document.body,
  );
}
