import type { AddonSource, SavedRepository, SourceStatus } from "../bindings";
import type { Catalog } from "../state/catalog";
import { openPath } from "@tauri-apps/plugin-opener";
import { type KeyboardEvent, useRef, useState } from "react";
import { plural, tidyPath } from "../format";
import { repositoryFor } from "../state/catalog";
import { Banner, DragGhost, Grip, Icon, MenuButton, Sheet, Status, dropIndexAt, edgeScroll, inside, usePointerDrag } from "../ui";

const problemWords: Partial<Record<SourceStatus, string>> = {
  disabled: "Turned off",
  missing: "Folder missing",
  unreadable: "Can't read this folder",
};

export default function Sources({ open, onClose, catalog, repositories }: { open: boolean; onClose: () => void; catalog: Catalog; repositories: SavedRepository[] }) {
  const { sources, sourceBusy, mutateSources } = catalog;
  const list = useRef<HTMLDivElement>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const hasWorkshop = sources.some((source) => source.kind === "workshop");
  const ownedDlc = catalog.dlcAddons.filter((addon) => addon.available).length;

  const { drag, begin } = usePointerDrag<string>({
    move: (state) => { edgeScroll(list.current, state.y); setDropIndex(list.current && inside(list.current, state.x, state.y) ? dropIndexAt(list.current, state.y) : null); },
    drop: (state) => {
      const index = list.current && inside(list.current, state.x, state.y) ? dropIndexAt(list.current, state.y) : null;
      setDropIndex(null);
      if (index === null) return;
      const existing = sources.findIndex((source) => source.id === state.payload);
      if (existing < 0 || index === existing || index === existing + 1) return;
      void moveSource(state.payload, existing < index ? index - 1 : index);
    },
    cancel: () => setDropIndex(null),
  });
  const dragged = drag ? sources.find((source) => source.id === drag.payload) : undefined;
  const draggedIndex = dragged ? sources.indexOf(dragged) : -1;
  const lineIndex = dropIndex !== null && !(dropIndex === draggedIndex || dropIndex === draggedIndex + 1) ? dropIndex : null;

  /** Puts a source at `place`, counted from the top once it has moved. */
  async function moveSource(id: string, place: number, announce = false) {
    const existing = sources.findIndex((source) => source.id === id);
    const target = Math.max(0, Math.min(place, sources.length - 1));
    if (existing < 0 || target === existing || sourceBusy) return;
    const reordered = [...sources];
    const [moved] = reordered.splice(existing, 1);
    reordered.splice(target, 0, moved);
    await catalog.reorderSources(reordered.map((source) => source.id));
    if (!announce) return;
    setAnnouncement(`${describe(moved).title} moved to ${target + 1} of ${sources.length}`);
    // Keep the keyboard on the row that moved.
    requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[data-source-id="${CSS.escape(id)}"] .k-row-trail button`)?.focus());
  }

  /** Alt+arrows, Home and End move a source while focus is on its row. */
  function rowKey(event: KeyboardEvent<HTMLElement>, id: string, index: number) {
    const moves: Record<string, number> = { ArrowUp: index - 1, ArrowDown: index + 1, Home: 0, End: sources.length - 1 };
    // Keys pressed inside the row's own menu bubble here through the portal; leave those to the menu.
    if (!event.altKey || !(event.key in moves) || !event.currentTarget.contains(event.target as Node)) return;
    event.preventDefault();
    void moveSource(id, moves[event.key], true);
  }

  function describe(source: AddonSource) {
    const repository = source.kind === "custom" ? repositoryFor(source.path, repositories) : undefined;
    const title = repository?.name ?? source.name;
    // A repository's download folder stays while the repository does; remove the repository first.
    const locked = !!repository;
    return { title, sub: `${tidyPath(source.path)}. ${plural(source.addonCount, "mod")}`, locked, repository };
  }

  return <Sheet open={open} onClose={onClose} title="Sources" sub="Scanned top to bottom. The first match wins."
    footer={<div className="k-actions">
      <button type="button" className="k-btn k-btn-primary as-grow" disabled={sourceBusy} onClick={() => void catalog.addSource()}><Icon name="plus" />Add Folder</button>
      <button type="button" className="k-btn k-btn-neutral" disabled={sourceBusy || catalog.isRescanning} onClick={() => void catalog.rescanAll()}><Icon name="undo" />{catalog.isRescanning ? "Scanning…" : "Rescan"}</button>
    </div>}>
    <div className="k-card k-card-flush as-sunken" ref={list} role="list" aria-label="Scan folders in priority order">
      {sources.map((source, index) => {
        const { title, sub, locked } = describe(source);
        const problem = problemWords[source.status];
        return <div key={source.id} className="as-drop-slot" role="listitem">
          {lineIndex === index && <div className="as-drop-line" aria-hidden="true" />}
          <div data-drop-index={index} data-source-id={source.id} className={`k-row as-static as-draggable ${!source.enabled ? "as-unavailable" : ""} ${drag?.payload === source.id ? "as-lifted" : ""}`}
            onPointerDown={(event) => begin(event, source.id)} onKeyDown={(event) => rowKey(event, source.id, index)} title="Drag or press Alt+↑↓ to change the order">
            <Grip />
            <span className="label k-muted k-num as-order">{index + 1}</span>
            <div className="k-row-body">
              <span className="k-row-title as-ellipsis">{title}</span>
              <span className="k-row-sub" title={source.path}>{sub}</span>
              {problem && <Status status={source.status === "disabled" ? "na" : "exception"} cut="var(--surface-sunken)">{problem}</Status>}
            </div>
            <span className="k-row-trail">
              {locked && <span className="as-lock" title="Download folder of a repository. Remove the repository to remove it here."><Icon name="lock" /></span>}
              <MenuButton className="k-btn k-btn-icon" label={`Actions for ${title}`} title="More" items={[
                { label: "Move Up", keys: "Alt+↑", disabled: sourceBusy || index === 0, onSelect: () => void moveSource(source.id, index - 1, true) },
                { label: "Move Down", keys: "Alt+↓", disabled: sourceBusy || index === sources.length - 1, onSelect: () => void moveSource(source.id, index + 1, true) },
                "separator",
                { label: "Open Folder", onSelect: () => void openPath(source.path) },
                { label: source.enabled ? "Turn Off" : "Turn On", disabled: sourceBusy, onSelect: () => void mutateSources("set_addon_source_enabled", { id: source.id, enabled: !source.enabled }) },
                ...(locked ? [] : [{ label: "Remove", sub: "Files stay on disk", disabled: sourceBusy, onSelect: () => void mutateSources("remove_addon_source", { id: source.id }) }]),
              ]} />
            </span>
          </div>
        </div>;
      })}
      {lineIndex !== null && lineIndex >= sources.length && <div className="as-drop-line as-drop-line-end" aria-hidden="true" />}
      {!hasWorkshop && <div className="k-row as-static" role="listitem">
        <span className="as-grip-space" />
        <div className="k-row-body"><span className="k-row-title">Steam Workshop</span><span className="k-row-sub">Not added. Mods you subscribe to in Steam</span></div>
        <span className="k-row-trail"><button type="button" className="k-btn k-btn-quiet as-btn-compact" disabled={sourceBusy} onClick={() => void mutateSources("add_steam_workshop_source", {})}>Add</button></span>
      </div>}
      <div className="k-row as-static" role="listitem">
        <span className="as-grip-space" />
        <div className="k-row-body"><span className="k-row-title">DLC</span><span className="k-row-sub">{catalog.dlcDetection.gameDirectory ? `Found in the Arma 3 folder. ${ownedDlc} owned` : "Found in the Arma 3 folder once Arma is found"}</span></div>
        <span className="k-row-trail"><span className="as-lock" title="Armasync finds DLC on its own"><Icon name="lock" /></span></span>
      </div>
      {!sources.length && !sourceBusy && <div className="k-empty"><Icon name="empty" /><p className="k-empty-title">No folders yet</p><p className="k-empty-text">Add a folder that holds @mod folders.</p></div>}
    </div>

    {catalog.sourceError && <Banner tone="danger" title="Couldn't change sources">{catalog.sourceError}</Banner>}
    <Banner title="Only top-level folders">Armasync looks for @mod folders directly inside each source. It doesn't search subfolders.</Banner>

    <span className="k-sr" role="status" aria-live="polite">{announcement}</span>
    {drag && dragged && <DragGhost state={drag} title={describe(dragged).title} sub={lineIndex === null ? "Drop to keep its place" : `Drop to move to #${lineIndex > draggedIndex ? lineIndex : lineIndex + 1}`} />}
  </Sheet>;
}
