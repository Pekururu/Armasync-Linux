import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

const resizeEdges = ["North", "South", "East", "West", "NorthWest", "NorthEast", "SouthWest", "SouthEast"] as const;
function ResizeGrips() {
  return <>{resizeEdges.map((edge) => (
    <div key={edge} className={`resize-grip resize-${edge.toLowerCase()}`} onPointerDown={(event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      void getCurrentWindow().startResizeDragging(edge);
    }} />
  ))}</>;
}
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { type DragEvent, type MouseEvent, type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import RepositoryView from "./RepositoryView";
import VoiceView from "./VoiceView";
import LauncherOptionsView, { type OptionsView } from "./LauncherOptionsView";
import TroubleshootingView from "./TroubleshootingView";
import appIconUrl from "../src-tauri/icons/icon.png";

type DlcStatus = "installed" | "disabled" | "files_only" | "incomplete" | "unavailable";

type DetectedDlc = {
  handle: string;
  name: string;
  appId: number;
  directory: string | null;
  creatorDlc: boolean;
  status: DlcStatus;
};

type DlcDetection = {
  gameDirectory: string | null;
  manifestPath: string | null;
  dlcs: DetectedDlc[];
};

type AddonSource = {
  id: string;
  name: string;
  path: string;
  kind: "game" | "workshop" | "custom";
  enabled: boolean;
  status: "ready" | "disabled" | "missing" | "unreadable";
  addonCount: number;
};

type DiscoveredAddon = {
  id: string;
  name: string;
  folder: string;
  path: string;
  sourceKind: AddonSource["kind"];
  sourceId: string;
  workshopId: number | null;
  isRepository: boolean;
};

type Addon = {
  id: string;
  name: string;
  folder: string;
  source: "DLC" | "Repository" | "Workshop" | "Local";
  kind: "dlc" | "mod";
  available: boolean;
  version?: string;
  size?: string;
  steamAppId?: number;
  path?: string;
  workshopId?: number;
};

type AddonGroup = {
  id: string;
  name: string;
  addonIds: string[];
  source?: { repositoryId: string; modsetName: string } | null;
};

type LaunchSelection = {
  activeAddonGroupId: string | null;
  selectedServerId: string | null;
  playerProfile: string | null;
};

type DragPayload = {
  addonId: string;
  origin: "installed" | "group";
};

type ContextMenuState = {
  addonId: string;
  origin: DragPayload["origin"];
  x: number;
  y: number;
};


const initialGroups: AddonGroup[] = [
  { id: "default", name: "Default", addonIds: [], source: null },
];

const tabs = ["Addons", "Repositories", "Voice", "Configuration", "Troubleshooting"];

const fallbackDlcs: DetectedDlc[] = [
  ["contact", "Arma 3 Contact", 1021790, false],
  ["gm", "Global Mobilization", 1042220, true],
  ["vn", "S.O.G. Prairie Fire", 1227700, true],
  ["csla", "CSLA Iron Curtain", 1294440, true],
  ["ws", "Western Sahara", 1681170, true],
  ["spe", "Spearhead 1944", 1175380, true],
  ["rf", "Reaction Forces", 2647760, true],
  ["ef", "Expeditionary Forces", 2647830, true],
].map(([handle, name, appId, creatorDlc]) => ({
  handle: String(handle),
  name: String(name),
  appId: Number(appId),
  creatorDlc: Boolean(creatorDlc),
  directory: null,
  status: "unavailable" as const,
}));

const dlcStatusLabels: Record<DlcStatus, string> = {
  installed: "Installed",
  disabled: "Disabled in Steam",
  files_only: "Files detected",
  incomplete: "Incomplete install",
  unavailable: "Not installed",
};

const sourceStatusLabels: Record<AddonSource["status"], string> = {
  ready: "Ready",
  disabled: "Disabled",
  missing: "Folder missing",
  unreadable: "Cannot read folder",
};

function dlcAddon(dlc: DetectedDlc): Addon {
  return {
    id: `dlc:${dlc.handle}`,
    name: dlc.name,
    folder: `-mod=${dlc.handle}`,
    source: "DLC",
    kind: "dlc",
    available: dlc.status === "installed",
    version: dlcStatusLabels[dlc.status],
    steamAppId: dlc.appId,
  };
}

function scannedAddon(addon: DiscoveredAddon): Addon {
  return {
    id: addon.id,
    name: addon.name,
    folder: addon.sourceKind === "workshop" && addon.workshopId
      ? `Workshop / ${addon.workshopId}`
      : addon.folder,
    source: addon.sourceKind === "workshop" ? "Workshop" : addon.isRepository ? "Repository" : "Local",
    kind: "mod",
    available: true,
    path: addon.path,
    workshopId: addon.workshopId ?? undefined,
  };
}

type IconName = "search" | "refresh" | "folder" | "folders" | "plus" | "trash" | "edit" | "copy" | "play" | "cloud" | "repository" | "computer" | "dlc" | "external" | "close" | "grip" | "voice";

function Icon({ name }: { name: IconName }) {
  const paths = {
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    refresh: <><path d="M20 12a8 8 0 1 1-2.34-5.66L20 8" /><path d="M20 3v5h-5" /></>,
    folder: <path d="M3 7.5h7l2-2h9v13H3z" />,
    folders: <><path d="M5 6h6l2 2h8v11H5z" /><path d="M3 16V5h7" /></>,
    plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
    trash: <><path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="m7 7 1 13h8l1-13" /></>,
    edit: <><path d="m4 20 4-1 11-11-3-3L5 16z"/><path d="m14 7 3 3"/></>,
    copy: <><rect x="8" y="8" width="11" height="11" rx="1"/><path d="M16 8V5H5v11h3"/></>,
    play: <path d="m8 5 11 7-11 7z" />,
    voice: <><path d="M4 10v4h4l5 4V6L8 10z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></>,
    cloud: <path d="M7 18h10.5a4.5 4.5 0 0 0 .34-8.99A6 6 0 0 0 6.4 8.2 4.9 4.9 0 0 0 7 18Z" />,
    repository: <><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v6c0 1.66 3.13 3 7 3s7-1.34 7-3V6" /><path d="M5 12v6c0 1.66 3.13 3 7 3s7-1.34 7-3v-6" /></>,
    computer: <><rect x="3" y="4" width="18" height="13" rx="1.5" /><path d="M8 21h8M12 17v4" /></>,
    dlc: <><path d="m12 3 8 6v7l-8 5-8-5V9z" /><path d="m4 9 8 5 8-5M12 14v7" /></>,
    external: <><path d="M14 5h5v5" /><path d="m19 5-8 8" /><path d="M18 13v6H5V6h6" /></>,
    close: <><path d="m6 6 12 12" /><path d="M18 6 6 18" /></>,
    grip: <><circle cx="9" cy="7" r=".8" fill="currentColor" stroke="none" /><circle cx="15" cy="7" r=".8" fill="currentColor" stroke="none" /><circle cx="9" cy="12" r=".8" fill="currentColor" stroke="none" /><circle cx="15" cy="12" r=".8" fill="currentColor" stroke="none" /><circle cx="9" cy="17" r=".8" fill="currentColor" stroke="none" /><circle cx="15" cy="17" r=".8" fill="currentColor" stroke="none" /></>,
  };
  return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function SourceIcon({ source, withLabel = false }: { source: Addon["source"]; withLabel?: boolean }) {
  const icon: Record<Addon["source"], IconName> = {
    DLC: "dlc",
    Repository: "repository",
    Workshop: "cloud",
    Local: "computer",
  };

  return (
    <span className={`source-type ${source.toLowerCase()}`} title={`${source} addon`} aria-label={`${source} addon`}>
      <Icon name={icon[source]} />
      {withLabel && <span>{source}</span>}
    </span>
  );
}

function AddonRow({
  addon,
  selected,
  order,
  onClick,
  onDoubleClick,
  dragging,
  dropBefore,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onFocus,
  onContextMenu,
  canDrag = true,
  onQuickAction,
  quickActionLabel,
}: {
  addon: Addon;
  selected: boolean;
  order?: number;
  onClick: () => void;
  onDoubleClick?: () => void;
  dragging?: boolean;
  dropBefore?: boolean;
  onDragStart?: (event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd?: () => void;
  onDragOver?: (event: DragEvent<HTMLButtonElement>) => void;
  onDrop?: (event: DragEvent<HTMLButtonElement>) => void;
  onFocus?: () => void;
  onContextMenu?: (event: MouseEvent<HTMLButtonElement>) => void;
  canDrag?: boolean;
  onQuickAction?: () => void;
  quickActionLabel?: string;
}) {
  return (
    <button
      className={`addon-row ${order !== undefined ? "ordered" : ""} ${selected ? "selected" : ""} ${dragging ? "dragging" : ""} ${dropBefore ? "drop-before" : ""} ${!addon.available ? "unavailable" : ""}`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      type="button"
      draggable={canDrag}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onFocus={onFocus}
      onContextMenu={onContextMenu}
    >
      <span className="row-leading">
        {order !== undefined && <span className="order-number">{order + 1}</span>}
        <SourceIcon source={addon.source} />
      </span>
      <span className="addon-identity">
        <span className="addon-name" title={addon.name}>{addon.name}</span>
        <span className="addon-folder" title={addon.folder}>{addon.folder}</span>
      </span>
      {onQuickAction && <span className="row-action" role="button" tabIndex={-1} title={quickActionLabel} aria-label={quickActionLabel} onClick={(event) => { event.stopPropagation(); onQuickAction(); }} onDoubleClick={(event) => event.stopPropagation()}><Icon name={order !== undefined ? "close" : "plus"} /></span>}
    </button>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState("Addons");
  const [groups, setGroups] = useState(initialGroups);
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  const [groupsCanSave, setGroupsCanSave] = useState(false);
  const [groupSaveError, setGroupSaveError] = useState<string | null>(null);
  const [groupEditor, setGroupEditor] = useState<{ mode: "create" | "rename" | "duplicate"; value: string } | null>(null);
  const [activeGroupId, setActiveGroupId] = useState(initialGroups[0].id);
  const [availableSelection, setAvailableSelection] = useState<string | null>(null);
  const [groupSelection, setGroupSelection] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("All sources");
  const [dragging, setDragging] = useState<DragPayload | null>(null);
  const [groupDropIndex, setGroupDropIndex] = useState<number | null>(null);
  const [installedDropActive, setInstalledDropActive] = useState(false);
  const [focusedPane, setFocusedPane] = useState<DragPayload["origin"] | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [dlcDetection, setDlcDetection] = useState<DlcDetection>({ gameDirectory: null, manifestPath: null, dlcs: fallbackDlcs });
  const [dlcScanError, setDlcScanError] = useState<string | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [addonSources, setAddonSources] = useState<AddonSource[]>([]);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [sourceBusy, setSourceBusy] = useState(false);
  const [draggedSourceId, setDraggedSourceId] = useState<string | null>(null);
  const [sourceDropIndex, setSourceDropIndex] = useState<number | null>(null);
  const [installedMods, setInstalledMods] = useState<Addon[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [isRescanning, setIsRescanning] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const [missingDeps, setMissingDeps] = useState<Array<{ id: string; label: string; purpose: string; hint: string }>>([]);
  const [depsDismissed, setDepsDismissed] = useState(false);
  useEffect(() => {
    void invoke<Array<{ id: string; label: string; purpose: string; installed: boolean; hint: string }>>("host_dependencies")
      .then((deps) => setMissingDeps(deps.filter((dep) => !dep.installed)))
      .catch(() => undefined);
  }, []);

  const [teamspeakInstalled, setTeamspeakInstalled] = useState(false);
  const [teamspeakRunning, setTeamspeakRunning] = useState(false);
  const [teamspeakBusy, setTeamspeakBusy] = useState(false);
  const [teamspeakError, setTeamspeakError] = useState<string | null>(null);

  useEffect(() => {
    const refreshInstalled = () => void invoke<{ teamspeakInstalled: boolean; teamspeakRunning: boolean }>("get_voice_status")
      .then((voice) => { setTeamspeakInstalled(voice.teamspeakInstalled); setTeamspeakRunning(voice.teamspeakRunning); })
      .catch(() => undefined);
    refreshInstalled();
    window.addEventListener("focus", refreshInstalled);
    const interval = window.setInterval(() => void invoke<boolean>("get_teamspeak_running")
      .then(setTeamspeakRunning).catch(() => undefined), 3000);
    return () => { window.removeEventListener("focus", refreshInstalled); window.clearInterval(interval); };
  }, []);

  async function startTeamSpeak() {
    setTeamspeakBusy(true); setTeamspeakError(null);
    try {
      await invoke("launch_teamspeak");
      window.setTimeout(() => void invoke<boolean>("get_teamspeak_running").then(setTeamspeakRunning).catch(() => undefined), 1800);
    } catch (cause) { setTeamspeakError(String(cause)); }
    finally { setTeamspeakBusy(false); }
  }
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [launchOptions, setLaunchOptions] = useState<OptionsView | null>(null);
  const [configurationDirty, setConfigurationDirty] = useState(false);
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [playerProfile, setPlayerProfile] = useState("");
  const [persistedSelection, setPersistedSelection] = useState<LaunchSelection | null>(null);
  const [selectionFetched, setSelectionFetched] = useState(false);
  const [selectionReady, setSelectionReady] = useState(false);
  const selectionHydrated = useRef(false);

  async function scanDlc() {
    try {
      const detection = await invoke<DlcDetection>("detect_dlc");
      setDlcDetection(detection);
      setDlcScanError(null);
    } catch (error) {
      setDlcScanError(String(error));
    }
  }

  async function refreshSources() {
    setSourceBusy(true);
    try {
      setAddonSources(await invoke<AddonSource[]>("list_addon_sources"));
      setSourceError(null);
    } catch (error) {
      setSourceError(String(error));
    } finally {
      setSourceBusy(false);
    }
  }

  async function scanAddonCatalog() {
    try {
      const discovered = await invoke<DiscoveredAddon[]>("scan_addon_catalog");
      setInstalledMods(discovered.map(scannedAddon));
      setCatalogError(null);
    } catch (error) {
      setCatalogError(String(error));
    }
  }

  async function rescanAll() {
    setIsRescanning(true);
    try {
      await Promise.all([scanDlc(), refreshSources(), scanAddonCatalog()]);
    } finally {
      setIsRescanning(false);
    }
  }

  async function addSource() {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: "Choose an addon search directory",
    });
    if (typeof selected !== "string") return;
    await mutateSources("add_addon_source", { path: selected });
  }

  async function mutateSources(command: string, arguments_: Record<string, unknown>) {
    setSourceBusy(true);
    try {
      setAddonSources(await invoke<AddonSource[]>(command, arguments_));
      setSourceError(null);
      await scanAddonCatalog();
    } catch (error) {
      setSourceError(String(error));
    } finally {
      setSourceBusy(false);
    }
  }

  async function reorderSources(requestedIndex: number) {
    if (!draggedSourceId) return;
    const existingIndex = addonSources.findIndex((source_) => source_.id === draggedSourceId);
    if (existingIndex < 0) return;
    const reordered = [...addonSources];
    const [moved] = reordered.splice(existingIndex, 1);
    const adjustedIndex = existingIndex < requestedIndex ? requestedIndex - 1 : requestedIndex;
    reordered.splice(Math.max(0, Math.min(adjustedIndex, reordered.length)), 0, moved);
    setAddonSources(reordered);
    setDraggedSourceId(null);
    setSourceDropIndex(null);
    await mutateSources("reorder_addon_sources", { ids: reordered.map((source_) => source_.id) });
  }

  useEffect(() => {
    void rescanAll();
  }, []);

  useEffect(() => {
    void invoke<AddonGroup[]>("list_addon_groups").then((saved) => {
      const next = saved.length ? saved : initialGroups;
      setGroups(next);
      setActiveGroupId((current) => next.some((group) => group.id === current) ? current : next[0].id);
      setGroupsLoaded(true);
      setGroupsCanSave(true);
      setGroupSaveError(null);
    }).catch((cause) => {
      setGroupSaveError(String(cause));
      setGroupsLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!groupsCanSave) return;
    const timeout = window.setTimeout(() => {
      void invoke<AddonGroup[]>("save_addon_groups", { groups }).then(() => setGroupSaveError(null)).catch((cause) => setGroupSaveError(String(cause)));
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [groups, groupsCanSave]);

  useEffect(() => {
    void invoke<LaunchSelection>("get_launch_selection")
      .then(setPersistedSelection)
      .catch(() => undefined)
      .finally(() => setSelectionFetched(true));
  }, []);

  useEffect(() => {
    if (selectionHydrated.current || !groupsLoaded || !launchOptions || !selectionFetched) return;
    selectionHydrated.current = true;
    const preferredGroupId = persistedSelection?.activeAddonGroupId;
    if (preferredGroupId && groups.some((group) => group.id === preferredGroupId)) setActiveGroupId(preferredGroupId);
    const preferredServerId = persistedSelection?.selectedServerId;
    setSelectedServerId(preferredServerId && launchOptions.settings.servers.some((server) => server.id === preferredServerId) ? preferredServerId : null);
    const preferredProfile = persistedSelection?.playerProfile ?? "";
    setPlayerProfile(preferredProfile && launchOptions.settings.playerProfiles.includes(preferredProfile) ? preferredProfile : "");
    setSelectionReady(true);
  }, [groupsLoaded, launchOptions, selectionFetched, persistedSelection, groups]);

  useEffect(() => {
    if (!selectionReady) return;
    const timeout = window.setTimeout(() => {
      void invoke("save_launch_selection", { selection: {
        activeAddonGroupId: activeGroupId,
        selectedServerId,
        playerProfile: playerProfile || null,
      } }).catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [activeGroupId, selectedServerId, playerProfile, selectionReady]);

  const dlcAddons = useMemo(() => dlcDetection.dlcs.map(dlcAddon), [dlcDetection]);
  const allAddons = useMemo(() => [...dlcAddons, ...installedMods], [dlcAddons, installedMods]);

  const activeGroup = groups.find((group) => group.id === activeGroupId) ?? groups[0];
  const groupAddons = activeGroup.addonIds.flatMap((id) => {
    const addon = allAddons.find((candidate) => candidate.id === id);
    if (addon) return [addon];
    if (id.startsWith("path:")) {
      const path = id.slice(5);
      const folder = path.split("/").filter(Boolean).at(-1) ?? "Missing addon";
      return [{ id, name: folder, folder, source: "Repository" as const, kind: "mod" as const, available: false, path }];
    }
    return [];
  });

  const filteredAddons = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return allAddons.filter((addon) => {
      const visibleInCatalog = addon.kind === "mod" || addon.available;
      const matchesQuery = !term || `${addon.name} ${addon.folder}`.toLocaleLowerCase().includes(term);
      const matchesSource = source === "All sources" || addon.source === source;
      return visibleInCatalog && matchesQuery && matchesSource;
    });
  }, [allAddons, query, source]);
  const filteredDlcs = filteredAddons.filter((addon) => addon.kind === "dlc");
  const filteredMods = filteredAddons.filter((addon) => addon.kind === "mod");
  const installedDlcCount = dlcAddons.filter((addon) => addon.available).length;
  const unavailableGroupAddons = groupAddons.filter((addon) => !addon.available);

  function updateActiveGroup(transform: (ids: string[]) => string[]) {
    setGroups((current) => current.map((group) => group.id === activeGroupId
      ? { ...group, addonIds: transform(group.addonIds) }
      : group));
  }

  function addSelected(id = availableSelection) {
    const addon = allAddons.find((candidate) => candidate.id === id);
    if (!id || !addon?.available || activeGroup.addonIds.includes(id)) return;
    updateActiveGroup((ids) => [...ids, id]);
    setGroupSelection(id);
  }

  function removeSelected(id = groupSelection) {
    if (!id) return;
    updateActiveGroup((ids) => ids.filter((addonId) => addonId !== id));
    setGroupSelection(null);
  }

  function moveAddonToBoundary(addonId: string, boundary: "top" | "bottom") {
    updateActiveGroup((ids) => {
      if (!ids.includes(addonId)) return ids;
      const remaining = ids.filter((id) => id !== addonId);
      return boundary === "top" ? [addonId, ...remaining] : [...remaining, addonId];
    });
    setGroupSelection(addonId);
    setContextMenu(null);
  }

  function openContextMenu(event: MouseEvent<HTMLButtonElement>, addonId: string, origin: DragPayload["origin"]) {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const requestedX = event.clientX || bounds.left + 28;
    const requestedY = event.clientY || bounds.top + 24;
    setFocusedPane(origin);
    if (origin === "installed") setAvailableSelection(addonId);
    else setGroupSelection(addonId);
    setContextMenu({
      addonId,
      origin,
      x: Math.max(8, Math.min(requestedX, window.innerWidth - 224)),
      y: Math.max(8, Math.min(requestedY, window.innerHeight - 250)),
    });
  }

  function handleKeyboard(event: KeyboardEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    if (target.matches("input, select, textarea") || target.isContentEditable) return;

    if (event.key === "Escape") {
      setContextMenu(null);
      setSourcesOpen(false);
      return;
    }

    if ((event.key === "Delete" || event.key === "Backspace") && focusedPane === "group" && groupSelection) {
      event.preventDefault();
      removeSelected(groupSelection);
      setContextMenu(null);
      return;
    }

    if (event.key === "Enter" && focusedPane === "installed" && availableSelection) {
      event.preventDefault();
      addSelected(availableSelection);
    }
  }

  function beginDrag(event: DragEvent<HTMLButtonElement>, addonId: string, origin: DragPayload["origin"]) {
    const addon = allAddons.find((candidate) => candidate.id === addonId);
    if (origin === "installed" && !addon?.available) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = origin === "installed" ? "copy" : "move";
    event.dataTransfer.setData("text/plain", addonId);
    setDragging({ addonId, origin });
    setInstalledDropActive(false);
  }

  function finishDrag() {
    setDragging(null);
    setGroupDropIndex(null);
    setInstalledDropActive(false);
  }

  function dropIntoGroup(event: DragEvent, requestedIndex: number) {
    event.preventDefault();
    event.stopPropagation();
    if (!dragging) return;

    updateActiveGroup((ids) => {
      const existingIndex = ids.indexOf(dragging.addonId);
      if (dragging.origin === "installed" && existingIndex >= 0) return ids;

      const withoutDragged = ids.filter((id) => id !== dragging.addonId);
      let insertionIndex = requestedIndex;
      if (existingIndex >= 0 && existingIndex < requestedIndex) insertionIndex -= 1;
      insertionIndex = Math.max(0, Math.min(insertionIndex, withoutDragged.length));
      withoutDragged.splice(insertionIndex, 0, dragging.addonId);
      return withoutDragged;
    });
    setGroupSelection(dragging.addonId);
    finishDrag();
  }

  function dropIntoInstalled(event: DragEvent) {
    event.preventDefault();
    if (dragging?.origin === "group") removeSelected(dragging.addonId);
    finishDrag();
  }

  function createGroup() {
    setGroupEditor({ mode: "create", value: `New addon group ${groups.length + 1}` });
  }

  function openRenameGroup() { setGroupEditor({ mode: "rename", value: activeGroup.name }); }
  function openDuplicateGroup() { setGroupEditor({ mode: "duplicate", value: `${activeGroup.name} copy` }); }
  function commitGroupEditor() {
    if (!groupEditor) return;
    const name = groupEditor.value.trim();
    if (!name || groups.some((group) => group.name.toLocaleLowerCase() === name.toLocaleLowerCase() && (groupEditor.mode !== "rename" || group.id !== activeGroup.id))) return;
    if (groupEditor.mode === "rename") {
      setGroups((current) => current.map((group) => group.id === activeGroup.id ? { ...group, name } : group));
    } else {
      const next: AddonGroup = { id: crypto.randomUUID(), name, addonIds: groupEditor.mode === "duplicate" ? [...activeGroup.addonIds] : [], source: null };
      setGroups((current) => [...current, next]);
      setActiveGroupId(next.id);
    }
    setGroupSelection(null); setGroupEditor(null);
  }

  function deleteActiveGroup() {
    if (groups.length === 1) return;
    const activeIndex = groups.findIndex((group) => group.id === activeGroupId);
    const remaining = groups.filter((group) => group.id !== activeGroupId);
    setGroups(remaining);
    setActiveGroupId(remaining[Math.max(0, activeIndex - 1)].id);
    setGroupSelection(null);
  }

  async function viewDlcInSteam(appId: number) {
    setContextMenu(null);
    await openUrl(`https://store.steampowered.com/app/${appId}`).catch(() => undefined);
  }

  async function viewWorkshopItem(workshopId: number) {
    setContextMenu(null);
    await openUrl(`https://steamcommunity.com/sharedfiles/filedetails/?id=${workshopId}`).catch(() => undefined);
  }

  async function launchGame() {
    setIsLaunching(true);
    setLaunchError(null);
    try {
      await invoke("launch_arma", { selectedServerId, playerProfile: playerProfile || null, addons: groupAddons.map((addon) => ({
        kind: addon.kind,
        value: addon.kind === "dlc" ? addon.id.replace("dlc:", "") : addon.path,
      })) });
    } catch (error) {
      setLaunchError(String(error));
    } finally {
      setIsLaunching(false);
    }
  }

  const receiveLaunchOptions = useCallback((next: OptionsView, dirty: boolean) => {
    setLaunchOptions(next);
    setConfigurationDirty(dirty);
    setSelectedServerId((current) => {
      if (!current || next.settings.servers.some((server) => server.id === current)) return current;
      return null;
    });
    setPlayerProfile((current) => !current || next.settings.playerProfiles.includes(current) ? current : "");
  }, []);


  async function applyRepositoryModset(repositoryId: string, destination: string, modsetName: string, addonNames: string[]) {
    const addonIds = addonNames.flatMap((name) => {
      const normalized = name.toLocaleLowerCase();
      const dlc = allAddons.find((addon) => addon.id === `dlc:${normalized}`);
      if (dlc) return [dlc.id];
      if (!name || name.includes("/") || name.includes("\\") || name === "." || name === "..") return [];
      const expectedId = `path:${destination.replace(/\/+$/, "")}/${name}`;
      const installed = allAddons.find((addon) => addon.id === expectedId);
      return [installed?.id ?? expectedId];
    }).filter((id, index, items) => items.indexOf(id) === index);
    const existing = groups.find((group) => group.source?.repositoryId === repositoryId && group.source.modsetName === modsetName);
    if (existing) {
      const members = new Set(addonIds);
      const ordered = [...existing.addonIds.filter((id) => members.has(id)), ...addonIds.filter((id) => !existing.addonIds.includes(id))];
      setGroups((current) => current.map((group) => group.id === existing.id ? { ...group, addonIds: ordered } : group));
      setActiveGroupId(existing.id);
      return { action: "updated", groupName: existing.name, addonCount: ordered.length };
    }
    let name = modsetName.trim() || "Repository modset";
    let suffix = 2;
    while (groups.some((group) => group.name.toLocaleLowerCase() === name.toLocaleLowerCase())) { name = `${modsetName} ${suffix++}`; }
    const next: AddonGroup = { id: crypto.randomUUID(), name, addonIds, source: { repositoryId, modsetName } };
    setGroups((current) => [...current, next]);
    setActiveGroupId(next.id);
    return { action: "created", groupName: next.name, addonCount: addonIds.length };
  }

  return (
    <main className="app-shell" onKeyDown={handleKeyboard} onPointerDown={() => setContextMenu(null)}>
      <ResizeGrips />
      <header className="titlebar" data-tauri-drag-region onDoubleClick={(event) => { if (!(event.target as HTMLElement).closest(".window-controls")) void getCurrentWindow().toggleMaximize(); }}>
        <div className="brand" data-tauri-drag-region>
          <img className="brand-mark" src={appIconUrl} alt="" draggable={false} data-tauri-drag-region />
          <span data-tauri-drag-region>
            <strong>Armasync</strong>
          </span>
        </div>
        <div className="titlebar-right">
          <div className="game-state" data-tauri-drag-region><span className={`status-dot ${dlcDetection.gameDirectory ? "" : "warning"}`} /> {dlcDetection.gameDirectory ? "Arma 3 detected" : "Locating Arma 3"}</div>
          <div className="window-controls">
            <button type="button" aria-label="Minimize window" title="Minimize" onClick={() => void getCurrentWindow().minimize()}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5h10"/></svg></button>
            <button type="button" aria-label="Maximize window" title="Maximize" onClick={() => void getCurrentWindow().toggleMaximize()}><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="3.5" width="9" height="9"/></svg></button>
            <button className="window-close" type="button" aria-label="Close window" title="Close" onClick={() => void getCurrentWindow().close()}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8"/></svg></button>
          </div>
        </div>
      </header>

      <nav className="tabs" aria-label="Main navigation" onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
        event.preventDefault();
        const index = tabs.indexOf(activeTab);
        const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
        setActiveTab(tabs[nextIndex]);
        (event.currentTarget.children[nextIndex] as HTMLButtonElement | undefined)?.focus();
      }}>
        {tabs.map((tab) => (
          <button key={tab} type="button" className={activeTab === tab ? "active" : ""} onClick={() => setActiveTab(tab)}>{tab}</button>
        ))}
      </nav>

      {activeTab === "Addons" && (
        <section className="workspace">
          <div className="workspace-heading">
            <div>
              <h1>Addons</h1>
              <p>Build and arrange the addon groups used when launching Arma 3.</p>
            </div>
            <div className="heading-actions">
              <button className="button quiet" type="button" onClick={() => { setSourcesOpen(true); void refreshSources(); }}><Icon name="folders" /> Sources</button>
              <button className="button quiet" type="button" disabled={!dlcDetection.gameDirectory} onClick={() => dlcDetection.gameDirectory && void openPath(dlcDetection.gameDirectory)}><Icon name="folder" /> Open addon folder</button>
              <button className="button quiet" type="button" disabled={isRescanning} onClick={() => void rescanAll()}><Icon name="refresh" /> {isRescanning ? "Scanning…" : "Rescan"}</button>
            </div>
          </div>

          {missingDeps.length > 0 && !depsDismissed && (
            <div className="system-setup-notice">
              <div><strong>System setup</strong><span>Some host tools Armasync relies on are missing — the related features stay disabled until they're installed.</span></div>
              <ul>
                {missingDeps.map((dep) => <li key={dep.id}><strong>{dep.label}</strong> — needed for {dep.purpose}. {dep.hint}</li>)}
              </ul>
              <button className="icon-button" type="button" aria-label="Dismiss system setup notice" title="Dismiss" onClick={() => setDepsDismissed(true)}><Icon name="close" /></button>
            </div>
          )}

          <div className="addon-layout">
            <section
              className={`panel available-panel ${installedDropActive ? "drop-target" : ""}`}
              onDragOver={(event) => {
                if (dragging?.origin !== "group") return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setInstalledDropActive(true);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setInstalledDropActive(false);
              }}
              onDrop={dropIntoInstalled}
            >
              <header className="panel-header">
                <div>
                  <h2>Installed addons</h2>
                  <span>{dragging?.origin === "group" ? "Drop here to remove from group" : `${installedMods.length} mods · ${installedDlcCount} DLC ready`}</span>
                </div>
              </header>
              <div className="filters">
                <label className="search-field">
                  <Icon name="search" />
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter installed addons" aria-label="Filter installed addons" />
                </label>
                <select value={source} onChange={(event) => setSource(event.target.value)} aria-label="Filter by source">
                  <option>All sources</option>
                  <option>DLC</option>
                  <option>Repository</option>
                  <option>Workshop</option>
                  <option>Local</option>
                </select>
              </div>
              <div className="column-labels"><span>Addon</span></div>
              <div className="addon-list">
                {filteredMods.length > 0 && <div className="list-section-label"><span>Mods</span><span>{filteredMods.length} shown</span></div>}
                {filteredMods.map((addon) => (
                  <AddonRow
                    key={addon.id}
                    addon={addon}
                    selected={availableSelection === addon.id}
                    dragging={dragging?.origin === "installed" && dragging.addonId === addon.id}
                    onClick={() => setAvailableSelection(addon.id)}
                    onDoubleClick={() => addSelected(addon.id)}
                    onFocus={() => { setFocusedPane("installed"); setAvailableSelection(addon.id); }}
                    onContextMenu={(event) => openContextMenu(event, addon.id, "installed")}
                    onDragStart={(event) => beginDrag(event, addon.id, "installed")}
                    onDragEnd={finishDrag}
                    onQuickAction={() => addSelected(addon.id)}
                    quickActionLabel="Add to group"
                  />
                ))}
                {filteredDlcs.length > 0 && <div className="list-section-label"><span>DLC &amp; Creator DLC</span><span>{installedDlcCount} ready</span></div>}
                {filteredDlcs.map((addon) => (
                  <AddonRow
                    key={addon.id}
                    addon={addon}
                    selected={availableSelection === addon.id}
                    dragging={dragging?.origin === "installed" && dragging.addonId === addon.id}
                    canDrag={addon.available}
                    onClick={() => setAvailableSelection(addon.id)}
                    onDoubleClick={() => addon.available && addSelected(addon.id)}
                    onFocus={() => { setFocusedPane("installed"); setAvailableSelection(addon.id); }}
                    onContextMenu={(event) => openContextMenu(event, addon.id, "installed")}
                    onDragStart={(event) => beginDrag(event, addon.id, "installed")}
                    onDragEnd={finishDrag}
                    onQuickAction={addon.available ? () => addSelected(addon.id) : undefined}
                    quickActionLabel="Add to group"
                  />
                ))}
                {filteredAddons.length === 0 && <div className="empty-state">No installed addons match this filter.</div>}
              </div>
              <footer className="panel-footer">
                <SourceIcon source="Repository" withLabel />
                <SourceIcon source="Workshop" withLabel />
                <SourceIcon source="Local" withLabel />
                <SourceIcon source="DLC" withLabel />
                {dlcScanError && <span className="scan-error" title={dlcScanError}>DLC scan unavailable</span>}
                {catalogError && <span className="scan-error" title={catalogError}>Addon scan unavailable</span>}
              </footer>
            </section>

            <section
              className={`panel groups-panel ${dragging ? "accepts-drop" : ""}`}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = dragging?.origin === "installed" ? "copy" : "move";
                setGroupDropIndex(activeGroup.addonIds.length);
              }}
              onDrop={(event) => dropIntoGroup(event, activeGroup.addonIds.length)}
            >
              <header className="panel-header group-header">
                <div>
                  <h2>Addon group</h2>
                  <span>Saved launch preset · Drag to arrange</span>
                </div>
                <div className="group-actions">
                  <button type="button" title="Create addon group" onClick={createGroup}><Icon name="plus" /></button>
                  <button type="button" title="Rename addon group" onClick={openRenameGroup}><Icon name="edit" /></button>
                  <button type="button" title="Duplicate addon group" onClick={openDuplicateGroup}><Icon name="copy" /></button>
                  <button type="button" title="Delete addon group" disabled={groups.length === 1} onClick={deleteActiveGroup}><Icon name="trash" /></button>
                </div>
              </header>
              <div className="group-select-wrap">
                <select value={activeGroupId} onChange={(event) => { setActiveGroupId(event.target.value); setGroupSelection(null); }} aria-label="Current addon group">
                  {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                </select>
                <span title={activeGroup.source ? `Linked to ${activeGroup.source.modsetName}` : undefined}>{groupAddons.filter((addon) => addon.kind === "mod").length} mods · {groupAddons.filter((addon) => addon.kind === "dlc").length} DLC{activeGroup.source ? " · Linked modset" : ""}</span>
              </div>
              <div className="column-labels"><span>Load order</span></div>
              <div className="addon-list group-list">
                {groupAddons.map((addon, index) => (
                  <AddonRow
                    key={addon.id}
                    addon={addon}
                    order={index}
                    selected={groupSelection === addon.id}
                    dragging={dragging?.origin === "group" && dragging.addonId === addon.id}
                    dropBefore={groupDropIndex === index && dragging?.addonId !== addon.id}
                    onClick={() => setGroupSelection(addon.id)}
                    onDoubleClick={() => removeSelected(addon.id)}
                    onFocus={() => { setFocusedPane("group"); setGroupSelection(addon.id); }}
                    onContextMenu={(event) => openContextMenu(event, addon.id, "group")}
                    onDragStart={(event) => beginDrag(event, addon.id, "group")}
                    onDragEnd={finishDrag}
                    onQuickAction={() => removeSelected(addon.id)}
                    quickActionLabel="Remove from group"
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      event.dataTransfer.dropEffect = dragging?.origin === "installed" ? "copy" : "move";
                      setGroupDropIndex(index);
                    }}
                    onDrop={(event) => dropIntoGroup(event, index)}
                  />
                ))}
                {groupDropIndex === groupAddons.length && groupAddons.length > 0 && dragging && <div className="drop-at-end" />}
                {groupAddons.length === 0 && (
                  <div className="empty-state group-empty"><strong>This group is empty</strong><span>Select an installed addon and add it here.</span></div>
                )}
              </div>
              <footer className="panel-footer order-footer">
                <span className={groupSaveError ? "scan-error" : ""} title={groupSaveError ?? undefined}>{groupSaveError ? "Could not save addon groups" : groupsLoaded ? "Saved automatically" : "Loading groups…"}</span>
                <span>Drag to reorder · Delete to remove</span>
              </footer>
            </section>
          </div>
        </section>
      )}
      <RepositoryView active={activeTab === "Repositories"} defaultDestination={dlcDetection.gameDirectory} addonGroups={groups.map((group) => ({ id: group.id, name: group.name, source: group.source }))} onApplyModset={applyRepositoryModset} onSynchronized={async () => { await scanAddonCatalog(); }} />
      <VoiceView active={activeTab === "Voice"} />
      <LauncherOptionsView active={activeTab === "Configuration"} onOptionsChanged={receiveLaunchOptions} />
      <TroubleshootingView active={activeTab === "Troubleshooting"} />

      <footer className="launchbar">
        <div className="launch-choices">
          <label className="launch-choice">
            <span>Addons</span>
            <select value={activeGroupId} aria-label="Addon group used at launch" onChange={(event) => { setActiveGroupId(event.target.value); setGroupSelection(null); }}>
              {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select>
          </label>
          <label className="launch-choice">
            <span>Server</span>
            <select value={selectedServerId ?? ""} aria-label="Server used at launch" onChange={(event) => setSelectedServerId(event.target.value || null)}>
              <option value="">No server</option>
              {launchOptions?.settings.servers.map((server) => <option key={server.id} value={server.id}>{server.name}</option>)}
            </select>
          </label>
          <label className="launch-choice">
            <span>Profile</span>
            <select value={playerProfile} aria-label="Player profile used at launch" onChange={(event) => setPlayerProfile(event.target.value)}>
              <option value="">Automatic</option>
              {launchOptions?.settings.playerProfiles.map((profile) => <option key={profile} value={profile}>{profile}</option>)}
            </select>
          </label>
        </div>
        <div className="launch-summary">
          <span title={launchError ?? undefined}>{launchError ? "Launch failed — see Troubleshooting" : `${groupAddons.length} addons`}</span>
          <span className="separator" />
          <span>{launchOptions?.environment.selectedProton ?? "Proton"}</span>
          {teamspeakInstalled && <button className={`ts-button ${teamspeakRunning ? "running" : ""}`} type="button" disabled={teamspeakBusy || teamspeakRunning} title={teamspeakError ?? (teamspeakRunning ? "TeamSpeak is running" : "Start TeamSpeak for ACRE voice")} onClick={() => void startTeamSpeak()}><Icon name="voice" /> {teamspeakRunning ? "Voice on" : teamspeakBusy ? "Starting…" : "TeamSpeak"}</button>}
          <button className="launch-button" type="button" disabled={configurationDirty || unavailableGroupAddons.length > 0 || isLaunching} title={configurationDirty ? "Save Configuration changes before launching" : unavailableGroupAddons.length ? "This group contains unavailable DLC" : launchError ?? "Launch game"} onClick={() => void launchGame()}><Icon name="play" /> {configurationDirty ? "Save configuration" : unavailableGroupAddons.length ? "DLC required" : isLaunching ? "Starting…" : "Launch game"}</button>
        </div>
      </footer>

      {groupEditor && <>
        <button className="drawer-scrim" type="button" aria-label="Cancel addon group editing" onClick={() => setGroupEditor(null)}/>
        <aside className="group-editor-dialog" onPointerDown={(event) => event.stopPropagation()}>
          <span className="eyebrow">Addon group</span>
          <h2>{groupEditor.mode === "create" ? "Create group" : groupEditor.mode === "rename" ? "Rename group" : "Duplicate group"}</h2>
          <p>{groupEditor.mode === "duplicate" ? "The copied group keeps the current addon order but is no longer linked to a repository modset." : "Choose a clear name for this launch preset."}</p>
          <label><span>Group name</span><input value={groupEditor.value} onChange={(event) => setGroupEditor({ ...groupEditor, value: event.target.value })} onKeyDown={(event) => { if (event.key === "Enter") commitGroupEditor(); }} autoFocus maxLength={100}/></label>
          {groups.some((group) => group.name.toLocaleLowerCase() === groupEditor.value.trim().toLocaleLowerCase() && (groupEditor.mode !== "rename" || group.id !== activeGroup.id)) && <small className="group-name-error">That group name is already in use.</small>}
          <footer><button type="button" onClick={() => setGroupEditor(null)}>Cancel</button><button className="button primary-small" type="button" disabled={!groupEditor.value.trim() || groups.some((group) => group.name.toLocaleLowerCase() === groupEditor.value.trim().toLocaleLowerCase() && (groupEditor.mode !== "rename" || group.id !== activeGroup.id))} onClick={commitGroupEditor}>{groupEditor.mode === "create" ? "Create" : groupEditor.mode === "rename" ? "Rename" : "Duplicate"}</button></footer>
        </aside>
      </>}

      {sourcesOpen && <>
        <button className="drawer-scrim" type="button" aria-label="Close addon sources" onClick={() => setSourcesOpen(false)} />
        <aside className="sources-drawer" aria-label="Addon search directories">
          <header className="drawer-header">
            <div>
              <span className="eyebrow">Addon search directories</span>
              <h2>Sources</h2>
              <p>Folders are scanned in priority order from top to bottom.</p>
            </div>
            <button className="icon-button" type="button" aria-label="Close" onClick={() => setSourcesOpen(false)}><Icon name="close" /></button>
          </header>

          <div className="source-summary">
            <span><strong>{addonSources.filter((source_) => source_.enabled).length}</strong> active sources</span>
            <span><strong>{addonSources.reduce((total, source_) => total + source_.addonCount, 0)}</strong> addon roots found</span>
          </div>

          <div className="source-list" onDragOver={(event) => { event.preventDefault(); setSourceDropIndex(addonSources.length); }} onDrop={(event) => { event.preventDefault(); void reorderSources(addonSources.length); }}>
            {addonSources.map((source_, index) => (
              <div
                className={`source-card ${source_.enabled ? "" : "disabled"} ${source_.status !== "ready" && source_.status !== "disabled" ? "problem" : ""} ${draggedSourceId === source_.id ? "dragging" : ""} ${sourceDropIndex === index && draggedSourceId !== source_.id ? "drop-before" : ""}`}
                key={source_.id}
                draggable
                onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; setDraggedSourceId(source_.id); }}
                onDragEnd={() => { setDraggedSourceId(null); setSourceDropIndex(null); }}
                onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); setSourceDropIndex(index); }}
                onDrop={(event) => { event.preventDefault(); event.stopPropagation(); void reorderSources(index); }}
              >
                <span className="source-grip" title="Drag to change priority"><Icon name="grip" /></span>
                <span className={`source-kind-icon ${source_.kind}`}>
                  <Icon name={source_.kind === "workshop" ? "cloud" : source_.kind === "game" ? "computer" : "folder"} />
                </span>
                <div className="source-details">
                  <div className="source-title">
                    <strong>{source_.name}</strong>
                  </div>
                  <code title={source_.path}>{source_.path}</code>
                  <div className="source-card-meta">
                    <span className={`source-health ${source_.status}`} />
                    <span>{sourceStatusLabels[source_.status]}</span>
                    <i />
                    <span>{source_.addonCount} addon{source_.addonCount === 1 ? "" : "s"}</span>
                  </div>
                </div>
                <div className="source-actions">
                  <label className="source-toggle" title={source_.enabled ? "Disable source" : "Enable source"}>
                    <input type="checkbox" checked={source_.enabled} disabled={sourceBusy} onChange={() => void mutateSources("set_addon_source_enabled", { id: source_.id, enabled: !source_.enabled })} />
                    <span />
                  </label>
                  <button type="button" title="Open folder" onClick={() => void openPath(source_.path)}><Icon name="folder" /></button>
                  <button className="remove-source" type="button" title="Remove search directory (files are kept)" disabled={sourceBusy} onClick={() => void mutateSources("remove_addon_source", { id: source_.id })}><Icon name="trash" /></button>
                </div>
              </div>
            ))}
            {sourceDropIndex === addonSources.length && draggedSourceId && <div className="source-drop-end" />}
            {!addonSources.length && !sourceBusy && <div className="sources-empty">No addon directories have been configured.</div>}
          </div>

          {sourceError && <div className="source-error" role="alert">{sourceError}</div>}

          <footer className="drawer-footer">
            <div>
              <strong>Controlled scanning</strong>
              <span>Only direct addon roots are inspected. Subdirectory trees are not crawled recursively.</span>
            </div>
            <div className="drawer-footer-actions">
              {!addonSources.some((source_) => source_.kind === "workshop") && <button className="button quiet" type="button" disabled={sourceBusy} onClick={() => void mutateSources("add_steam_workshop_source", {})}><Icon name="cloud" /> Add Workshop</button>}
              <button className="button quiet" type="button" disabled={sourceBusy || isRescanning} onClick={() => void rescanAll()}><Icon name="refresh" /> {isRescanning ? "Scanning…" : "Rescan"}</button>
              <button className="button primary-small" type="button" disabled={sourceBusy} onClick={() => void addSource()}><Icon name="plus" /> Add directory</button>
            </div>
          </footer>
        </aside>
      </>}

      {contextMenu && (() => {
        const addon = allAddons.find((candidate) => candidate.id === contextMenu.addonId);
        if (!addon) return null;
        const alreadyAdded = activeGroup.addonIds.includes(addon.id);
        const groupIndex = activeGroup.addonIds.indexOf(addon.id);
        return (
          <div
            className="context-menu"
            role="menu"
            aria-label={`Actions for ${addon.name}`}
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="context-heading">
              <SourceIcon source={addon.source} />
              <span><strong>{addon.name}</strong><small>{addon.folder}</small></span>
            </div>
            {contextMenu.origin === "installed" ? (
              <>
                <button
                  type="button"
                  role="menuitem"
                  disabled={alreadyAdded || !addon.available}
                  onClick={() => { addSelected(addon.id); setContextMenu(null); }}
                >
                  <span>{alreadyAdded ? "Already in this group" : !addon.available ? (addon.version ?? "Unavailable") : `Add to ${activeGroup.name}`}</span>
                  {!alreadyAdded && addon.available && <kbd>Enter</kbd>}
                </button>
                {addon.path && <button type="button" role="menuitem" onClick={() => { setContextMenu(null); void openPath(addon.path!); }}>
                  <span>Open addon folder</span><Icon name="folder" />
                </button>}
                {addon.workshopId && <button type="button" role="menuitem" onClick={() => void viewWorkshopItem(addon.workshopId!)}>
                  <span>View Workshop page</span><Icon name="external" />
                </button>}
                {addon.steamAppId && <>
                  <div className="context-separator" />
                  <button type="button" role="menuitem" onClick={() => void viewDlcInSteam(addon.steamAppId!)}>
                    <span>View DLC on Steam</span><Icon name="external" />
                  </button>
                </>}
              </>
            ) : (
              <>
                <button type="button" role="menuitem" disabled={groupIndex === 0} onClick={() => moveAddonToBoundary(addon.id, "top")}>
                  <span>Move to top</span>
                </button>
                <button type="button" role="menuitem" disabled={groupIndex === activeGroup.addonIds.length - 1} onClick={() => moveAddonToBoundary(addon.id, "bottom")}>
                  <span>Move to bottom</span>
                </button>
                {addon.steamAppId && <button type="button" role="menuitem" onClick={() => void viewDlcInSteam(addon.steamAppId!)}>
                  <span>View DLC on Steam</span><Icon name="external" />
                </button>}
                {addon.path && <button type="button" role="menuitem" onClick={() => { setContextMenu(null); void openPath(addon.path!); }}>
                  <span>Open addon folder</span><Icon name="folder" />
                </button>}
                {addon.workshopId && <button type="button" role="menuitem" onClick={() => void viewWorkshopItem(addon.workshopId!)}>
                  <span>View Workshop page</span><Icon name="external" />
                </button>}
                <div className="context-separator" />
                <button className="context-remove" type="button" role="menuitem" onClick={() => { removeSelected(addon.id); setContextMenu(null); }}>
                  <span>Remove from group</span><kbd>Delete</kbd>
                </button>
              </>
            )}
          </div>
        );
      })()}
    </main>
  );
}
