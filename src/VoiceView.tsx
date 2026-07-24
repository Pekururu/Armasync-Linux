import { invoke } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";

type RuntimeComponent = { id: string; label: string; installed: boolean };
type VoiceStatus = {
  gameDirectory: string | null; prefixDirectory: string | null; prefixInitialized: boolean;
  protontricksAvailable: boolean; protontricksLaunchAvailable: boolean; pipewireAvailable: boolean;
  audioInput: string | null; audioOutput: string | null;
  teamspeakExecutable: string | null; teamspeakInstalled: boolean; teamspeakRunning: boolean;
  pluginDirectory: string | null; acreDirectory: string | null; cbaDirectory: string | null;
  acrePluginSource: string | null; acrePluginInstalled: boolean; acrePluginDestination: string | null;
  darkThemeInstalled: boolean; darkThemePath: string | null;
  runtimeComponents: RuntimeComponent[]; ready: boolean; notes: string[];
};
type RuntimeResult = { backupArchive: string; logFile: string; components: Array<{ id: string; label: string; success: boolean; detail: string }>; success: boolean };
type InstallerResult = { processId: number; backupArchive: string; installer: string; logFile: string };
type PluginResult = { destination: string; backup: string | null };
type LaunchResult = { processId: number; logFile: string };
type VoiceAction = "runtime" | "install" | "plugin" | "launch" | "refresh" | "theme";

