import type { CheckProgress, RepositorySnapshot, SavedRepository, SyncPlan, SyncProgress, SyncResult } from "../bindings";
import type { StatusKey } from "../ui";
import { Channel, invoke } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useRef, useState } from "react";
import { bytes, clock } from "../format";

export type AddonState = "ok" | "changed" | "missing" | "unresolved";
export type AddonCheck = { state: AddonState; missing: number; changed: number; transferBytes: number };

export type RepositoryState = {
  snapshot: RepositorySnapshot | null;
  connectError: string | null;
  selected: Set<string>;
  modset: string;
  // Checked results are kept per addon, so changing the selection never throws
  // away work that is still valid.
  checked: Map<string, AddonCheck>;
  checkedAt: number | null;
  error: string | null;
  message: string | null;
  result: SyncResult | null;
};

export type Job =
  | { kind: "import" | "destination"; repositoryId: string | null }
  | { kind: "connect"; repositoryId: string }
  | { kind: "check"; repositoryId: string; jobId: string; progress: CheckProgress; stopping: boolean }
  | { kind: "sync"; repositoryId: string; jobId: string; progress: SyncProgress; paused: boolean; stopping: boolean };

const blank = (): RepositoryState => ({ snapshot: null, connectError: null, selected: new Set(), modset: "", checked: new Map(), checkedAt: null, error: null, message: null, result: null });

export type Summary = {
  verifiedFiles: number; downloadFiles: number; replacementFiles: number; downloadBytes: number;
  transferFiles: number; unresolved: string[]; changedAddons: number; pending: string[]; checkedAny: boolean;
};

/** Everything the screens and the Sync gate need, counted over addons that are both selected and checked. */
export function summarize(state: RepositoryState): Summary {
  let verifiedFiles = 0, downloadFiles = 0, replacementFiles = 0, downloadBytes = 0, changedAddons = 0;
  const unresolved: string[] = [];
  for (const addon of state.snapshot?.addons ?? []) {
    if (!state.selected.has(addon.name)) continue;
    const check = state.checked.get(addon.name);
    if (!check) continue;
    if (check.state === "unresolved") { unresolved.push(addon.name); continue; }
    downloadFiles += check.missing;
    replacementFiles += check.changed;
    downloadBytes += check.transferBytes;
    if (check.missing || check.changed) changedAddons += 1;
    verifiedFiles += Math.max(0, addon.files - check.missing - check.changed);
  }
  const pending = [...state.selected].filter((name) => !state.checked.has(name));
  const checkedAny = [...state.selected].some((name) => state.checked.has(name));
  // Missing and changed files are both transfers; "is there work to do?" counts both.
  return { verifiedFiles, downloadFiles, replacementFiles, downloadBytes, transferFiles: downloadFiles + replacementFiles, unresolved, changedAddons, pending, checkedAny };
}

