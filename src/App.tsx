import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bytes, plural } from "./format";
import AddRepository from "./screens/AddRepository";
import Health from "./screens/Health";
import Launch from "./screens/Launch";
import Mods from "./screens/Mods";
import Play, { PickerRow, type Readiness, type ReadinessRow } from "./screens/Play";
import Repos from "./screens/Repos";
import Sources from "./screens/Sources";
import Voice, { voiceProgress } from "./screens/Voice";
import { type Addon, groupSummary, repositoryFor, useCatalog, useGroups } from "./state/catalog";
import { useLaunchSelection, useLauncher } from "./state/launcher";
import { syncPercent, useRepositories } from "./state/repositories";
import { useHealth, useVoice } from "./state/system";
import { Icon, type MenuEntry, MenuButton, Sheet, Status, type StatusKey } from "./ui";

type Screen = "play" | "mods" | "repos" | "voice" | "launch" | "health";

const screens: { id: Screen; label: string; icon: string }[] = [
  { id: "play", label: "Play", icon: "skip" },
  { id: "mods", label: "Mods", icon: "list" },
  { id: "repos", label: "Repos", icon: "empty" },
  { id: "voice", label: "Voice", icon: "spark" },
  { id: "launch", label: "Launch", icon: "settings" },
  { id: "health", label: "Health", icon: "focus" },
];

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

/** The window has no system title bar, so the top strip drags it and holds the window buttons. */
function WindowBar() {
  const appWindow = getCurrentWindow();
  return <div className="as-windowbar" data-tauri-drag-region onDoubleClick={(event) => { if (!(event.target as HTMLElement).closest("button")) void appWindow.toggleMaximize(); }}>
    <button type="button" className="as-window-btn" aria-label="Minimize window" title="Minimize" onClick={() => void appWindow.minimize()}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5h10" /></svg></button>
    <button type="button" className="as-window-btn" aria-label="Maximize window" title="Maximize" onClick={() => void appWindow.toggleMaximize()}><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="3.5" width="9" height="9" /></svg></button>
    <button type="button" className="as-window-btn" aria-label="Close window" title="Close" onClick={() => void appWindow.close()}><Icon name="close" /></button>
  </div>;
}

type Theme = "dark" | "light" | "system";

function readTheme(): Theme {
  try { const stored = localStorage.getItem("armasync-theme"); return stored === "light" || stored === "system" ? stored : "dark"; } catch { return "dark"; }
}

/** Dark by default. Light and "match device" set data-theme on <html>, which KalmUI reads. */
function useTheme() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const apply = () => document.documentElement.setAttribute("data-theme", theme === "system" ? (media.matches ? "light" : "dark") : theme);
    apply();
    try { localStorage.setItem("armasync-theme", theme); } catch { /* The choice just won't be remembered. */ }
    if (theme !== "system") return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  return [theme, setTheme] as const;
}

function DisplaySheet({ open, onClose, theme, setTheme }: { open: boolean; onClose: () => void; theme: Theme; setTheme: (theme: Theme) => void }) {
  const comfort = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open && comfort.current) window.KalmUI.mountComfort(comfort.current); }, [open]);
  return <Sheet open={open} onClose={onClose} title="Display" sub="Only changes how Armasync looks.">
    <div className="k-field">
      <span className="k-field-label" id="theme-label">Theme</span>
      <div className="k-chips" role="group" aria-labelledby="theme-label">
        {([["dark", "Dark"], ["light", "Light"], ["system", "Match Device"]] as const).map(([value, label]) =>
          <button key={value} type="button" className="k-chip" aria-pressed={theme === value} onClick={() => setTheme(value)}>{label}</button>)}
      </div>
    </div>
    <div ref={comfort} />
  </Sheet>;
}