function VIcon({ name }: { name: "voice" | "check" | "warning" | "refresh" | "play" | "download" | "link" | "audio" | "folder" | "tools" }) {
  const paths = {
    voice: <><path d="M4 10v4h4l5 4V6L8 10z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></>,
    check: <path d="m5 12 4 4L19 6"/>, warning: <><path d="m12 3 9 17H3z"/><path d="M12 9v4m0 3h.01"/></>,
    refresh: <><path d="M20 12a8 8 0 1 1-2.3-5.7L20 8"/><path d="M20 3v5h-5"/></>, play: <path d="m8 5 11 7-11 7z"/>,
    download: <><path d="M12 4v11m-4-4 4 4 4-4M5 20h14"/></>, link: <><path d="M10 13a4 4 0 0 0 5.7.1l2.4-2.4A4 4 0 0 0 12.4 5L11 6.4"/><path d="M14 11a4 4 0 0 0-5.7-.1l-2.4 2.4A4 4 0 0 0 11.6 19l1.4-1.4"/></>,
    audio: <><path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></>, folder: <path d="M3 7.5h7l2-2h9v13H3z"/>,
    tools: <><path d="m14 6 4-2 2 2-2 4-3 1-5 9-3-2 5-8z"/><path d="m5 5 4 4"/></>,
  };
  return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function StateMark({ ok }: { ok: boolean }) { return <span className={`voice-state-mark ${ok ? "ok" : "pending"}`}><VIcon name={ok ? "check" : "warning"}/></span>; }

export default function VoiceView({ active }: { active: boolean }) {
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [busy, setBusy] = useState<VoiceAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runtimeResult, setRuntimeResult] = useState<RuntimeResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    void refreshSilently();
    const interval = window.setInterval(() => void refreshRunningState(), 1500);
    const handleFocus = () => void refreshSilently();
    const handleVisibility = () => { if (document.visibilityState === "visible") void refreshSilently(); };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [active]);

  async function refreshSilently() {
    try { setStatus(await invoke<VoiceStatus>("get_voice_status")); }
    catch { /* Manual refresh remains responsible for surfacing diagnostic errors. */ }
  }

  async function refreshRunningState() {
    try {
      const running = await invoke<boolean>("get_teamspeak_running");
      setStatus((current) => current ? { ...current, teamspeakRunning: running } : current);
    } catch { /* A transient process check should not replace actionable UI errors. */ }
  }

  async function refresh() {
    setBusy((current) => current ?? "refresh");
    try { setStatus(await invoke<VoiceStatus>("get_voice_status")); setError(null); }
    catch (cause) { setError(String(cause)); }
    finally { setBusy((current) => current === "refresh" ? null : current); }
  }

  async function prepareRuntime() {
    const approved = await confirm("Prepare the compatibility files needed by TeamSpeak and ACRE? A restore point will be created first, and this can take several minutes.", { title: "Prepare voice compatibility", kind: "warning" });
    if (!approved) return;
    setBusy("runtime"); setError(null); setNotice(null); setRuntimeResult(null);
    try {
      const result = await invoke<RuntimeResult>("prepare_voice_runtime");
      setRuntimeResult(result);
      setNotice(result.success ? "Voice compatibility is ready." : "Compatibility setup could not finish. Diagnostic details are available below.");
      await refresh();
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(null); }
  }

  async function installTeamSpeak() {
    const approved = await confirm("Download and open the official TeamSpeak 3 installer? A restore point will be created first.", { title: "Install TeamSpeak 3", kind: "warning" });
    if (!approved) return;
    setBusy("install"); setError(null); setNotice(null);
    try {
      await invoke<InstallerResult>("install_teamspeak");
      setNotice("The installer is open. Choose “Install for all users”, keep the default folder, then refresh this page.");
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(null); }
  }

  async function installPlugin() {
    setBusy("plugin"); setError(null); setNotice(null);
    try {
      const result = await invoke<PluginResult>("install_acre_plugin");
      setNotice(`ACRE is connected to TeamSpeak.${result.backup ? " The previous plugin was safely backed up." : ""}`);
      await refresh();
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(null); }
  }

  async function launchTeamSpeak() {
    setBusy("launch"); setError(null); setNotice(null);
    try {
      await invoke<LaunchResult>("launch_teamspeak");
      setNotice("TeamSpeak started.");
      window.setTimeout(() => void refresh(), 1800);
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(null); }
  }

  async function changeDarkTheme(remove = false) {
    setBusy("theme"); setError(null); setNotice(null);
    try {
      await invoke<PluginResult>(remove ? "remove_teamspeak_dark_theme" : "install_teamspeak_dark_theme");
      setNotice(remove
        ? "The optional dark theme was removed. Restart TeamSpeak if it was active."
        : "Dark theme installed. In TeamSpeak, select “Arma Launcher Dark” under Tools → Options → Design, then restart TeamSpeak.");
      await refresh();
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(null); }
  }

  const runtimesReady = status?.runtimeComponents.every((item) => item.installed) ?? false;
  const toolsReady = !!status?.protontricksAvailable && !!status?.protontricksLaunchAvailable;
  const bridgeReady = !!status?.acreDirectory && !!status?.cbaDirectory && !!status?.acrePluginInstalled;

  return <section className={`workspace voice-workspace ${active ? "" : "tab-hidden"}`}>
    <div className="workspace-heading"><div><h1>ACRE</h1><p>Set up TeamSpeak voice integration for Arma, then start it from here.</p></div><div className="heading-actions"><button className="button quiet" type="button" disabled={busy !== null} onClick={() => void refresh()}><VIcon name="refresh"/> {busy === "refresh" ? "Checking…" : "Refresh"}</button></div></div>

    <div className={`voice-readiness ${status?.ready ? "ready" : "setup"}`}><span className="voice-readiness-icon"><VIcon name="voice"/></span><div><span className="eyebrow">Voice status</span><strong>{status?.ready ? "Ready to play" : "A few setup steps remain"}</strong><small>{status?.ready ? "TeamSpeak and ACRE are connected and ready." : "Work through the setup list below. The launcher handles the technical details."}</small></div><span className={`voice-live ${status?.teamspeakRunning ? "online" : ""}`}>{status?.teamspeakRunning ? "Running" : "Not running"}</span></div>

    {!!status?.notes.length && <div className="voice-notes"><span className="eyebrow">Before you start</span><ul>{status.notes.map((note) => <li key={note}><StateMark ok={false}/><span>{note}</span></li>)}</ul></div>}

    <div className="voice-simple-layout">
      <section className="voice-setup-list">
        <header><div><span className="eyebrow">Setup</span><h2>Get voice working</h2></div><span>{[runtimesReady, !!status?.teamspeakInstalled, bridgeReady].filter(Boolean).length} of 3 complete</span></header>

        <article className={runtimesReady ? "complete" : ""}>
          <span className="step-number">1</span><StateMark ok={runtimesReady}/><div><h3>Prepare compatibility</h3><p>{runtimesReady ? "Everything TeamSpeak needs is installed." : !status?.prefixInitialized ? "Launch Arma once before continuing." : !toolsReady ? "Missing host packages — see “Before you start” above." : "Install the required compatibility files."}</p></div><button className="button" type="button" disabled={!status?.prefixInitialized || !toolsReady || busy !== null || runtimesReady} onClick={() => void prepareRuntime()}><VIcon name="tools"/>{busy === "runtime" ? "Preparing…" : runtimesReady ? "Done" : "Prepare"}</button>
        </article>

        <article className={status?.teamspeakInstalled ? "complete" : ""}>
          <span className="step-number">2</span><StateMark ok={!!status?.teamspeakInstalled}/><div><h3>Install TeamSpeak 3</h3><p>{status?.teamspeakInstalled ? "TeamSpeak is installed and ready to launch." : "The launcher will open the official installer for you."}</p></div><button className="button" type="button" disabled={!status?.prefixInitialized || !status?.protontricksLaunchAvailable || busy !== null} onClick={() => void installTeamSpeak()}><VIcon name="download"/>{busy === "install" ? "Opening…" : status?.teamspeakInstalled ? "Reinstall" : "Install"}</button>
        </article>

        <article className={bridgeReady ? "complete" : ""}>
          <span className="step-number">3</span><StateMark ok={bridgeReady}/><div><h3>Connect ACRE</h3><p>{bridgeReady ? "ACRE is connected to TeamSpeak." : !status?.acreDirectory || !status?.cbaDirectory ? "Install ACRE2 and CBA_A3 from your repository first." : status?.teamspeakRunning ? "Close TeamSpeak to install the ACRE plugin." : "Install the ACRE plugin into TeamSpeak."}</p></div><button className="button" type="button" disabled={!status?.teamspeakInstalled || !status?.acrePluginSource || !status?.cbaDirectory || !!status?.teamspeakRunning || busy !== null} onClick={() => void installPlugin()}><VIcon name="link"/>{busy === "plugin" ? "Connecting…" : bridgeReady ? "Update" : "Connect"}</button>
        </article>

        {(notice || error || (runtimeResult && !runtimeResult.success)) && <div className="voice-simple-output">{notice && <p className="operation-notice">{notice}</p>}{error && <p className="operation-error">{error}</p>}{runtimeResult && !runtimeResult.success && <div className="runtime-results">{runtimeResult.components.filter((item) => !item.success).map((item) => <div key={item.id}><StateMark ok={false}/><span><strong>Compatibility setup failed</strong><small>{item.detail}</small></span></div>)}<button type="button" onClick={() => void openPath(runtimeResult.logFile)}><VIcon name="folder"/> Open diagnostic log</button></div>}</div>}
      </section>

      <aside className="voice-sidebar">
        <section className="voice-launch-card"><span className="voice-launch-icon"><VIcon name="voice"/></span><span className="eyebrow">TeamSpeak 3</span><h2>{status?.teamspeakRunning ? "Voice chat is running" : "Ready when you are"}</h2><p>{status?.teamspeakInstalled ? "Start the ACRE-compatible TeamSpeak client." : "Complete the setup before launching."}</p><button className="launch-button" type="button" disabled={!status?.teamspeakInstalled || busy !== null || !!status?.teamspeakRunning} onClick={() => void launchTeamSpeak()}><VIcon name="play"/>{busy === "launch" ? "Starting…" : status?.teamspeakRunning ? "Running" : "Start TeamSpeak"}</button></section>
        <section className="voice-audio-card"><span className="eyebrow">Audio devices</span><div><VIcon name="audio"/><span><strong>{status?.audioInput ?? "No microphone detected"}</strong><small>Microphone</small></span></div><div><VIcon name="voice"/><span><strong>{status?.audioOutput ?? "No output detected"}</strong><small>Output</small></span></div></section>
        <section className="voice-theme-card"><div className="theme-card-heading"><div><span className="eyebrow">Optional appearance</span><h2>Arma Launcher Dark</h2></div><span className="theme-swatches"><i/><i/><i/></span></div><p>A restrained dark skin matching this launcher. It changes colors only.</p>{status?.darkThemeInstalled ? <div className="theme-installed"><span><StateMark ok/><small>Installed</small></span><button type="button" disabled={busy !== null} onClick={() => void changeDarkTheme(true)}>Remove</button></div> : <button className="button" type="button" disabled={!status?.teamspeakInstalled || busy !== null} onClick={() => void changeDarkTheme()}>{busy === "theme" ? "Installing…" : "Install dark theme"}</button>}</section>
        <section><span className="eyebrow">One-time TeamSpeak settings</span><ol><li><span>1</span><p>Disable <strong>Gamepad and Joystick Hotkey Support</strong>.</p></li><li><span>2</span><p>Make sure the <strong>ACRE2 plugin</strong> is enabled.</p></li><li><span>3</span><p>Choose your microphone and output if TeamSpeak picked the wrong ones.</p></li></ol></section>
      </aside>
    </div>
  </section>;
}
