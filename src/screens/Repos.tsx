import type { AddonGroup, RepositorySnapshot } from "../bindings";
import type { AddonCheck, Repositories } from "../state/repositories";
import { invoke } from "@tauri-apps/api/core";
import { confirm, open as openDialog } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import { bytes, clock, eta, plural, rate } from "../format";
import { checkPercent, syncPercent } from "../state/repositories";
import { Banner, Dialog, Icon, MenuButton, Progress, Status, type StatusKey, toast } from "../ui";

type ApplyModset = (repositoryId: string, destination: string, modsetName: string, addons: string[]) => Promise<{ action: string; groupName: string; addonCount: number }>;

function changeRow(name: string, check: AddonCheck, files: number): { status: StatusKey; sub: string } {
  if (check.state === "unresolved") return { status: "exception", sub: "Couldn't be matched safely. Check again or ask your unit" };
  if (check.missing && check.missing === files) return { status: "todo", sub: `New. ${bytes(check.transferBytes)} to download` };
  const parts = [check.changed && `${plural(check.changed, "file")} changed`, check.missing && `${plural(check.missing, "file")} missing`].filter(Boolean).join(", ");
  return { status: "doing", sub: `${parts}. ${bytes(check.transferBytes)}` };
}

export default function Repos({ repos, groups, selectedId, onSelect, onAdd, onApplyModset }: {
  repos: Repositories;
  groups: AddonGroup[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onApplyModset: ApplyModset;
}) {
  const { repositories, job } = repos;
  const selected = repositories.find((item) => item.id === selectedId) ?? repositories[0] ?? null;
  const state = selected ? repos.stateOf(selected.id) : null;
  const summary = selected ? repos.summaries[selected.id] : null;
  const snapshot = state?.snapshot ?? null;
  const [destinationEditor, setDestinationEditor] = useState<string | null>(null);
  const [destinationError, setDestinationError] = useState<string | null>(null);
  const busy = job !== null;
  const ownJob = job && "repositoryId" in job && job.repositoryId === selected?.id ? job : null;

  // Reading the manifest downloads nothing, so it happens as soon as you open a repository.
  useEffect(() => {
    if (selected && !state?.snapshot && !state?.connectError && !busy) void repos.connect(selected.id);
  }, [selected?.id, busy]);

  if (!selected || !state || !summary) {
    return <div className="as-screen as-center-screen">
      <div className="k-empty">
        <Icon name="empty" />
        <p className="k-empty-title">No repositories yet</p>
        <p className="k-empty-text">Add your unit's Arma3Sync link to download and update its mods.</p>
        <button type="button" className="k-btn k-btn-primary" onClick={onAdd}><Icon name="plus" />Add Repository</button>
        {repos.loadError && <p className="subtext k-muted">{repos.loadError}</p>}
      </div>
    </div>;
  }

  const feeds = groups.filter((group) => group.source?.repositoryId === selected.id);
  const linkedGroup = feeds.find((group) => group.source?.modsetName === state.modset) ?? null;
  const changes = snapshot ? snapshot.addons.flatMap((addon) => {
    const check = state.checked.get(addon.name);
    if (!state.selected.has(addon.name) || !check || check.state === "ok") return [];
    return [{ addon, check, ...changeRow(addon.name, check, addon.files) }];
  }) : [];
  const selectedBytes = snapshot?.addons.filter((addon) => state.selected.has(addon.name)).reduce((sum, addon) => sum + addon.totalBytes, 0) ?? 0;

  async function applyModsetToGroup(current: RepositorySnapshot) {
    const modset = current.publishedModsets.find((item) => item.name === state!.modset);
    if (!modset || !selected) return;
    if (linkedGroup) {
      const approved = await confirm(`Update “${linkedGroup.name}” to match the “${modset.name}” modset? Mods already in it keep their load order. Removed mods are dropped and new ones go at the end.`, { title: "Update addon group", kind: "warning" });
      if (!approved) return;
    }
    const membership = new Set(modset.addons.map((addon) => addon.toLocaleLowerCase()));
    const repositoryOrder = current.addons.filter((addon) => membership.has(addon.name.toLocaleLowerCase())).map((addon) => addon.name);
    const catalogNames = new Set(repositoryOrder.map((addon) => addon.toLocaleLowerCase()));
    const external = modset.addons.filter((addon) => !catalogNames.has(addon.toLocaleLowerCase())).sort((left, right) => left.localeCompare(right));
    try {
      const applied = await onApplyModset(selected.id, selected.destination, modset.name, [...repositoryOrder, ...external]);
      toast(`${applied.action === "created" ? "Created" : "Updated"} ${applied.groupName}`);
    } catch (cause) { repos.patch(selected.id, { error: String(cause) }); }
  }

  async function saveDestination() {
    if (!selected || !destinationEditor?.trim()) return;
    try {
      await repos.updateDestination(selected.id, destinationEditor.trim());
      setDestinationEditor(null);
      setDestinationError(null);
    } catch (cause) { setDestinationError(String(cause)); }
  }

  const syncJob = ownJob?.kind === "sync" ? ownJob : null;
  const checkJob = ownJob?.kind === "check" ? ownJob : null;
  const connecting = ownJob?.kind === "connect";

  return <div className="as-screen as-repos">
    <div className="as-stack-tight as-repo-list">
      <div className="as-screen-head as-tight"><h1 className="title-1 as-flat as-grow">Repositories</h1><button type="button" className="k-btn k-btn-icon" aria-label="Add repository" title="Add repository" disabled={busy} onClick={onAdd}><Icon name="plus" /></button></div>
      <div className="k-card k-card-flush" role="listbox" aria-label="Saved repositories">
        {repositories.map((item) => {
          const status = repos.statusOf(item.id);
          const isSelected = item.id === selected.id;
          return <button type="button" key={item.id} role="option" aria-selected={isSelected} className="k-row as-divided" onClick={() => onSelect(item.id)}>
            <Status status={status.status} cut={isSelected ? "var(--selected)" : undefined} />
            <div className="k-row-body"><span className="k-row-title as-ellipsis">{item.name}</span><span className="k-row-sub">{status.sub}</span></div>
          </button>;
        })}
      </div>
    </div>

    <div className="k-stack as-repo-detail">
      <section className="k-card as-stack-loose" aria-labelledby="repo-title">
        <div className="as-row-top">
          <div className="as-stack-tight as-grow as-min0"><h2 className="title-1 as-flat" id="repo-title">{selected.name}</h2><span className="subtext k-muted as-mono as-ellipsis" title={selected.autoconfigUrl}>{selected.autoconfigUrl}</span></div>
          <MenuButton className="k-btn k-btn-icon" label={`More for ${selected.name}`} title="More" disabled={busy} items={[
            { label: "Change Download Folder", sub: selected.destination, onSelect: () => { setDestinationError(null); setDestinationEditor(selected.destination); } },
            { label: "Full Verification", sub: "Reads every file again, skipping the cache", disabled: !snapshot || state.selected.size === 0, onSelect: () => void repos.checkFiles(selected.id, { scope: [...state.selected], fullVerification: true }) },
            "separator",
            { label: "Remove Repository", sub: "Downloaded files stay on disk", onSelect: () => void repos.remove(selected.id) },
          ]} />
        </div>

        <div className="as-facts">
          <div className="as-fact"><span className="caption k-muted">Mods</span><span className="headline k-num">{snapshot ? snapshot.addons.length : "—"}</span></div>
          <div className="as-fact"><span className="caption k-muted">On disk</span><span className="headline k-num">{snapshot ? bytes(snapshot.manifest.totalBytes) : "—"}</span></div>
          <div className="as-fact"><span className="caption k-muted">Feeds group</span><span className="headline as-ellipsis" title={feeds.map((group) => group.name).join(", ")}>{feeds.length ? feeds.map((group) => group.name).join(", ") : "None"}</span></div>
        </div>

        {snapshot && snapshot.publishedModsets.length > 0 && <div className="as-inline-tools">
          <MenuButton label="Modset" items={[
            { label: "All repository mods", checked: !state.modset, onSelect: () => repos.chooseModset(selected.id, "") },
            ...snapshot.publishedModsets.map((modset) => ({ label: modset.name, sub: plural(modset.addons.length, "mod"), checked: state.modset === modset.name, onSelect: () => repos.chooseModset(selected.id, modset.name) })),
          ]} disabled={busy}>{state.modset || "All repository mods"}</MenuButton>
          {state.modset && <button type="button" className="k-btn k-btn-quiet" disabled={busy} onClick={() => void applyModsetToGroup(snapshot)}>{linkedGroup ? `Update ${linkedGroup.name}` : "Create Addon Group"}</button>}
        </div>}

        {state.connectError && <Banner tone="danger" title="Couldn't reach the repository" action={<button type="button" className="k-btn k-btn-quiet" disabled={busy} onClick={() => void repos.connect(selected.id)}>Try Again</button>}>{state.connectError}</Banner>}
        {state.error && <Banner tone="danger" title={syncJob ? "Sync failed" : "Something went wrong"}>{state.error}</Banner>}
        {state.message && <Banner title={state.message} />}
        {summary.unresolved.length > 0 && <Banner tone="danger" title={`${plural(summary.unresolved.length, "mod")} couldn't be matched safely`}>Sync is off until this is fixed. Pick a modset without them, or ask your unit to fix the repository.</Banner>}

        {checkJob && <div className="as-stack-tight" aria-live="polite">
          <div className="as-row-between"><span className="label">{checkJob.progress.phase === "metadata" ? "Reading the repository file list" : "Checking your files"}</span><span className="subtext k-muted k-num">{checkJob.progress.phase === "metadata" ? "" : `${checkPercent(checkJob.progress)}%`}</span></div>
          <Progress value={checkPercent(checkJob.progress)} indeterminate={checkJob.progress.phase === "metadata"} label="Checking files" />
          <div className="as-row-between subtext k-muted k-num"><span>{checkJob.progress.totalFiles ? `${checkJob.progress.checkedFiles.toLocaleString()} of ${checkJob.progress.totalFiles.toLocaleString()} files` : "Contacting the repository"}</span><span className="as-ellipsis">{checkJob.progress.addon ?? ""}</span></div>
          <div className="k-actions"><button type="button" className="k-btn k-btn-neutral" disabled={checkJob.stopping} onClick={() => void repos.stop()}>{checkJob.stopping ? "Stopping…" : "Stop Check"}</button></div>
        </div>}

        {syncJob && <div className="as-stack-tight" aria-live="polite">
          <div className="as-row-between"><span className="label">{syncJob.stopping ? "Stopping safely" : syncJob.paused ? "Paused" : syncJob.progress.phase === "preparing" ? "Getting ready" : syncJob.progress.phase === "installing" ? "Installing files" : "Downloading"}</span><span className="subtext k-muted k-num">{syncPercent(syncJob.progress)}%</span></div>
          <Progress value={syncPercent(syncJob.progress)} label="Sync progress" />
          <div className="as-row-between subtext k-muted k-num"><span>{bytes(syncJob.progress.downloadedBytes)} of {bytes(syncJob.progress.totalBytes)}. {syncJob.progress.completedFiles.toLocaleString()} of {syncJob.progress.totalFiles.toLocaleString()} files</span><span>{syncJob.paused ? "" : [rate(repos.transferRate), eta(syncJob.progress.totalBytes - syncJob.progress.downloadedBytes, repos.transferRate)].filter(Boolean).join(". ")}</span></div>
          {syncJob.progress.currentFile && <span className="subtext k-muted as-mono as-ellipsis" title={syncJob.progress.currentFile}>{syncJob.progress.currentFile}</span>}
          <div className="k-actions">
            <button type="button" className="k-btn k-btn-neutral" disabled={syncJob.stopping || syncJob.progress.phase === "installing"} onClick={() => void repos.togglePause()}>{syncJob.paused ? "Resume" : "Pause"}</button>
            <button type="button" className="k-btn k-btn-quiet" disabled={syncJob.stopping} onClick={() => void repos.stop()}>{syncJob.stopping ? "Stopping…" : "Stop"}</button>
          </div>
        </div>}

        {!checkJob && !syncJob && <div className="k-actions">
          {summary.changedAddons > 0 && <button type="button" className="k-btn k-btn-primary" disabled={busy || summary.unresolved.length > 0} onClick={() => void repos.synchronize(selected.id)}>Sync {plural(summary.changedAddons, "Change")}</button>}
          <button type="button" className="k-btn k-btn-neutral" disabled={busy || (!!snapshot && state.selected.size === 0)} onClick={() => void repos.checkForUpdates(selected.id, true)}><Icon name="undo" />{connecting ? "Connecting…" : summary.checkedAny ? "Check Again" : "Check Now"}</button>
          <button type="button" className="k-btn k-btn-quiet" onClick={() => void openPath(selected.destination)}>Open Folder</button>
        </div>}
      </section>

      <section className="k-card k-card-flush" aria-labelledby="changes-title">
        <div className="k-card-head"><h3 className="k-card-title" id="changes-title">What changed</h3><span className="subtext k-muted">{state.checkedAt ? `Checked ${clock(state.checkedAt)}` : ""}</span></div>
        {!summary.checkedAny ? <div className="k-empty">
          <Icon name="search" />
          <p className="k-empty-title">Not checked yet</p>
          <p className="k-empty-text">Checking compares your files with the repository. Nothing is downloaded.</p>
        </div>
        : changes.length === 0 ? <div className="k-empty">
          <Icon name="done" />
          <p className="k-empty-title">{state.result ? "Sync finished" : "Everything matches"}</p>
          <p className="k-empty-text">{state.result ? `${plural(state.result.installedFiles, "file")} installed. ${bytes(state.result.downloadedBytes)} downloaded.` : `${plural(summary.verifiedFiles, "file")} match the repository.`}{summary.pending.length > 0 ? ` ${plural(summary.pending.length, "mod")} not checked yet.` : ""}</p>
        </div>
        : <>
          {changes.slice(0, 5).map((change) => <ChangeRow key={change.addon.id} name={change.addon.name} status={change.status} sub={change.sub} />)}
          {changes.length > 5 && <details className="k-more as-more-pad"><summary>Show {changes.length - 5} More<Icon name="chevron" /></summary>
            <div>{changes.slice(5).map((change) => <ChangeRow key={change.addon.id} name={change.addon.name} status={change.status} sub={change.sub} />)}</div>
          </details>}
        </>}
      </section>

      {snapshot && <section className="k-card k-card-flush">
        <details className="k-more as-more-pad">
          <summary>Choose Mods To Sync ({state.selected.size} of {snapshot.addons.length}. {bytes(selectedBytes)})<Icon name="chevron" /></summary>
          <div className="k-actions as-more-tools">
            <button type="button" className="k-btn k-btn-quiet as-btn-compact" disabled={busy} onClick={() => repos.setSelection(selected.id, new Set(snapshot.addons.map((addon) => addon.name)))}>Select All</button>
            <button type="button" className="k-btn k-btn-quiet as-btn-compact" disabled={busy} onClick={() => repos.setSelection(selected.id, new Set())}>Clear</button>
          </div>
          <div role="group" aria-label="Mods to sync">
            {snapshot.addons.map((addon) => <label key={addon.id} className="k-row as-divided as-check-row">
              <input type="checkbox" className="as-checkbox" disabled={busy} checked={state.selected.has(addon.name)} onChange={() => {
                const next = new Set(state.selected);
                if (next.has(addon.name)) next.delete(addon.name); else next.add(addon.name);
                repos.setSelection(selected.id, next);
              }} />
              <div className="k-row-body"><span className="k-row-title as-ellipsis">{addon.name}{addon.duplicateName ? " (name used twice)" : ""}</span><span className="k-row-sub k-num">{addon.files.toLocaleString()} files. {bytes(addon.totalBytes)}</span></div>
            </label>)}
          </div>
        </details>
      </section>}
    </div>

    <Dialog open={destinationEditor !== null} onClose={() => setDestinationEditor(null)} busy={job?.kind === "destination"} eyebrow={selected.name} title="Download folder"
      actions={<>
        <button type="button" className="k-btn k-btn-quiet" disabled={job?.kind === "destination"} onClick={() => setDestinationEditor(null)}>Cancel</button>
        <button type="button" className="k-btn k-btn-primary" disabled={job?.kind === "destination" || !destinationEditor?.trim()} onClick={() => void saveDestination()}>{job?.kind === "destination" ? "Saving…" : "Use This Folder"}</button>
      </>}>
      <DestinationField value={destinationEditor ?? ""} onChange={setDestinationEditor} />
      {destinationError && <Banner tone="danger" title="Couldn't use this folder">{destinationError}</Banner>}
    </Dialog>
  </div>;
}

function ChangeRow({ name, status, sub }: { name: string; status: StatusKey; sub: string }) {
  return <div className="k-row as-static as-divided"><Status status={status} /><div className="k-row-body"><span className="k-row-title as-ellipsis">{name}</span><span className="k-row-sub k-num">{sub}</span></div></div>;
}

/** Download folder with Browse and a free-space hint. */
export function DestinationField({ value, onChange, needBytes }: { value: string; onChange: (value: string) => void; needBytes?: number }) {
  const [free, setFree] = useState<number | null>(null);
  useEffect(() => {
    const path = value.trim();
    if (!path.startsWith("/")) { setFree(null); return; }
    const timeout = window.setTimeout(() => void invoke<number | null>("free_space", { path }).then(setFree).catch(() => setFree(null)), 250);
    return () => window.clearTimeout(timeout);
  }, [value]);

  async function browse() {
    const chosen = await openDialog({ directory: true, multiple: false, title: "Choose or create a download folder" });
    if (typeof chosen === "string") onChange(chosen);
  }

  const help = free === null
    ? "Pick a folder or type a full path. The folder is created if missing."
    : needBytes
      ? free >= needBytes ? `${bytes(free - needBytes)} free after download. The folder is created if missing.` : `Not enough space: ${bytes(needBytes)} needed, ${bytes(free)} free.`
      : `${bytes(free)} free. The folder is created if missing.`;
  return <div className="k-field" data-invalid={needBytes && free !== null && free < needBytes ? true : undefined}>
    <label className="k-field-label" htmlFor="download-folder">Download to</label>
    <div className="as-inline-tools"><input id="download-folder" className="k-input as-grow" value={value} onChange={(event) => onChange(event.target.value)} placeholder="/home/you/arma/unit-mods" /><button type="button" className="k-btn k-btn-neutral" onClick={() => void browse()}>Browse</button></div>
    <span className="k-field-help">{help}</span>
  </div>;
}
