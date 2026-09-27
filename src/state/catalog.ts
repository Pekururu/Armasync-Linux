import type { AddonGroup, AddonSource, DetectedDlc, DiscoveredAddon, DlcDetection, DlcStatus, SavedRepository } from "../bindings";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useState } from "react";

export type Addon = {
  id: string;
  /** What the lists show: the @folder for mods, as Arma3Sync does, and the name for DLC. */
  label: string;
  name: string;
  folder: string;
  source: "DLC" | "Repository" | "Workshop" | "Local";
  kind: "dlc" | "mod";
  available: boolean;
  version?: string;
  steamAppId?: number;
  path?: string;
  workshopId?: number;
};

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
  disabled: "Turned off in Steam",
  files_only: "Files found",
  incomplete: "Incomplete install",
  unavailable: "Not installed",
};

function dlcAddon(dlc: DetectedDlc): Addon {
  return {
    id: `dlc:${dlc.handle}`,
    label: dlc.name,
    name: dlc.name,
    folder: `-mod=${dlc.handle}`,
    source: "DLC",
    kind: "dlc",
    available: dlc.status === "installed",
    version: dlcStatusLabels[dlc.status],
    steamAppId: dlc.appId,
  };
}

/** The @folder name. Workshop folders are numbers, so those use @ plus the mod's own name. */
export function modLabel(folder: string, name: string) {
  if (folder.startsWith("@")) return folder;
  return /^\d+$/.test(folder) ? `@${name}` : `@${folder}`;
}

function scannedAddon(addon: DiscoveredAddon): Addon {
  return {
    id: addon.id,
    label: modLabel(addon.folder, addon.name),
    name: addon.name,
    folder: addon.sourceKind === "workshop" && addon.workshopId ? `Workshop / ${addon.workshopId}` : addon.folder,
    source: addon.sourceKind === "workshop" ? "Workshop" : addon.isRepository ? "Repository" : "Local",
    kind: "mod",
    available: true,
    path: addon.path,
    workshopId: addon.workshopId ?? undefined,
  };
}

