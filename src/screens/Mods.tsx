import type { SavedRepository } from "../bindings";
import type { Addon, Catalog, Groups } from "../state/catalog";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { type KeyboardEvent, type MouseEvent, useMemo, useRef, useState } from "react";
import { groupSummary, sourceLabel } from "../state/catalog";
import { Banner, Dialog, DragGhost, type DragState, Grip, Icon, Menu, type MenuEntry, MenuButton, dropIndexAt, edgeScroll, fromControl, inside, pointAnchor, toast, usePointerDrag } from "../ui";

type Origin = "installed" | "group";
type Payload = { addonId: string; origin: Origin };
type Target = { zone: "group"; index: number } | { zone: "installed" } | null;
type SourceFilter = "All" | Addon["source"];

const sourceFilters: { value: SourceFilter; label: string }[] = [
  { value: "All", label: "All sources" },
  { value: "Repository", label: "Repository" },
  { value: "Workshop", label: "Workshop" },
  { value: "Local", label: "Local" },
  { value: "DLC", label: "DLC" },
];

/** Moves focus between rows of a list with the arrow keys. */
function arrowNavigation(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const rows = [...event.currentTarget.querySelectorAll<HTMLElement>("[role='option']")];
  const index = rows.indexOf(document.activeElement as HTMLElement);
  const next = rows[index + (event.key === "ArrowDown" ? 1 : -1)];
  if (!next) return;
  event.preventDefault();
  next.focus();
}

