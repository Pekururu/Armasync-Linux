import type { DiagnosticReport, HostDependency, InstallerLaunchResult, PluginInstallResult, RuntimeSetupResult, SupportBundle, VoiceStatus } from "../bindings";
import { invoke } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";

type VoiceAction = "runtime" | "install" | "refresh" | "theme" | "start";

export function useVoice(watching: boolean) {
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [busy, setBusy] = useState<VoiceAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [runtimeResult, setRuntimeResult] = useState<RuntimeSetupResult | null>(null);

  async function refreshSilently() {
    try { setStatus(await invoke<VoiceStatus>("get_voice_status")); }
    catch { /* A manual refresh is what surfaces errors. */ }
  }

  async function refreshRunning() {
    try {
      const running = await invoke<boolean>("get_teamspeak_running");
      setStatus((current) => current ? { ...current, teamspeakRunning: running } : current);
    } catch { /* A passing process check shouldn't replace an error you can act on. */ }
  }

  useEffect(() => {
    void refreshSilently();
    const focus = () => void refreshSilently();
    const visible = () => { if (document.visibilityState === "visible") void refreshSilently(); };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", visible);
    return () => { window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", visible); };
  }, []);

  // TeamSpeak's running state is polled faster while the Voice screen is open.
  useEffect(() => {
    const interval = window.setInterval(() => void refreshRunning(), watching ? 1500 : 3000);
    return () => window.clearInterval(interval);
  }, [watching]);

  async function refresh() {
    setBusy((current) => current ?? "refresh");
    try { setStatus(await invoke<VoiceStatus>("get_voice_status")); setError(null); }
    catch (cause) { setError(String(cause)); }
    finally { setBusy((current) => current === "refresh" ? null : current); }
  }

  async function prepareRuntime() {
    const approved = await confirm("Install the Windows files TeamSpeak and ACRE need? A restore point is made first. This can take a few minutes.", { title: "Prepare Proton prefix", kind: "warning" });
    if (!approved) return;
    setBusy("runtime"); setError(null); setNotice(null); setRuntimeResult(null);
    try {
      const result = await invoke<RuntimeSetupResult>("prepare_voice_runtime");
      setRuntimeResult(result);
      if (result.success) setNotice("The prefix is ready for TeamSpeak.");
      await refresh();
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(null); }
  }

  async function installTeamSpeak() {
    const approved = await confirm("Download and open the official TeamSpeak 3 installer? A restore point is made first.", { title: "Install TeamSpeak 3", kind: "warning" });
    if (!approved) return;
    setBusy("install"); setError(null); setNotice(null);
    try {
      await invoke<InstallerLaunchResult>("install_teamspeak");
      setNotice("The installer is open. Choose “Install for all users”, keep the default folder, then check again.");
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(null); }
  }

  async function setDarkTheme(installed: boolean) {
    setBusy("theme"); setError(null); setNotice(null);
    try {
      await invoke<PluginInstallResult>(installed ? "install_teamspeak_dark_theme" : "remove_teamspeak_dark_theme");
      setNotice(installed
        ? "Dark skin installed. In TeamSpeak, pick “Armasync Dark” under Tools → Options → Design, then restart TeamSpeak."
        : "Dark skin removed. Restart TeamSpeak if it was in use.");
      await refresh();
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(null); }
  }

  async function startTeamSpeak() {
    setBusy("start"); setError(null);
    try {
      await invoke("launch_teamspeak");
      window.setTimeout(() => void refreshRunning(), 1800);
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(null); }
  }

  return { status, busy, error, notice, runtimeResult, refresh, prepareRuntime, installTeamSpeak, setDarkTheme, startTeamSpeak, dismissNotice: () => setNotice(null) };
}

export type Voice = ReturnType<typeof useVoice>;

export function useHealth() {
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [dependencies, setDependencies] = useState<HostDependency[]>([]);
  const [busy, setBusy] = useState<"checks" | "bundle" | "repair" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setBusy("checks"); setError(null);
    try {
      const [next, deps] = await Promise.all([invoke<DiagnosticReport>("run_diagnostics"), invoke<HostDependency[]>("host_dependencies").catch(() => [] as HostDependency[])]);
      setReport(next);
      setDependencies(deps);
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(null); }
  }

  useEffect(() => { void run(); }, []);

  async function bundle() {
    setBusy("bundle"); setError(null); setMessage(null);
    try {
      const result = await invoke<SupportBundle>("collect_support_bundle");
      setMessage(`Support bundle saved with ${result.includedFiles} files.`);
      await openPath(result.archive).catch(() => undefined);
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(null); }
  }

  async function repair() {
    const approved = await confirm("Only use this when an ACRE error mentions MFC or VC140. Make a restore point and install the repair now?", { title: "ACRE MFC/VC140 repair", kind: "warning" });
    if (!approved) return;
    setBusy("repair"); setError(null); setMessage(null);
    try {
      const result = await invoke<RuntimeSetupResult>("install_mfc140_repair");
      if (result.success) setMessage("ACRE repair installed.");
      else setError(`Repair failed: ${result.components[0]?.detail ?? "open the diagnostic log"}`);
      await run();
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(null); }
  }

  return { report, dependencies, busy, error, message, run, bundle, repair, dismissMessage: () => setMessage(null) };
}

export type Health = ReturnType<typeof useHealth>;