export function useCatalog() {
  const [dlcDetection, setDlcDetection] = useState<DlcDetection>({ gameDirectory: null, manifestPath: null, dlcs: fallbackDlcs });
  const [dlcDetected, setDlcDetected] = useState(false);
  const [dlcScanError, setDlcScanError] = useState<string | null>(null);
  const [sources, setSources] = useState<AddonSource[]>([]);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [sourceBusy, setSourceBusy] = useState(false);
  const [installedMods, setInstalledMods] = useState<Addon[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [isRescanning, setIsRescanning] = useState(false);

  async function scanDlc() {
    try {
      setDlcDetection(await invoke<DlcDetection>("detect_dlc"));
      setDlcScanError(null);
    } catch (error) {
      setDlcScanError(String(error));
    } finally {
      setDlcDetected(true);
    }
  }

  async function refreshSources() {
    setSourceBusy(true);
    try {
      setSources(await invoke<AddonSource[]>("list_addon_sources"));
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

  async function mutateSources(command: string, arguments_: Record<string, unknown>) {
    setSourceBusy(true);
    try {
      setSources(await invoke<AddonSource[]>(command, arguments_));
      setSourceError(null);
      await scanAddonCatalog();
    } catch (error) {
      setSourceError(String(error));
    } finally {
      setSourceBusy(false);
    }
  }

  async function addSource() {
    const selected = await openDialog({ directory: true, multiple: false, title: "Choose a folder with addons" });
    if (typeof selected !== "string") return;
    await mutateSources("add_addon_source", { path: selected });
  }

  async function reorderSources(ids: string[]) {
    setSources((current) => ids.flatMap((id) => current.filter((source) => source.id === id)));
    await mutateSources("reorder_addon_sources", { ids });
  }

  useEffect(() => { void rescanAll(); }, []);

  const dlcAddons = useMemo(() => dlcDetection.dlcs.map(dlcAddon), [dlcDetection]);
  const allAddons = useMemo(() => [...dlcAddons, ...installedMods], [dlcAddons, installedMods]);

  return {
    dlcDetection, dlcDetected, dlcScanError, dlcAddons,
    sources, sourceError, sourceBusy, refreshSources, mutateSources, addSource, reorderSources,
    installedMods, catalogError, scanAddonCatalog, isRescanning, rescanAll,
    allAddons,
  };
}

export type Catalog = ReturnType<typeof useCatalog>;

/** The repository whose download folder holds `path`, if any. */
export function repositoryFor(path: string | undefined, repositories: SavedRepository[]) {
  if (!path) return undefined;
  return repositories.find((repository) => path === repository.destination || path.startsWith(`${repository.destination.replace(/\/+$/, "")}/`));
}

/** The word under an addon's name: which repository, or which kind of source. */
export function sourceLabel(addon: Addon, repositories: SavedRepository[]) {
  if (addon.source === "Repository") return repositoryFor(addon.path, repositories)?.name ?? "Repository";
  return addon.source;
}

const initialGroups: AddonGroup[] = [{ id: "default", name: "Default", addonIds: [], source: null }];

export function useGroups(allAddons: Addon[]) {
  const [groups, setGroups] = useState(initialGroups);
  const [loaded, setLoaded] = useState(false);
  const [canSave, setCanSave] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [activeGroupId, setActiveGroupId] = useState(initialGroups[0].id);

  useEffect(() => {
    void invoke<AddonGroup[]>("list_addon_groups").then((saved) => {
      const next = saved.length ? saved : initialGroups;
      setGroups(next);
      setActiveGroupId((current) => next.some((group) => group.id === current) ? current : next[0].id);
      setLoaded(true);
      setCanSave(true);
      setSaveError(null);
    }).catch((cause) => {
      setSaveError(String(cause));
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!canSave) return;
    const timeout = window.setTimeout(() => {
      void invoke<AddonGroup[]>("save_addon_groups", { groups }).then(() => setSaveError(null)).catch((cause) => setSaveError(String(cause)));
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [groups, canSave]);

  const activeGroup = groups.find((group) => group.id === activeGroupId) ?? groups[0];
  const groupAddons = useMemo(() => activeGroup.addonIds.flatMap((id): Addon[] => {
    const addon = allAddons.find((candidate) => candidate.id === id);
    if (addon) return [addon];
    if (id.startsWith("path:")) {
      const path = id.slice(5);
      const folder = path.split("/").filter(Boolean).at(-1) ?? "Missing addon";
      return [{ id, label: modLabel(folder, folder), name: folder, folder, source: "Repository", kind: "mod", available: false, path }];
    }
    return [];
  }), [activeGroup, allAddons]);

  function updateActiveGroup(transform: (ids: string[]) => string[]) {
    setGroups((current) => current.map((group) => group.id === activeGroupId ? { ...group, addonIds: transform(group.addonIds) } : group));
  }

  function nameTaken(name: string, exceptId?: string) {
    const wanted = name.trim().toLocaleLowerCase();
    return groups.some((group) => group.name.toLocaleLowerCase() === wanted && group.id !== exceptId);
  }

  function createGroup(name: string, addonIds: string[] = []) {
    const next: AddonGroup = { id: crypto.randomUUID(), name: name.trim(), addonIds, source: null };
    setGroups((current) => [...current, next]);
    setActiveGroupId(next.id);
  }

  function renameGroup(id: string, name: string) {
    setGroups((current) => current.map((group) => group.id === id ? { ...group, name: name.trim() } : group));
  }

  /** Deletes the active group and returns a function that puts it back. */
  function deleteActiveGroup() {
    if (groups.length === 1) return null;
    const snapshot = groups;
    const activeIndex = groups.findIndex((group) => group.id === activeGroupId);
    const remaining = groups.filter((group) => group.id !== activeGroupId);
    const previousActive = activeGroupId;
    setGroups(remaining);
    setActiveGroupId(remaining[Math.max(0, activeIndex - 1)].id);
    return () => { setGroups(snapshot); setActiveGroupId(previousActive); };
  }

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
    while (groups.some((group) => group.name.toLocaleLowerCase() === name.toLocaleLowerCase())) name = `${modsetName} ${suffix++}`;
    const next: AddonGroup = { id: crypto.randomUUID(), name, addonIds, source: { repositoryId, modsetName } };
    setGroups((current) => [...current, next]);
    setActiveGroupId(next.id);
    return { action: "created", groupName: next.name, addonCount: addonIds.length };
  }

  return {
    groups, loaded, saveError, activeGroupId, setActiveGroupId, activeGroup, groupAddons,
    updateActiveGroup, nameTaken, createGroup, renameGroup, deleteActiveGroup, applyRepositoryModset,
  };
}

export type Groups = ReturnType<typeof useGroups>;

export function groupSummary(addons: Addon[]) {
  const mods = addons.filter((addon) => addon.kind === "mod").length;
  const dlc = addons.length - mods;
  return `${mods} mod${mods === 1 ? "" : "s"}${dlc ? `. ${dlc} DLC` : ""}`;
}
