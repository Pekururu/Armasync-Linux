import { Channel, invoke } from "@tauri-apps/api/core";
import { confirm, open as openDialog } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useRef, useState } from "react";

type SavedRepository = { id: string; name: string; autoconfigUrl: string; destination: string };
type RepositoryInfo = { name: string; protocol: string; host: string; port: number | null; anonymous: boolean; sourceUrl: string };
type ManifestSummary = { directories: number; files: number; totalBytes: number; compressedFiles: number; addonRoots: number; unhashedFiles: number };
type PublishedModset = { name: string; description: string; addons: string[]; userconfigFolders: string[] };
type RepositoryAddon = { id: string; name: string; remotePath: string; files: number; totalBytes: number; transferBytes: number; duplicateName: boolean };
type RepositorySnapshot = { repository: RepositoryInfo; manifest: ManifestSummary; publishedModsets: PublishedModset[]; addons: RepositoryAddon[] };
type SyncOperation = { action: "download" | "replace"; addon: string; relativePath: string; transferBytes: number; finalBytes: number };
type SyncPlan = { requestedAddons: string[]; resolvedAddons: string[]; missingAddons: string[]; ambiguousAddons: string[]; totalFiles: number; verifiedFiles: number; downloadFiles: number; replacementFiles: number; downloadBytes: number; finalBytes: number; operations: SyncOperation[] };
type SyncResult = { installedFiles: number; downloadedBytes: number; backupDirectory: string | null; destination: string };
type SyncProgress = { phase: "preparing" | "downloading" | "installing"; downloadedBytes: number; totalBytes: number; completedFiles: number; totalFiles: number; currentFile: string | null };
type AddonGroupSummary = { id: string; name: string; source?: { repositoryId: string; modsetName: string } | null };
type ModsetApplyResult = { action: string; groupName: string; addonCount: number };