export default function Mods({ catalog, groups, repositories, onOpenSources }: { catalog: Catalog; groups: Groups; repositories: SavedRepository[]; onOpenSources: () => void }) {
  const { activeGroup, groupAddons, updateActiveGroup } = groups;
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<SourceFilter>("All");
  const [installedSelection, setInstalledSelection] = useState<string | null>(null);
  const [groupSelection, setGroupSelection] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ mode: "create" | "rename" | "duplicate"; value: string } | null>(null);
  const [context, setContext] = useState<{ addonId: string; origin: Origin; x: number; y: number } | null>(null);
  const [target, setTarget] = useState<Target>(null);
  const installedCard = useRef<HTMLDivElement>(null);
  const groupCard = useRef<HTMLDivElement>(null);
  const groupList = useRef<HTMLDivElement>(null);

  const installedDlcCount = catalog.dlcAddons.filter((addon) => addon.available).length;
  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return catalog.allAddons.filter((addon) => (addon.kind === "mod" || addon.available)
      && (!term || `${addon.label} ${addon.name} ${addon.folder}`.toLocaleLowerCase().includes(term))
      && (source === "All" || addon.source === source));
  }, [catalog.allAddons, query, source]);
  const filteredMods = filtered.filter((addon) => addon.kind === "mod");
  const filteredDlcs = filtered.filter((addon) => addon.kind === "dlc");

  function add(id: string | null, index = activeGroup.addonIds.length) {
    const addon = catalog.allAddons.find((candidate) => candidate.id === id);
    if (!id || !addon?.available || activeGroup.addonIds.includes(id)) return;
    updateActiveGroup((ids) => { const next = [...ids]; next.splice(Math.min(index, next.length), 0, id); return next; });
    setGroupSelection(id);
  }

  function remove(id: string | null) {
    if (!id) return;
    updateActiveGroup((ids) => ids.filter((addonId) => addonId !== id));
    setGroupSelection(null);
  }

  function moveTo(addonId: string, requestedIndex: number) {
    updateActiveGroup((ids) => {
      const existingIndex = ids.indexOf(addonId);
      if (existingIndex < 0) return ids;
      const without = ids.filter((id) => id !== addonId);
      const insertion = Math.max(0, Math.min(existingIndex < requestedIndex ? requestedIndex - 1 : requestedIndex, without.length));
      without.splice(insertion, 0, addonId);
      return without;
    });
    setGroupSelection(addonId);
  }

  function targetAt(state: DragState<Payload>): Target {
    if (inside(groupCard.current, state.x, state.y) && groupList.current) return { zone: "group", index: dropIndexAt(groupList.current, state.y) };
    if (state.payload.origin === "group" && inside(installedCard.current, state.x, state.y)) return { zone: "installed" };
    return null;
  }

  const { drag, begin } = usePointerDrag<Payload>({
    move: (state) => { edgeScroll(groupList.current, state.y); setTarget(targetAt(state)); },
    drop: (state) => {
      const landing = targetAt(state);
      setTarget(null);
      if (landing?.zone === "group") {
        if (state.payload.origin === "installed") add(state.payload.addonId, landing.index);
        else moveTo(state.payload.addonId, landing.index);
      } else if (landing?.zone === "installed") remove(state.payload.addonId);
    },
    cancel: () => setTarget(null),
  });

  const draggedAddon = drag ? catalog.allAddons.find((addon) => addon.id === drag.payload.addonId) ?? groupAddons.find((addon) => addon.id === drag.payload.addonId) : undefined;
  const draggedIndex = drag?.payload.origin === "group" ? activeGroup.addonIds.indexOf(drag.payload.addonId) : -1;
  // A reorder onto its own place changes nothing, so it shows no drop line.
  const lineIndex = target?.zone === "group" && !(draggedIndex >= 0 && (target.index === draggedIndex || target.index === draggedIndex + 1)) ? target.index : null;
  const ghostSub = !drag ? "" : target?.zone === "group"
    ? drag.payload.origin === "installed" ? `Drop to add as #${target.index + 1}` : lineIndex === null ? "Drop here to keep its place" : `Drop to move to #${target.index > draggedIndex ? target.index : target.index + 1}`
    : target?.zone === "installed" ? "Drop to remove from the group" : drag.payload.origin === "installed" ? "Drag into the group" : "Drop outside to cancel";

  function openContext(event: MouseEvent<HTMLElement>, addonId: string, origin: Origin) {
    event.preventDefault();
    if (origin === "installed") setInstalledSelection(addonId); else setGroupSelection(addonId);
    const bounds = event.currentTarget.getBoundingClientRect();
    setContext({ addonId, origin, x: event.clientX || bounds.left + 28, y: event.clientY || bounds.top + 24 });
  }

  function contextItems(addon: Addon, origin: Origin): MenuEntry[] {
    const links: MenuEntry[] = [
      ...(addon.path ? [{ label: "Open Addon Folder", onSelect: () => void openPath(addon.path!) }] : []),
      ...(addon.workshopId ? [{ label: "View Workshop Page", onSelect: () => void openUrl(`https://steamcommunity.com/sharedfiles/filedetails/?id=${addon.workshopId}`).catch(() => undefined) }] : []),
      ...(addon.steamAppId ? [{ label: "View DLC On Steam", onSelect: () => void openUrl(`https://store.steampowered.com/app/${addon.steamAppId}`).catch(() => undefined) }] : []),
    ];
    if (origin === "installed") {
      const inGroup = activeGroup.addonIds.includes(addon.id);
      return [
        { label: inGroup ? "Already In This Group" : !addon.available ? addon.version ?? "Not Available" : `Add To ${activeGroup.name}`, disabled: inGroup || !addon.available, onSelect: () => add(addon.id) },
        ...(links.length ? ["separator" as const, ...links] : []),
      ];
    }
    const index = activeGroup.addonIds.indexOf(addon.id);
    return [
      { label: "Move To Top", disabled: index === 0, onSelect: () => moveTo(addon.id, 0) },
      { label: "Move To Bottom", disabled: index === activeGroup.addonIds.length - 1, onSelect: () => moveTo(addon.id, activeGroup.addonIds.length) },
      ...links,
      "separator",
      { label: "Remove From Group", onSelect: () => remove(addon.id) },
    ];
  }

  function commitEditor() {
    if (!editor) return;
    const name = editor.value.trim();
    if (!name || groups.nameTaken(name, editor.mode === "rename" ? activeGroup.id : undefined)) return;
    if (editor.mode === "rename") groups.renameGroup(activeGroup.id, name);
    else groups.createGroup(name, editor.mode === "duplicate" ? [...activeGroup.addonIds] : []);
    setGroupSelection(null);
    setEditor(null);
  }

  function deleteGroup() {
    const name = activeGroup.name;
    const undo = groups.deleteActiveGroup();
    setGroupSelection(null);
    if (undo) toast(`Deleted ${name}`, { action: "Undo", onAction: undo });
  }

  const editorTaken = !!editor && !!editor.value.trim() && groups.nameTaken(editor.value, editor.mode === "rename" ? activeGroup.id : undefined);
  const contextAddon = context ? catalog.allAddons.find((addon) => addon.id === context.addonId) ?? groupAddons.find((addon) => addon.id === context.addonId) : undefined;

  function installedRow(addon: Addon) {
    const inGroup = activeGroup.addonIds.includes(addon.id);
    const draggable = !inGroup && addon.available;
    const lifted = drag?.payload.origin === "installed" && drag.payload.addonId === addon.id;
    return <div key={addon.id} className={`k-row as-addon as-dense ${lifted ? "as-lifted" : ""} ${draggable ? "as-draggable" : ""}`} role="option" tabIndex={0}
      aria-selected={installedSelection === addon.id}
      onPointerDown={draggable ? (event) => begin(event, { addonId: addon.id, origin: "installed" }) : undefined}
      onClick={() => setInstalledSelection(addon.id)}
      onFocus={(event) => { if (event.target === event.currentTarget) setInstalledSelection(addon.id); }}
      onDoubleClick={() => add(addon.id)}
      onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(addon.id); } }}
      onContextMenu={(event) => openContext(event, addon.id, "installed")}>
      {draggable ? <Grip /> : <span className="as-grip-space" />}
      <span className="label as-ellipsis as-grow" title={addon.name === addon.label ? addon.path ?? addon.name : `${addon.name}\n${addon.path ?? ""}`}>{addon.label}</span>
      {inGroup
        ? <span className="subtext k-muted as-inline as-nowrap"><Icon name="check" />In group</span>
        : <span className="subtext k-muted as-nowrap as-source">{sourceLabel(addon, repositories)}</span>}
    </div>;
  }

  return <div className="as-screen as-mods">
    <header className="as-screen-head">
      <div className="as-stack-tight as-grow"><h1 className="title-1 as-flat">Mods</h1><span className="subtext k-muted">Build the addon groups used when launching Arma 3</span></div>
      <button type="button" className="k-btn k-btn-quiet" onClick={onOpenSources}>Sources</button>
      <button type="button" className="k-btn k-btn-quiet" disabled={!catalog.dlcDetection.gameDirectory} onClick={() => catalog.dlcDetection.gameDirectory && void openPath(catalog.dlcDetection.gameDirectory)}>Open Addon Folder</button>
      <button type="button" className="k-btn k-btn-neutral" disabled={catalog.isRescanning} onClick={() => void catalog.rescanAll()}><Icon name="undo" />{catalog.isRescanning ? "Scanning…" : "Rescan"}</button>
    </header>

    {(catalog.dlcScanError || catalog.catalogError) && <Banner tone="danger" title={catalog.catalogError ? "Couldn't scan your addons" : "Couldn't check your DLC"}>{catalog.catalogError ?? catalog.dlcScanError}</Banner>}

    <div className="as-mods-grid">
      <section ref={installedCard} className={`k-card k-card-flush as-panel ${target?.zone === "installed" ? "as-drop-zone" : ""}`} aria-labelledby="installed-title">
        <div className="k-card-head as-panel-head">
          <div className="as-stack-hair as-grow"><h2 className="k-card-title" id="installed-title">Installed addons</h2><span className="subtext k-muted k-num">{catalog.installedMods.length} mods. {installedDlcCount} DLC ready</span></div>
        </div>
        <div className="as-panel-tools">
          <div className="k-search as-grow"><Icon name="search" /><input className="k-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter installed addons" aria-label="Filter installed addons" /></div>
          <MenuButton label="Filter by source" items={sourceFilters.map((option) => ({ label: option.label, checked: source === option.value, onSelect: () => setSource(option.value) }))}>
            {sourceFilters.find((option) => option.value === source)?.label}
          </MenuButton>
        </div>
        <div className="as-panel-list" role="listbox" aria-label="Installed addons" onKeyDown={arrowNavigation}>
          {filteredMods.map(installedRow)}
          {filteredDlcs.length > 0 && <p className="k-eyebrow as-list-eyebrow">DLC</p>}
          {filteredDlcs.map(installedRow)}
          {filtered.length === 0 && <div className="k-empty"><Icon name="search" /><p className="k-empty-title">Nothing matches</p><p className="k-empty-text">No installed addons match this filter.</p></div>}
        </div>
        <footer className="as-panel-foot"><span className="subtext k-muted">{target?.zone === "installed" ? "Drop to remove from the group" : "Drag addons into the group"}</span></footer>
      </section>

      <section ref={groupCard} className="k-card k-card-flush as-panel" aria-labelledby="group-title">
        <div className="k-card-head as-panel-head">
          <div className="as-stack-hair as-grow"><h2 className="k-card-title" id="group-title">Addon group</h2><span className="subtext k-muted">{activeGroup.source ? `Linked to the ${activeGroup.source.modsetName} modset. Top loads first.` : "Saved launch preset. Top loads first."}</span></div>
          <button type="button" className="k-btn k-btn-icon" aria-label="New group" title="New group" onClick={() => setEditor({ mode: "create", value: `New addon group ${groups.groups.length + 1}` })}><Icon name="plus" /></button>
          <MenuButton className="k-btn k-btn-icon" label="Rename, duplicate or delete" title="More" items={[
            { label: "Rename", onSelect: () => setEditor({ mode: "rename", value: activeGroup.name }) },
            { label: "Duplicate", onSelect: () => setEditor({ mode: "duplicate", value: `${activeGroup.name} copy` }) },
            { label: "Delete", disabled: groups.groups.length === 1, onSelect: deleteGroup },
          ]} />
        </div>
        <div className="as-panel-tools">
          <MenuButton fill label="Addon group" items={groups.groups.map((group) => ({ label: group.name, checked: group.id === activeGroup.id, onSelect: () => { groups.setActiveGroupId(group.id); setGroupSelection(null); } }))}>{activeGroup.name}</MenuButton>
          <span className="subtext k-muted k-num as-nowrap">{groupSummary(groupAddons)}</span>
        </div>
        <div ref={groupList} className="as-panel-list" role="listbox" aria-label={`Load order of ${activeGroup.name}`} onKeyDown={arrowNavigation}>
          {groupAddons.map((addon, index) => <div key={addon.id} className="as-drop-slot">
            {lineIndex === index && <div className="as-drop-line" aria-hidden="true" />}
            <div data-drop-index={index} className={`k-row as-addon as-dense as-draggable ${!addon.available ? "as-unavailable" : ""} ${drag?.payload.origin === "group" && drag.payload.addonId === addon.id ? "as-lifted" : ""}`}
              role="option" tabIndex={0} aria-selected={groupSelection === addon.id}
              onPointerDown={(event) => begin(event, { addonId: addon.id, origin: "group" })}
              onClick={(event) => { if (!fromControl(event)) setGroupSelection(addon.id); }}
              onFocus={(event) => { if (event.target === event.currentTarget) setGroupSelection(addon.id); }}
              onDoubleClick={(event) => { if (!fromControl(event)) remove(addon.id); }}
              onKeyDown={(event) => { if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); remove(addon.id); } }}
              onContextMenu={(event) => openContext(event, addon.id, "group")}>
              <Grip />
              <span className="label k-muted k-num as-order">{index + 1}</span>
              <span className="label as-ellipsis as-grow" title={addon.name === addon.label ? addon.path ?? addon.name : `${addon.name}\n${addon.path ?? ""}`}>{addon.label}</span>
              <span className="subtext k-muted as-nowrap as-source">{addon.available ? sourceLabel(addon, repositories) : addon.kind === "dlc" ? addon.version : "Not downloaded yet"}</span>
              <button type="button" className="k-btn k-btn-icon as-row-icon" aria-label={`Remove ${addon.label}`} title="Remove" onClick={(event) => { event.stopPropagation(); remove(addon.id); }}><Icon name="close" /></button>
            </div>
          </div>)}
          {lineIndex !== null && lineIndex >= groupAddons.length && groupAddons.length > 0 && <div className="as-drop-line as-drop-line-end" aria-hidden="true" />}
          {groupAddons.length === 0 && <div className={`k-empty ${target?.zone === "group" ? "as-drop-zone" : ""}`}><Icon name="empty" /><p className="k-empty-title">This group is empty</p><p className="k-empty-text">Drag addons here from the list on the left.</p></div>}
        </div>
        <footer className="as-panel-foot">
          <span className="subtext k-muted as-grow" title={groups.saveError ?? undefined}>{groups.saveError ? "Couldn't save addon groups. Your changes stay here." : groups.loaded ? "Saved automatically" : "Loading groups…"}</span>
          <span className="subtext k-muted">Drag to reorder. Delete to remove.</span>
        </footer>
      </section>
    </div>

    {drag && draggedAddon && <DragGhost state={drag} title={draggedAddon.label} sub={ghostSub} />}
    {context && contextAddon && <Menu anchor={pointAnchor(context.x, context.y)} label={`Actions for ${contextAddon.label}`} items={contextItems(contextAddon, context.origin)} onClose={() => setContext(null)} />}

    <Dialog open={!!editor} onClose={() => setEditor(null)} eyebrow="Addon group"
      title={editor?.mode === "create" ? "New group" : editor?.mode === "rename" ? "Rename group" : "Duplicate group"}
      actions={<>
        <button type="button" className="k-btn k-btn-quiet" onClick={() => setEditor(null)}>Cancel</button>
        <button type="button" className="k-btn k-btn-primary" disabled={!editor?.value.trim() || editorTaken} onClick={commitEditor}>{editor?.mode === "create" ? "Create Group" : editor?.mode === "rename" ? "Rename Group" : "Duplicate Group"}</button>
      </>}>
      <p className="body k-muted as-flat">{editor?.mode === "duplicate" ? "The copy keeps the load order, but it isn't linked to a repository modset." : "Pick a name you'll recognise at launch."}</p>
      <div className="k-field" data-invalid={editorTaken || undefined}>
        <label className="k-field-label" htmlFor="group-name">Group name</label>
        <input id="group-name" className="k-input" value={editor?.value ?? ""} maxLength={100} autoFocus
          onChange={(event) => editor && setEditor({ ...editor, value: event.target.value })}
          onKeyDown={(event) => { if (event.key === "Enter") commitEditor(); }} />
        {editorTaken && <span className="k-field-help">That name is already in use.</span>}
      </div>
    </Dialog>
  </div>;
}