export function useRepositories({ defaultDestination, onSynchronized }: { defaultDestination: string | null; onSynchronized: () => Promise<void> }) {
  const [repositories, setRepositories] = useState<SavedRepository[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [states, setStates] = useState<Record<string, RepositoryState>>({});
  const [job, setJob] = useState<Job | null>(null);
  const stopRequested = useRef(false);
  const statesRef = useRef(states);
  statesRef.current = states;

  useEffect(() => { void load(); }, []);

  async function load() {
    try { setRepositories(await invoke<SavedRepository[]>("list_repositories")); setLoadError(null); }
    catch (cause) { setLoadError(String(cause)); }
  }

  function patch(id: string, change: Partial<RepositoryState> | ((state: RepositoryState) => Partial<RepositoryState>)) {
    setStates((current) => {
      const previous = current[id] ?? blank();
      return { ...current, [id]: { ...previous, ...(typeof change === "function" ? change(previous) : change) } };
    });
  }

  function stateOf(id: string) { return states[id] ?? blank(); }

  /** Fetches the manifest and published modsets. Nothing is downloaded. */
  async function connect(id: string, keepSelection = false) {
    if (job) return null;
    setJob({ kind: "connect", repositoryId: id });
    patch(id, { connectError: null, error: null, result: null, message: null });
    try {
      const snapshot = await invoke<RepositorySnapshot>("connect_repository", { id });
      const names = snapshot.addons.map((item) => item.name);
      patch(id, (state) => {
        const kept = keepSelection && state.snapshot ? names.filter((name) => state.selected.has(name)) : names;
        return { snapshot, selected: new Set(kept), modset: keepSelection ? state.modset : "", checked: new Map(), checkedAt: null };
      });
      return snapshot;
    } catch (cause) {
      patch(id, { snapshot: null, connectError: String(cause) });
      return null;
    } finally {
      setJob(null);
    }
  }

  function setSelection(id: string, selected: Set<string>, modset = "") {
    patch(id, { selected, modset, message: null });
  }

  function chooseModset(id: string, name: string) {
    const snapshot = stateOf(id).snapshot;
    if (!snapshot) return;
    if (!name) { setSelection(id, new Set(snapshot.addons.map((item) => item.name))); return; }
    const modset = snapshot.publishedModsets.find((item) => item.name === name);
    setSelection(id, new Set(modset?.addons ?? []), name);
  }

  async function checkFiles(id: string, options: { scope?: string[]; fullVerification?: boolean } = {}) {
    const state = statesRef.current[id] ?? blank();
    const summary = summarize(state);
    const targets = options.scope ?? (summary.pending.length > 0 ? summary.pending : [...state.selected]);
    if (targets.length === 0) return false;
    stopRequested.current = false;
    const jobId = crypto.randomUUID();
    const progress = new Channel<CheckProgress>();
    progress.onmessage = (update) => setJob((current) => current?.kind === "check" && current.jobId === jobId ? { ...current, progress: update } : current);
    setJob({ kind: "check", repositoryId: id, jobId, stopping: false, progress: { phase: "metadata", addon: null, checkedFiles: 0, totalFiles: 0, checkedBytes: 0, totalBytes: 0 } });
    patch(id, { error: null, result: null, message: null });
    try {
      const plan = await invoke<SyncPlan>("check_repository_files", { id, selectedAddons: targets, fullVerification: !!options.fullVerification, jobId, onProgress: progress });
      patch(id, (current) => {
        const next = new Map(current.checked);
        // Everything asked for starts clean, then the plan's operations fill in
        // what is actually wrong with each one.
        for (const name of plan.resolvedAddons) next.set(name, { state: "ok", missing: 0, changed: 0, transferBytes: 0 });
        for (const name of [...plan.missingAddons, ...plan.ambiguousAddons]) next.set(name, { state: "unresolved", missing: 0, changed: 0, transferBytes: 0 });
        for (const operation of plan.operations) {
          const row = next.get(operation.addon) ?? { state: "ok" as AddonState, missing: 0, changed: 0, transferBytes: 0 };
          if (operation.action === "download") row.missing += 1; else row.changed += 1;
          row.transferBytes += operation.transferBytes;
          if (row.state !== "unresolved") row.state = row.missing > 0 ? "missing" : "changed";
          next.set(operation.addon, row);
        }
        return { checked: next, checkedAt: Date.now() };
      });
      return true;
    } catch (cause) {
      if (stopRequested.current) patch(id, { message: "Check stopped." });
      else patch(id, { error: String(cause) });
      return false;
    } finally {
      setJob(null);
    }
  }

  /** Connects when needed, then checks every selected addon. */
  async function checkForUpdates(id: string, fresh = false) {
    if (fresh || !statesRef.current[id]?.snapshot) {
      const snapshot = await connect(id, !!statesRef.current[id]?.snapshot);
      if (!snapshot) return false;
      // The patch from connect lands on the next render; wait for it.
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
    const state = statesRef.current[id];
    return checkFiles(id, { scope: [...(state?.selected ?? [])] });
  }

  async function synchronize(id: string) {
    const state = statesRef.current[id] ?? blank();
    const summary = summarize(state);
    if (summary.transferFiles === 0) return true;
    const jobId = crypto.randomUUID();
    const progress = new Channel<SyncProgress>();
    progress.onmessage = (update) => setJob((current) => {
      if (current?.kind !== "sync" || current.jobId !== jobId) return current;
      return { ...current, progress: update.phase !== "preparing" ? update : { ...update, totalBytes: current.progress.totalBytes, totalFiles: current.progress.totalFiles } };
    });
    stopRequested.current = false;
    setJob({ kind: "sync", repositoryId: id, jobId, paused: false, stopping: false, progress: { phase: "preparing", downloadedBytes: 0, totalBytes: summary.downloadBytes, completedFiles: 0, totalFiles: summary.transferFiles, currentFile: null } });
    patch(id, { error: null, result: null, message: null });
    try {
      const result = await invoke<SyncResult>("synchronize_repository", { id, selectedAddons: [...state.selected], jobId, onProgress: progress });
      patch(id, (current) => {
        const next = new Map(current.checked);
        for (const name of current.selected) if (next.get(name)?.state !== "unresolved") next.set(name, { state: "ok", missing: 0, changed: 0, transferBytes: 0 });
        return { result, checked: next, checkedAt: Date.now() };
      });
      setJob(null);
      await onSynchronized();
      return true;
    } catch (cause) {
      const message = String(cause);
      if (stopRequested.current || message.toLocaleLowerCase().includes("synchronization stopped")) patch(id, { message: "Sync stopped. Finished downloads are kept. Sync again to continue." });
      else patch(id, { error: message });
      setJob(null);
      return false;
    }
  }

  async function togglePause() {
    if (job?.kind !== "sync" || job.stopping) return;
    try {
      await invoke(job.paused ? "resume_repository_sync" : "pause_repository_sync", { jobId: job.jobId });
      setJob((current) => current?.kind === "sync" ? { ...current, paused: !current.paused } : current);
    } catch (cause) { patch(job.repositoryId, { error: String(cause) }); }
  }

  async function stop() {
    if ((job?.kind !== "sync" && job?.kind !== "check") || job.stopping) return;
    stopRequested.current = true;
    setJob((current) => current && (current.kind === "sync" || current.kind === "check") ? { ...current, stopping: true } : current);
    try { await invoke("stop_repository_sync", { jobId: job.jobId }); }
    catch (cause) {
      stopRequested.current = false;
      setJob((current) => current && (current.kind === "sync" || current.kind === "check") ? { ...current, stopping: false } : current);
      patch(job.repositoryId, { error: String(cause) });
    }
  }

  async function inspect(url: string) {
    return invoke<RepositorySnapshot>("inspect_repository", { autoconfigUrl: url });
  }

  /** Saves the repository and returns its id. Throws with the reason when it can't. */
  async function importRepository(url: string, destination: string) {
    setJob({ kind: "import", repositoryId: null });
    try {
      const items = await invoke<SavedRepository[]>("import_repository", { autoconfigUrl: url, destination });
      setRepositories(items);
      const added = items.find((item) => item.autoconfigUrl === url) ?? items.at(-1);
      return added?.id ?? null;
    } finally {
      setJob(null);
    }
  }

  async function updateDestination(id: string, destination: string) {
    setJob({ kind: "destination", repositoryId: id });
    try {
      setRepositories(await invoke<SavedRepository[]>("update_repository_destination", { id, destination }));
      patch(id, { checked: new Map(), checkedAt: null, result: null });
    } finally {
      setJob(null);
    }
  }

  async function remove(id: string) {
    const repository = repositories.find((item) => item.id === id);
    if (!repository) return false;
    const approved = await confirm(`Remove “${repository.name}” from Armasync? Downloaded addon files stay on disk.`, { title: "Remove repository", kind: "warning" });
    if (!approved) return false;
    try {
      setRepositories(await invoke<SavedRepository[]>("remove_repository", { id }));
      setStates((current) => { const next = { ...current }; delete next[id]; return next; });
      return true;
    } catch (cause) {
      patch(id, { error: String(cause) });
      return false;
    }
  }

  const summaries = useMemo(() => Object.fromEntries(repositories.map((repository) => [repository.id, summarize(states[repository.id] ?? blank())])), [repositories, states]);

  /** One status per repository, for the list, Play and the dock. */
  function statusOf(id: string): { status: StatusKey; word: string; sub: string } {
    const state = stateOf(id);
    const summary = summaries[id];
    if (job && "repositoryId" in job && job.repositoryId === id) {
      if (job.kind === "sync") return { status: "doing", word: "Syncing", sub: `Syncing. ${bytes(job.progress.downloadedBytes)} of ${bytes(job.progress.totalBytes)}` };
      if (job.kind === "check") return { status: "doing", word: "Checking", sub: "Checking your files" };
      if (job.kind === "connect") return { status: "doing", word: "Connecting", sub: "Reading the repository" };
    }
    if (state.connectError) return { status: "exception", word: "Can't connect", sub: "Couldn't reach the repository" };
    if (state.error) return { status: "exception", word: "Problem", sub: "The last check or sync failed" };
    if (!summary?.checkedAny) return { status: "todo", word: "Not checked", sub: state.snapshot ? `${state.snapshot.addons.length} mods. Not checked yet` : "Not checked yet" };
    if (summary.unresolved.length) return { status: "exception", word: "Needs a look", sub: `${summary.unresolved.length} mod${summary.unresolved.length === 1 ? "" : "s"} couldn't be matched` };
    if (summary.transferFiles > 0) return { status: "doing", word: "Update ready", sub: `Update ready. ${bytes(summary.downloadBytes)}` };
    return { status: "done", word: "Up to date", sub: `Up to date. Checked ${clock(state.checkedAt ?? Date.now())}` };
  }

  /** Repositories where a check found something to download. */
  const pendingIds = repositories.filter((repository) => (summaries[repository.id]?.transferFiles ?? 0) > 0).map((repository) => repository.id);

  // Speed is measured here: the backend reports totals, not a rate. Smoothed,
  // because a raw per-tick rate is unreadable.
  const rateRef = useRef<{ bytes: number; at: number } | null>(null);
  const [transferRate, setTransferRate] = useState<number | null>(null);
  const syncProgress = job?.kind === "sync" ? job.progress : null;
  useEffect(() => {
    if (!syncProgress || syncProgress.phase !== "downloading") { rateRef.current = null; setTransferRate(null); return; }
    const now = performance.now();
    const previous = rateRef.current;
    rateRef.current = { bytes: syncProgress.downloadedBytes, at: now };
    if (!previous) return;
    const seconds = (now - previous.at) / 1000;
    const delta = syncProgress.downloadedBytes - previous.bytes;
    if (seconds <= 0 || delta < 0) return;
    setTransferRate((current) => (current === null ? delta / seconds : current * 0.7 + (delta / seconds) * 0.3));
  }, [syncProgress]);

  return {
    repositories, loadError, defaultDestination, job, transferRate,
    stateOf, summaries, statusOf, pendingIds,
    connect, setSelection, chooseModset, checkFiles, checkForUpdates, synchronize, togglePause, stop,
    inspect, importRepository, updateDestination, remove, patch,
  };
}

export type Repositories = ReturnType<typeof useRepositories>;

export function syncPercent(progress: SyncProgress) {
  if (progress.phase === "installing") return progress.totalFiles ? Math.floor(progress.completedFiles / progress.totalFiles * 100) : 100;
  return progress.totalBytes ? Math.min(100, Math.floor(progress.downloadedBytes / progress.totalBytes * 100)) : 0;
}

export function checkPercent(progress: CheckProgress) {
  return progress.totalFiles ? Math.min(100, Math.floor(progress.checkedFiles / progress.totalFiles * 100)) : 0;
}