function RepoIcon({ name }: { name: "repository" | "plus" | "trash" | "refresh" | "folder" | "check" | "download" | "link" | "pause" | "play" | "stop" }) {
  const paths = {
    repository: <><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>, trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13"/></>,
    refresh: <><path d="M20 12a8 8 0 1 1-2.3-5.7L20 8"/><path d="M20 3v5h-5"/></>, folder: <path d="M3 7.5h7l2-2h9v13H3z"/>,
    check: <path d="m5 12 4 4L19 6"/>, download: <><path d="M12 4v11m-4-4 4 4 4-4M5 20h14"/></>, link: <><path d="M10 13a4 4 0 0 0 5.7.1l2.4-2.4A4 4 0 0 0 12.4 5L11 6.4"/><path d="M14 11a4 4 0 0 0-5.7-.1l-2.4 2.4A4 4 0 0 0 11.6 19l1.4-1.4"/></>,
    pause: <><path d="M8 5v14M16 5v14"/></>, play: <path d="m8 5 11 7-11 7z"/>, stop: <rect x="6" y="6" width="12" height="12"/>,
  };
  return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function bytes(value: number) {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const power = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** power).toFixed(power < 2 ? 0 : 1)} ${units[power]}`;
}

export default function RepositoryView({ active, defaultDestination, addonGroups, onApplyModset, onSynchronized }: { active: boolean; defaultDestination: string | null; addonGroups: AddonGroupSummary[]; onApplyModset: (repositoryId: string, destination: string, modsetName: string, addons: string[]) => Promise<ModsetApplyResult>; onSynchronized: () => Promise<void> }) {
  const [repositories, setRepositories] = useState<SavedRepository[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<RepositorySnapshot | null>(null);
  const [selectedAddons, setSelectedAddons] = useState<Set<string>>(new Set());
  const [selectedModsetName, setSelectedModsetName] = useState("");
  const [plan, setPlan] = useState<SyncPlan | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showDestinationEditor, setShowDestinationEditor] = useState(false);
  const [url, setUrl] = useState("");
  const [destination, setDestination] = useState(defaultDestination ?? "");
  const [editedDestination, setEditedDestination] = useState("");
  const [busy, setBusy] = useState<"import" | "connect" | "check" | "sync" | "destination" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [groupNotice, setGroupNotice] = useState<string | null>(null);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [syncJobId, setSyncJobId] = useState<string | null>(null);
  const [syncPaused, setSyncPaused] = useState(false);
  const [syncStopping, setSyncStopping] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const stopRequested = useRef(false);
  const selectedRepository = repositories.find((item) => item.id === selectedId) ?? null;
  const selectedBytes = useMemo(() => snapshot?.addons.filter((item) => selectedAddons.has(item.name)).reduce((sum, item) => sum + item.totalBytes, 0) ?? 0, [snapshot, selectedAddons]);
  const linkedGroup = addonGroups.find((group) => group.source?.repositoryId === selectedId && group.source.modsetName === selectedModsetName) ?? null;
  const syncPercent = syncProgress?.totalBytes ? Math.min(100, Math.floor(syncProgress.downloadedBytes / syncProgress.totalBytes * 100)) : 0;

  useEffect(() => { void loadRepositories(); }, []);
  useEffect(() => { if (!destination && defaultDestination) setDestination(defaultDestination); }, [defaultDestination, destination]);

  async function loadRepositories() {
    try {
      const items = await invoke<SavedRepository[]>("list_repositories");
      setRepositories(items);
      setSelectedId((current) => current && items.some((item) => item.id === current) ? current : items[0]?.id ?? null);
    } catch (cause) { setError(String(cause)); }
  }

  async function chooseDestination(target: "new" | "existing" = "new") {
    const chosen = await openDialog({ directory: true, multiple: false, title: "Select or create a repository download folder" });
    if (typeof chosen !== "string") return;
    if (target === "existing") setEditedDestination(chosen);
    else setDestination(chosen);
  }

  function openDestinationEditor() {
    if (!selectedRepository) return;
    setEditedDestination(selectedRepository.destination);
    setError(null);
    setShowDestinationEditor(true);
  }

  async function saveDestination() {
    if (!selectedId || !editedDestination.trim()) return;
    setBusy("destination"); setError(null);
    try {
      const items = await invoke<SavedRepository[]>("update_repository_destination", { id: selectedId, destination: editedDestination.trim() });
      setRepositories(items); setPlan(null); setResult(null); setShowDestinationEditor(false);
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(null); }
  }

  async function importRepository() {
    if (!url.trim() || !destination) return;
    setBusy("import"); setError(null);
    try {
      const items = await invoke<SavedRepository[]>("import_repository", { autoconfigUrl: url.trim(), destination: destination.trim() });
      setRepositories(items); setSelectedId(items.at(-1)?.id ?? null); setShowAdd(false); setUrl(""); setSnapshot(null);
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(null); }
  }

  async function connect() {
    if (!selectedId) return;
    setBusy("connect"); setError(null); setPlan(null); setResult(null);
    try {
      const next = await invoke<RepositorySnapshot>("connect_repository", { id: selectedId });
      setSnapshot(next); setSelectedAddons(new Set(next.addons.map((item) => item.name))); setSelectedModsetName(""); setGroupNotice(null);
    } catch (cause) { setSnapshot(null); setError(String(cause)); }
    finally { setBusy(null); }
  }

  function applyModset(name: string) {
    if (!snapshot) return;
    setSelectedModsetName(name); setGroupNotice(null);
    if (!name) { setSelectedAddons(new Set(snapshot.addons.map((item) => item.name))); return; }
    const modset = snapshot.publishedModsets.find((item) => item.name === name);
    setSelectedAddons(new Set(modset?.addons ?? [])); setPlan(null);
  }

  async function applyModsetToGroup() {
    if (!selectedRepository || !snapshot || !selectedModsetName) return;
    const modset = snapshot.publishedModsets.find((item) => item.name === selectedModsetName);
    if (!modset) return;
    if (linkedGroup) {
      const approved = await confirm(`Update “${linkedGroup.name}” to match the current “${modset.name}” membership? Existing members keep their manual load order; removed members are dropped and new members are appended.`, { title: "Update addon group", kind: "warning" });
      if (!approved) return;
    }
    setError(null);
    try {
      const membership = new Set(modset.addons.map((addon) => addon.toLocaleLowerCase()));
      const repositoryOrder = snapshot.addons.filter((addon) => membership.has(addon.name.toLocaleLowerCase())).map((addon) => addon.name);
      const catalogNames = new Set(repositoryOrder.map((addon) => addon.toLocaleLowerCase()));
      const externalMembers = modset.addons.filter((addon) => !catalogNames.has(addon.toLocaleLowerCase())).sort((left, right) => left.localeCompare(right));
      const applied = await onApplyModset(selectedRepository.id, selectedRepository.destination, modset.name, [...repositoryOrder, ...externalMembers]);
      setGroupNotice(`${applied.groupName} ${applied.action} with ${applied.addonCount} addons.`);
    } catch (cause) { setError(String(cause)); }
  }

  async function checkFiles() {
    if (!selectedId || selectedAddons.size === 0) return;
    setBusy("check"); setError(null); setResult(null);
    try { setPlan(await invoke<SyncPlan>("check_repository_files", { id: selectedId, selectedAddons: [...selectedAddons] })); }
    catch (cause) { setPlan(null); setError(String(cause)); }
    finally { setBusy(null); }
  }

  async function synchronize() {
    if (!selectedId || !plan || plan.downloadFiles === 0) return;
    const approved = await confirm(`Download ${plan.downloadFiles} files (${bytes(plan.downloadBytes)}) to ${selectedRepository?.destination}? Existing replacements are backed up first.`, { title: "Synchronize repository", kind: "warning" });
    if (!approved) return;
    const jobId = crypto.randomUUID();
    const progress = new Channel<SyncProgress>();
    progress.onmessage = (update) => setSyncProgress((current) => update.totalBytes ? update : {
      ...update,
      totalBytes: current?.totalBytes ?? plan.downloadBytes,
      totalFiles: current?.totalFiles ?? plan.downloadFiles,
    });
    stopRequested.current = false;
    setBusy("sync"); setError(null); setResult(null); setSyncMessage(null); setSyncJobId(jobId); setSyncPaused(false); setSyncStopping(false);
    setSyncProgress({ phase: "preparing", downloadedBytes: 0, totalBytes: plan.downloadBytes, completedFiles: 0, totalFiles: plan.downloadFiles, currentFile: null });
    try {
      const done = await invoke<SyncResult>("synchronize_repository", { id: selectedId, selectedAddons: [...selectedAddons], jobId, onProgress: progress });
      setResult(done); setPlan(null); await onSynchronized();
    } catch (cause) {
      const message = String(cause);
      if (stopRequested.current || message.toLocaleLowerCase().includes("synchronization stopped")) {
        setSyncMessage("Synchronization stopped. Incomplete files were discarded.");
      } else {
        setError(message);
      }
    }
    finally { setBusy(null); setSyncProgress(null); setSyncJobId(null); setSyncPaused(false); setSyncStopping(false); }
  }

  async function toggleSyncPause() {
    if (!syncJobId || syncStopping) return;
    try {
      await invoke(syncPaused ? "resume_repository_sync" : "pause_repository_sync", { jobId: syncJobId });
      setSyncPaused((paused) => !paused);
    } catch (cause) { setError(String(cause)); }
  }

  async function stopSync() {
    if (!syncJobId || syncStopping) return;
    setSyncStopping(true); stopRequested.current = true;
    try { await invoke("stop_repository_sync", { jobId: syncJobId }); }
    catch (cause) { stopRequested.current = false; setSyncStopping(false); setError(String(cause)); }
  }

  async function removeRepository() {
    if (!selectedRepository) return;
    const approved = await confirm(`Remove “${selectedRepository.name}” from the launcher? Downloaded addon files are not deleted.`, { title: "Remove repository", kind: "warning" });
    if (!approved) return;
    try { const items = await invoke<SavedRepository[]>("remove_repository", { id: selectedRepository.id }); setRepositories(items); setSelectedId(items[0]?.id ?? null); setSnapshot(null); setPlan(null); setError(null); }
    catch (cause) { setError(String(cause)); }
  }

  return <section className={`workspace repository-workspace ${active ? "" : "tab-hidden"}`}>
    <div className="workspace-heading"><div><h1>Repositories</h1><p>Add, inspect, and synchronize Arma3Sync-compatible unit repositories.</p></div></div>
    <div className="repository-layout">
      <aside className="repository-rail">
        <header><div><strong>Saved repositories</strong><span>{repositories.length} configured</span></div><button type="button" title="Add repository" onClick={() => { setShowAdd(true); setError(null); }}><RepoIcon name="plus"/></button></header>
        <div className="repository-list">
          {repositories.map((item) => <button type="button" key={item.id} className={`repository-card ${selectedId === item.id ? "selected" : ""}`} onClick={() => { setSelectedId(item.id); setSnapshot(null); setPlan(null); setResult(null); setError(null); }}>
            <span className="repository-card-icon"><RepoIcon name="repository"/></span><span className="repository-card-copy"><strong>{item.name}</strong><small>{new URL(item.autoconfigUrl).host}</small></span><span className={`status-dot ${snapshot && selectedId === item.id ? "" : "idle"}`}/>
          </button>)}
          {!repositories.length && <div className="repository-rail-empty">No repositories configured yet.</div>}
        </div>
        {selectedRepository && <footer><button type="button" className="rail-connect" disabled={busy !== null} onClick={() => void connect()}><RepoIcon name="link"/>{busy === "connect" ? "Connecting…" : snapshot ? "Reconnect" : "Connect"}</button><button type="button" title="Remove repository" onClick={() => void removeRepository()}><RepoIcon name="trash"/></button></footer>}
      </aside>

      <section className="repository-stage">
        {!selectedRepository ? <div className="repository-welcome"><span className="welcome-icon"><RepoIcon name="repository"/></span><h2>Add your unit repository</h2><p>Import its public <code>.a3s/autoconfig</code> URL, then connect to browse and verify the published addons.</p><button className="button primary-small" type="button" onClick={() => setShowAdd(true)}><RepoIcon name="plus"/> Add repository</button></div>
        : !snapshot ? <div className="repository-welcome"><span className="welcome-icon"><RepoIcon name="link"/></span><h2>{selectedRepository.name}</h2><p>Connect to fetch the current addon manifest and published modsets. Nothing is downloaded during this step.</p><code className="destination-preview">{selectedRepository.destination}</code><button className="button primary-small" disabled={busy !== null} type="button" onClick={() => void connect()}>{busy === "connect" ? <RepoIcon name="refresh"/> : <RepoIcon name="link"/>}{busy === "connect" ? "Connecting…" : "Connect to repository"}</button></div>
        : <>
          <header className="repository-stage-header"><div><span className="eyebrow">Connected repository</span><h2>{snapshot.repository.name}</h2><p>{snapshot.repository.protocol} · {snapshot.repository.host}{snapshot.repository.port ? `:${snapshot.repository.port}` : ""} · {snapshot.repository.anonymous ? "Anonymous access" : "Credentials supplied by auto-config"}</p></div><button className="button quiet" type="button" disabled={busy !== null} onClick={() => void connect()}><RepoIcon name="refresh"/> Refresh</button></header>
          <div className="repository-destination"><span><strong>Download location</strong><code title={selectedRepository.destination}>{selectedRepository.destination}</code></span><button type="button" disabled={busy !== null} onClick={openDestinationEditor}><RepoIcon name="folder"/> Select / create folder</button></div>
          <div className="repository-stats"><span><strong>{snapshot.addons.length}</strong> addons</span><span><strong>{snapshot.manifest.files.toLocaleString()}</strong> files</span><span><strong>{bytes(snapshot.manifest.totalBytes)}</strong> installed size</span><span><strong>{snapshot.publishedModsets.length}</strong> modsets</span></div>
          <div className="repository-controls"><select value={selectedModsetName} aria-label="Published modset" onChange={(event) => applyModset(event.target.value)}><option value="">All repository addons</option>{snapshot.publishedModsets.map((item) => <option value={item.name} key={item.name}>{item.name}</option>)}</select><span>{selectedAddons.size} selected · {bytes(selectedBytes)}</span><button type="button" onClick={() => { setSelectedAddons(new Set(snapshot.addons.map((item) => item.name))); setSelectedModsetName(""); setPlan(null); setGroupNotice(null); }}>Select all</button><button type="button" onClick={() => { setSelectedAddons(new Set()); setSelectedModsetName(""); setPlan(null); setGroupNotice(null); }}>Clear</button>{selectedModsetName && <button className="modset-group-action" type="button" onClick={() => void applyModsetToGroup()}><RepoIcon name={linkedGroup ? "refresh" : "plus"}/>{linkedGroup ? `Update ${linkedGroup.name}` : "Create addon group"}</button>}</div>
          {groupNotice && <div className="repository-group-notice"><RepoIcon name="check"/>{groupNotice}</div>}
          <div className="repository-content">
            <div className="repository-addon-list"><div className="repository-column-labels"><span>Repository content</span><span>Files / size</span></div>{snapshot.addons.map((addon) => <label className={`repository-addon-row ${selectedAddons.has(addon.name) ? "selected" : ""}`} key={addon.id}><input type="checkbox" checked={selectedAddons.has(addon.name)} onChange={() => { const next = new Set(selectedAddons); next.has(addon.name) ? next.delete(addon.name) : next.add(addon.name); setSelectedAddons(next); setPlan(null); }}/><span><strong title={addon.name}>{addon.name}</strong><small title={addon.remotePath}>{addon.remotePath}</small></span><span>{addon.files.toLocaleString()} · {bytes(addon.totalBytes)}</span>{addon.duplicateName && <i title="This addon name occurs more than once">!</i>}</label>)}</div>
            <aside className="repository-check-panel">
              <span className="eyebrow">Local file check</span>
              {!plan && !result && !syncProgress && <><h3>Ready to verify</h3><p>Compare selected repository files with the destination using size and SHA-1 hashes.</p></>}
              {plan && !syncProgress && <><h3>{plan.downloadFiles ? "Changes found" : "Files are current"}</h3><div className="check-summary"><span><strong>{plan.verifiedFiles.toLocaleString()}</strong> verified</span><span><strong>{plan.downloadFiles.toLocaleString()}</strong> downloads</span><span><strong>{plan.replacementFiles.toLocaleString()}</strong> replacements</span><span><strong>{bytes(plan.downloadBytes)}</strong> transfer</span></div>{(plan.missingAddons.length > 0 || plan.ambiguousAddons.length > 0) && <p className="repository-warning">Some selected addon names could not be resolved safely.</p>}</>}
              {syncProgress && <div className="repository-sync-progress">
                <div className="sync-progress-heading"><strong>{syncStopping ? "Stopping safely…" : syncPaused ? "Paused" : syncProgress.phase === "preparing" ? "Preparing download…" : syncProgress.phase === "installing" ? "Installing files…" : "Downloading…"}</strong><span>{syncPercent}%</span></div>
                <div className="sync-progress-track" role="progressbar" aria-label="Repository synchronization progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={syncPercent}><span style={{ width: `${syncPercent}%` }}/></div>
                <div className="sync-progress-stats"><span>{bytes(syncProgress.downloadedBytes)} / {bytes(syncProgress.totalBytes)}</span><span>{syncProgress.completedFiles.toLocaleString()} / {syncProgress.totalFiles.toLocaleString()} files</span></div>
                {syncProgress.currentFile && <code title={syncProgress.currentFile}>{syncProgress.currentFile}</code>}
                <div className="sync-progress-actions"><button className="button" type="button" disabled={syncStopping || syncProgress.phase === "installing"} onClick={() => void toggleSyncPause()}><RepoIcon name={syncPaused ? "play" : "pause"}/>{syncPaused ? "Resume" : "Pause"}</button><button className="button sync-stop" type="button" disabled={syncStopping} onClick={() => void stopSync()}><RepoIcon name="stop"/>{syncStopping ? "Stopping…" : "Stop"}</button></div>
              </div>}
              {result && <><h3>Synchronization complete</h3><p>{result.installedFiles.toLocaleString()} files installed · {bytes(result.downloadedBytes)} downloaded.</p></>}
              {syncMessage && <p className="repository-sync-message">{syncMessage}</p>}
              {error && <p className="repository-error">{error}</p>}
              <div className="check-actions"><button className="button" type="button" disabled={busy !== null || selectedAddons.size === 0} onClick={() => void checkFiles()}><RepoIcon name="check"/>{busy === "check" ? "Checking…" : "Check files"}</button>{plan && plan.downloadFiles > 0 && <button className="button primary-small" type="button" disabled={busy !== null || plan.missingAddons.length > 0 || plan.ambiguousAddons.length > 0} onClick={() => void synchronize()}><RepoIcon name="download"/>{busy === "sync" ? "Synchronizing…" : "Synchronize"}</button>}</div>
            </aside>
          </div>
        </>}
        {error && !snapshot && <div className="repository-global-error">{error}</div>}
      </section>
    </div>

    {showAdd && <><button className="drawer-scrim" type="button" aria-label="Close" onClick={() => busy === null && setShowAdd(false)}/><aside className="repository-add-dialog"><header><span className="eyebrow">Arma3Sync compatible</span><h2>Add repository</h2><p>The auto-config is inspected before the repository is saved.</p></header><label><span>Auto-config URL</span><input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.org/.a3s/autoconfig" autoFocus/></label><label><span>Download location</span><div className="destination-field"><input value={destination} onChange={(event) => setDestination(event.target.value)} placeholder="/absolute/path/to/unit-mods"/><button type="button" onClick={() => void chooseDestination()}><RepoIcon name="folder"/> Browse</button></div><small className="destination-help">Select an existing folder or type a new absolute path. New folders are created when the repository is saved.</small></label><div className="security-note"><RepoIcon name="check"/><span>HTTPS is required. Repository credentials embedded inside the downloaded auto-config stay in memory and are never saved.</span></div>{error && <p className="repository-error">{error}</p>}<footer><button className="button" type="button" disabled={busy !== null} onClick={() => setShowAdd(false)}>Cancel</button><button className="button primary-small" type="button" disabled={busy !== null || !url.trim() || !destination.trim()} onClick={() => void importRepository()}>{busy === "import" ? <RepoIcon name="refresh"/> : <RepoIcon name="download"/>}{busy === "import" ? "Importing…" : "Import repository"}</button></footer></aside></>}
    {showDestinationEditor && <><button className="drawer-scrim" type="button" aria-label="Close" onClick={() => busy === null && setShowDestinationEditor(false)}/><aside className="repository-add-dialog destination-dialog"><header><span className="eyebrow">Repository setting</span><h2>Download location</h2><p>Repository addons will be checked and synchronized inside this folder.</p></header><label><span>Folder path</span><div className="destination-field"><input value={editedDestination} onChange={(event) => setEditedDestination(event.target.value)} placeholder="/absolute/path/to/unit-mods" autoFocus/><button type="button" onClick={() => void chooseDestination("existing")}><RepoIcon name="folder"/> Browse</button></div><small className="destination-help">Select an existing folder or enter a new absolute path. The launcher will create it when you save.</small></label>{error && <p className="repository-error">{error}</p>}<footer><button className="button" type="button" disabled={busy !== null} onClick={() => setShowDestinationEditor(false)}>Cancel</button><button className="button primary-small" type="button" disabled={busy !== null || !editedDestination.trim()} onClick={() => void saveDestination()}>{busy === "destination" ? <RepoIcon name="refresh"/> : <RepoIcon name="check"/>}{busy === "destination" ? "Creating…" : "Use this folder"}</button></footer></aside></>}
  </section>;
}