function idSummary(ids: string[]) {
  const dlc = ids.filter((id) => id.startsWith("dlc:")).length;
  const mods = ids.length - dlc;
  return `${mods} mod${mods === 1 ? "" : "s"}${dlc ? `. ${dlc} DLC` : ""}`;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("play");
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [addRepositoryOpen, setAddRepositoryOpen] = useState(false);
  const [selectedRepositoryId, setSelectedRepositoryId] = useState<string | null>(null);
  const [isLaunching, setIsLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [theme, setTheme] = useTheme();

  const catalog = useCatalog();
  const groups = useGroups(catalog.allAddons);
  const launcher = useLauncher();
  const selection = useLaunchSelection(groups.groups, groups.loaded, launcher.settings, groups.setActiveGroupId, groups.activeGroupId);
  const repos = useRepositories({ defaultDestination: catalog.dlcDetection.gameDirectory, onSynchronized: catalog.scanAddonCatalog });
  const voice = useVoice(screen === "voice");
  const health = useHealth();

  const groupAddonsRef = useRef<Addon[]>(groups.groupAddons);
  groupAddonsRef.current = groups.groupAddons;

  const openSources = useCallback(() => { setScreen("mods"); setSourcesOpen(true); void catalog.refreshSources(); }, []);

  // ---------- Readiness: one picture for Play and the dock ----------
  const { activeGroup, groupAddons } = groups;
  const arma = !catalog.dlcDetected ? "locating" : catalog.dlcDetection.gameDirectory ? "found" : "missing";
  const unavailable = groupAddons.filter((addon) => !addon.available);
  const problems = (health.report?.checks ?? []).filter((check) => check.status === "fail" && check.id !== "arma");
  const relevantPending = repos.pendingIds.filter((id) => {
    const repository = repos.repositories.find((item) => item.id === id);
    return activeGroup.source?.repositoryId === id || (!!repository && groupAddons.some((addon) => repositoryFor(addon.path, [repository])));
  });
  const job = repos.job;
  const syncing = job?.kind === "sync";
  const server = launcher.settings?.servers.find((item) => item.id === selection.selectedServerId);
  const voiceState = voiceProgress(voice.status);
  // Missing repository mods are fine when an update is about to download them.
  const blockingUnavailable = relevantPending.length ? unavailable.filter((addon) => addon.kind === "dlc" || !addon.path || !repos.repositories.some((repository) => relevantPending.includes(repository.id) && repositoryFor(addon.path, [repository]))) : unavailable;

  async function launch(update: boolean) {
    setLaunchError(null);
    if (update) {
      for (const id of relevantPending) {
        if (!await repos.synchronize(id)) { setLaunchError("The update didn't finish, so Arma wasn't started."); return; }
      }
      // Let the rescanned addon list reach the group before checking it.
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
    const addons = groupAddonsRef.current;
    const missing = addons.filter((addon) => !addon.available);
    if (missing.length) { setLaunchError(`${plural(missing.length, "mod")} in this group ${missing.length === 1 ? "isn't" : "aren't"} available: ${missing.map((addon) => addon.label).join(", ")}.`); return; }
    setIsLaunching(true);
    try {
      await launcher.flush();
      await invoke("launch_arma", {
        selectedServerId: selection.selectedServerId,
        playerProfile: selection.playerProfile || null,
        addons: addons.map((addon) => ({ kind: addon.kind, value: addon.kind === "dlc" ? addon.id.replace("dlc:", "") : addon.path })),
      });
    } catch (error) {
      setLaunchError(String(error));
    } finally {
      setIsLaunching(false);
    }
  }

  const readiness = useMemo((): Readiness => {
    const rows: ReadinessRow[] = [];
    const proton = launcher.view?.environment.selectedProton ?? "Proton picked by Steam";
    rows.push(arma === "found"
      ? { id: "arma", status: "done", title: "Arma 3 found", sub: `${proton}. Prefix ${voice.status?.prefixInitialized ? "ready" : "not created yet, launch once"}` }
      : arma === "locating"
        ? { id: "arma", status: "doing", title: "Locating Arma 3", sub: "Looking through your Steam libraries" }
        : { id: "arma", status: "exception", title: "Arma 3 not found", sub: "Install it in Steam and run it once with Proton", action: { label: "Check Again", run: () => void catalog.rescanAll(), disabled: catalog.isRescanning } });
    for (const repository of repos.repositories) {
      const status = repos.statusOf(repository.id);
      const summary = repos.summaries[repository.id];
      const busy = job !== null;
      const see = { label: "See Changes", run: () => { setSelectedRepositoryId(repository.id); setScreen("repos"); } };
      rows.push(status.status === "doing" && summary.transferFiles > 0 && !(job && "repositoryId" in job && job.repositoryId === repository.id)
        ? { id: repository.id, status: "doing", title: `${repository.name} has an update`, sub: `${summary.changedAddons} of ${repos.stateOf(repository.id).selected.size} mods changed. ${bytes(summary.downloadBytes)}`, action: see }
        : status.status === "todo"
          ? { id: repository.id, status: "todo", title: `${repository.name} not checked yet`, sub: "Check to see if your unit published changes", action: { label: "Check", run: () => void repos.checkForUpdates(repository.id), disabled: busy } }
          : status.status === "exception"
            ? { id: repository.id, status: "exception", title: `${repository.name}: ${status.word.toLocaleLowerCase()}`, sub: status.sub, action: see }
            : { id: repository.id, status: status.status, title: status.status === "done" ? `${repository.name} is up to date` : `${repository.name}: ${status.word.toLocaleLowerCase()}`, sub: status.sub });
    }
    rows.push(voice.status?.ready
      ? { id: "voice", status: "done", title: "Voice ready", sub: voice.status.teamspeakRunning ? "TeamSpeak is running" : "TeamSpeak is off", action: voice.status.teamspeakRunning ? undefined : { label: "Start TeamSpeak", run: () => void voice.startTeamSpeak(), disabled: voice.busy !== null } }
      : { id: "voice", status: "todo", title: "Voice not set up", sub: `${voiceState.done} of 4 steps done. You can play, but radios won't work`, action: { label: "Set Up", run: () => setScreen("voice") } });
    if (blockingUnavailable.length) rows.push({ id: "unavailable", status: "exception", title: `${plural(blockingUnavailable.length, "mod")} missing from ${activeGroup.name}`, sub: blockingUnavailable.map((addon) => addon.kind === "dlc" ? `${addon.label} (${addon.version})` : addon.label).join(", "), action: { label: "Open Mods", run: () => setScreen("mods") } });
    for (const check of problems) rows.push({ id: `check-${check.id}`, status: "exception", title: check.label, sub: check.summary, action: { label: "Fix", run: () => setScreen("health") } });
    if (launchError) rows.push({ id: "launch-error", status: "exception", title: "Last launch failed", sub: launchError, action: { label: "Open Health", run: () => setScreen("health") } });

    const pendingSummaries = relevantPending.map((id) => ({ repository: repos.repositories.find((item) => item.id === id)!, summary: repos.summaries[id] }));
    const pendingBytes = pendingSummaries.reduce((sum, item) => sum + item.summary.downloadBytes, 0);
    const others = problems.length + blockingUnavailable.length;
    const base = arma === "missing"
      ? { status: "exception" as StatusKey, word: "Not ready", headline: "Arma 3 wasn't found", detail: "Install Arma 3 in Steam and run it once with Proton. Then check again." }
      : arma === "locating"
        ? { status: "doing" as StatusKey, word: "Checking", headline: "Looking for Arma 3", detail: "This takes a moment." }
        : blockingUnavailable.length
          ? { status: "exception" as StatusKey, word: "Not ready", headline: `${plural(blockingUnavailable.length, "mod")} missing`, detail: `${activeGroup.name} has mods that aren't installed. Sync the repository or remove them from the group.` }
          : pendingSummaries.length
            ? { status: "doing" as StatusKey, word: "Almost ready", headline: `${plural(pendingSummaries.length, "update")} before you play`, detail: `${pendingSummaries.map((item) => `${item.repository.name} changed ${plural(item.summary.changedAddons, "mod")}`).join(". ")}. ${bytes(pendingBytes)} to download.${others ? "" : " Everything else checks out."}` }
            : problems.length
              ? { status: "exception" as StatusKey, word: "Needs attention", headline: `${plural(problems.length, "problem")} to look at`, detail: "You can still launch. Health explains each one and how to fix it." }
              : { status: "done" as StatusKey, word: "Ready", headline: "Ready to play", detail: `${activeGroup.name}. ${groupSummary(groupAddons)}${server ? `, joining ${server.name}` : ""}.` };
    return { ...base, rows };
  }, [arma, repos, voice.status, voice.busy, problems, blockingUnavailable, relevantPending, activeGroup, groupAddons, launchError, launcher.view, server, catalog.isRescanning, voiceState.done, job]);

  const dock = ((): { status: StatusKey; word: string } => {
    if (isLaunching) return { status: "doing", word: "Starting Arma 3" };
    if (job?.kind === "sync") return { status: "doing", word: `Syncing ${syncPercent(job.progress)}%` };
    if (job?.kind === "check") return { status: "doing", word: "Checking for updates" };
    if (arma === "locating") return { status: "doing", word: "Locating Arma 3" };
    if (arma === "missing") return { status: "exception", word: "Arma 3 not found" };
    if (launchError) return { status: "exception", word: "Launch failed" };
    if (blockingUnavailable.length) return { status: "exception", word: blockingUnavailable.every((addon) => addon.kind === "dlc") ? "DLC required" : "Mods missing" };
    if (repos.pendingIds.length) return { status: "doing", word: `${plural(repos.pendingIds.length, "update")} pending` };
    if (problems.length) return { status: "exception", word: plural(problems.length, "problem") };
    return { status: "done", word: "Ready" };
  })();

  const launchBlocked = isLaunching || syncing || arma === "missing" || blockingUnavailable.length > 0;
  const launchTitle = arma === "missing" ? "Arma 3 wasn't found" : blockingUnavailable.length ? "Some mods in this group aren't installed" : syncing ? "Wait for the sync to finish" : launchError ?? "Launch Arma 3";

  const groupItems: MenuEntry[] = groups.groups.map((group) => ({ label: group.name, sub: idSummary(group.addonIds), checked: group.id === activeGroup.id, onSelect: () => groups.setActiveGroupId(group.id) }));
  const serverItems: MenuEntry[] = [
    { label: "No server", sub: "Start at the main menu", checked: !selection.selectedServerId, onSelect: () => selection.setSelectedServerId(null) },
    ...(launcher.settings?.servers ?? []).map((item) => ({ label: item.name, sub: `${item.address}:${item.port}`, checked: item.id === selection.selectedServerId, onSelect: () => selection.setSelectedServerId(item.id) })),
    "separator",
    { label: "Manage Servers", onSelect: () => setScreen("launch") },
  ];
  const profileItems: MenuEntry[] = [
    { label: "Automatic", sub: "Arma picks the profile", checked: !selection.playerProfile, onSelect: () => selection.setPlayerProfile("") },
    ...(launcher.settings?.playerProfiles ?? []).map((profile) => ({ label: profile, checked: profile === selection.playerProfile, onSelect: () => selection.setPlayerProfile(profile) })),
    "separator",
    { label: "Manage Profiles", onSelect: () => setScreen("launch") },
  ];
  const groupLabel = `${activeGroup.name}. ${groupSummary(groupAddons)}`;
  const serverLabel = server?.name ?? "No server";
  const profileLabel = selection.playerProfile || "Automatic profile";

  function navigate(event: KeyboardEvent<HTMLElement>) {
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = screens.findIndex((item) => item.id === screen);
    const next = event.key === "Home" ? 0 : event.key === "End" ? screens.length - 1 : (index + (event.key === "ArrowDown" ? 1 : screens.length - 1)) % screens.length;
    setScreen(screens[next].id);
    event.currentTarget.querySelectorAll<HTMLButtonElement>(".k-nav-item")[next]?.focus();
  }

  const updateLabel = syncing ? `Syncing ${syncPercent(job.progress)}%` : isLaunching ? "Starting…" : "Update And Launch";

  return <div className="as-app">
    <ResizeGrips />
    <nav className="as-rail" aria-label="Main" onKeyDown={navigate} data-tauri-drag-region>
      <span className="label as-mark" data-tauri-drag-region>A3</span>
      {screens.map((item) => <button key={item.id} type="button" className="k-nav-item as-nav-item" aria-current={screen === item.id ? "page" : undefined} onClick={() => setScreen(item.id)}>
        <span className="k-nav-pill"><Icon name={item.icon} /></span>{item.label}
      </button>)}
      <span className="as-grow" data-tauri-drag-region />
      <button type="button" className="k-btn k-btn-icon" aria-label="Display settings" title="Display" onClick={() => setDisplayOpen(true)}><Icon name="more" /></button>
    </nav>

    <div className="as-body">
      <WindowBar />
      <main className="as-main">
        {screen === "play" && <Play readiness={readiness}
          pickers={<>
            <PickerRow label="Mods" value={groupLabel} items={groupItems} />
            <PickerRow label="Server" value={serverLabel} items={serverItems} />
            <PickerRow label="Profile" value={profileLabel} items={profileItems} />
          </>}
          launchButtons={relevantPending.length
            ? <>
              <button type="button" className="k-btn k-btn-primary as-launch-primary" disabled={isLaunching || syncing || arma === "missing" || blockingUnavailable.length > 0} onClick={() => void launch(true)}><Icon name="skip" />{updateLabel}</button>
              <button type="button" className="k-btn k-btn-quiet" disabled={launchBlocked || unavailable.length > 0} title={unavailable.length ? "Some mods need the update first" : undefined} onClick={() => void launch(false)}>Launch Without Updating</button>
            </>
            : <button type="button" className="k-btn k-btn-primary as-launch-primary" disabled={launchBlocked} title={launchTitle} onClick={() => void launch(false)}><Icon name="skip" />{syncing ? `Syncing ${syncPercent(job.progress)}%` : isLaunching ? "Starting…" : "Launch"}</button>}
          launchNote={relevantPending.length ? "Outdated mods may not match the server." : null} />}
        {screen === "mods" && <Mods catalog={catalog} groups={groups} repositories={repos.repositories} onOpenSources={openSources} />}
        {screen === "repos" && <Repos repos={repos} groups={groups.groups} selectedId={selectedRepositoryId} onSelect={setSelectedRepositoryId} onAdd={() => setAddRepositoryOpen(true)} onApplyModset={groups.applyRepositoryModset} />}
        {screen === "voice" && <Voice voice={voice} onOpenSources={openSources} />}
        {screen === "launch" && <Launch launcher={launcher} playerProfile={selection.playerProfile} onChooseProfile={selection.setPlayerProfile} />}
        {screen === "health" && <Health health={health} go={{ voice: () => setScreen("voice"), sources: openSources }} />}
      </main>

      {screen !== "play" && <footer className="as-dock" aria-label="Launch">
        <button type="button" className="as-dock-status" title={launchError ?? "Open Play"} onClick={() => setScreen("play")}><Status status={dock.status} cut="var(--surface)">{dock.word}</Status></button>
        <span className="as-grow" />
        <MenuButton label="Addon group used at launch" items={groupItems}>{groupLabel}</MenuButton>
        <MenuButton label="Server used at launch" items={serverItems}>{serverLabel}</MenuButton>
        <MenuButton label="Profile used at launch" items={profileItems}>{profileLabel}</MenuButton>
        <button type="button" className="k-btn k-btn-primary" disabled={launchBlocked} title={launchTitle} onClick={() => void launch(false)}><Icon name="skip" />{isLaunching ? "Starting…" : "Launch"}</button>
      </footer>}
    </div>

    <Sources open={sourcesOpen} onClose={() => setSourcesOpen(false)} catalog={catalog} repositories={repos.repositories} />
    <AddRepository open={addRepositoryOpen} onClose={() => setAddRepositoryOpen(false)} repos={repos} onAdded={(id) => {
      setAddRepositoryOpen(false);
      setSelectedRepositoryId(id);
      setScreen("repos");
      // Add And Download: read the manifest, check every mod, then sync what's missing.
      void (async () => {
        if (await repos.checkForUpdates(id, true)) {
          await new Promise((resolve) => window.setTimeout(resolve, 0));
          await repos.synchronize(id);
        }
      })();
    }} />
    <DisplaySheet open={displayOpen} onClose={() => setDisplayOpen(false)} theme={theme} setTheme={setTheme} />
  </div>;
}
