// KalmUI is CSS classes (bundle.css) plus a few plain-DOM helpers (bundle.js). No framework.

export type StatusKey = "todo" | "doing" | "done" | "exception" | "na";
export interface Status { key: StatusKey; label: string; short: string; resolved: boolean; desc: string }
export type StatusLabels = Partial<Record<StatusKey, Partial<Pick<Status, "label" | "short" | "desc">>>>;

export interface ComfortPrefs {
  /** Text size, 0.9 to 1.4. Applied as --k-scale on <html>. */
  scale: number;
  /** "system" follows prefers-reduced-motion. */
  motion: "system" | "reduce" | "full";
  /** Chimes. Off by default. */
  sound: boolean;
  /** Play layer confetti. On by default, never with reduced motion. */
  celebrate: boolean;
  /** Hides elements marked k-calm-hide. */
  calm: boolean;
}

export interface RingPart { value: number; status?: StatusKey }
export interface RingOptions {
  size?: number; stroke?: number; total: number;
  value?: number; parts?: RingPart[];
  center?: string | number; label?: string; ariaLabel: string;
}

export interface PickerHandle { set(key: StatusKey): void; get(): StatusKey; statuses: Status[] }

export interface KalmUI {
  version: string;
  /** Returns an inline SVG string, 24px, 2px stroke. */
  icon(name: string): string;
  icons: string[];
  esc(text: string): string;
  /** The five statuses, optionally with project labels. */
  statuses(labels?: StatusLabels): Status[];
  prefs(): ComfortPrefs;
  setPref(patch: Partial<ComfortPrefs>): void;
  onPrefs(fn: (prefs: ComfortPrefs) => void): void;
  reduceMotion(): boolean;
  /** Renders the standard settings into el. */
  mountComfort(el: HTMLElement, opts?: { play?: boolean; calm?: { title?: string; sub?: string } }): void;
  /** Paints the filled part of a .k-slider track. */
  slider(input: HTMLInputElement): void;
  /** Collapses the large title as scroller scrolls. Returns the update function. */
  appBar(el: HTMLElement, scroller?: HTMLElement): () => void;
  /** Five status tiles as a radiogroup, plus the description line after it. */
  picker(el: HTMLElement, opts?: { value?: StatusKey; label?: string; labels?: StatusLabels; onChange?(key: StatusKey, status: Status): void }): PickerHandle;
  toast(text: string, opts?: { action?: string; onAction?(): void; duration?: number }): void;
  hideToast(): void;
  openSheet(el: HTMLElement): void;
  closeSheet(): void;
  /** Returns the ring markup as a string. */
  ring(opts: RingOptions): string;
  chime(kind?: "done" | "group" | "badge", force?: boolean): void;
  /** Small burst plus chime. Returns false when celebrations are off or motion is reduced. */
  celebrate(opts?: { x?: number; y?: number; chime?: "done" | "group" | "badge" }): boolean;
  /** Slides a focus card out, calls render, slides it back in. */
  swap(card: HTMLElement, render: () => void): void;
}

declare global { interface Window { KalmUI: KalmUI } }
