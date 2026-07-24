import { invoke } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { useEffect, useMemo, useState } from "react";

type Status = "pass" | "warning" | "fail";
type Check = { id: string; label: string; status: Status; summary: string; detail: string };
type DPath = { id: string; label: string; path: string; available: boolean };
type DLog = { name: string; path: string; modified: number | null; size: number };
type Backup = { name: string; path: string; size: number; modified: number | null };
type Report = { checks: Check[]; paths: DPath[]; logs: DLog[]; backups: Backup[] };
type Bundle = { archive: string; includedFiles: number };
type Repair = { success: boolean; logFile: string; components: Array<{ detail: string }> };

function TIcon({ name }: { name: "refresh" | "bundle" | "folder" | "log" | "backup" | "repair" | "check" | "warning" | "fail" }) {
  const paths = { refresh: <><path d="M20 12a8 8 0 1 1-2.3-5.7L20 8"/><path d="M20 3v5h-5"/></>, bundle: <><path d="m12 3 8 5-8 5-8-5z"/><path d="m4 12 8 5 8-5m-16 4 8 5 8-5"/></>, folder: <path d="M3 7.5h7l2-2h9v13H3z"/>, log: <><path d="M6 3h9l3 3v15H6z"/><path d="M9 11h6M9 15h6"/></>, backup: <><path d="M12 6a7 7 0 1 1-6.2 3.8"/><path d="M3 5v5h5M12 9v4l3 2"/></>, repair: <><path d="m14 6 4-2 2 2-2 4-3 1-5 9-3-2 5-8z"/><path d="m5 5 4 4"/></>, check: <path d="m5 12 4 4L19 6"/>, warning: <><path d="m12 3 9 17H3z"/><path d="M12 9v4m0 3h.01"/></>, fail: <><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m0-6-6 6"/></> };
  return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}
function bytes(value: number) { if (value > 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`; if (value > 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB`; return `${Math.ceil(value / 1024)} KB`; }
function date(value: number | null) { return value ? new Date(value * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Unknown date"; }

export default function TroubleshootingView({ active }: { active: boolean }) {
  const [report, setReport] = useState<Report | null>(null); const [busy, setBusy] = useState<string | null>(null); const [message, setMessage] = useState<string | null>(null); const [error, setError] = useState<string | null>(null);
  useEffect(() => { void run(); }, []); useEffect(() => { if (active && !report) void run(); }, [active, report]);
  async function run() { setBusy("checks"); setError(null); try { setReport(await invoke<Report>("run_diagnostics")); } catch (cause) { setError(String(cause)); } finally { setBusy(null); } }
  async function bundle() { setBusy("bundle"); setError(null); try { const result = await invoke<Bundle>("collect_support_bundle"); setMessage(`Support bundle created with ${result.includedFiles} files.`); await openPath(result.archive).catch(() => undefined); } catch (cause) { setError(String(cause)); } finally { setBusy(null); } }
  async function repair() { const approved = await confirm("Only use this when an ACRE error specifically mentions MFC or VC140. Create a restore point and install the repair now?", { title: "Conditional ACRE repair", kind: "warning" }); if (!approved) return; setBusy("repair"); setError(null); try { const result = await invoke<Repair>("install_mfc140_repair"); setMessage(result.success ? "ACRE runtime repair installed." : `Repair failed: ${result.components[0]?.detail ?? "open the diagnostic log"}`); await run(); } catch (cause) { setError(String(cause)); } finally { setBusy(null); } }
  const counts = useMemo(() => ({ pass: report?.checks.filter((item) => item.status === "pass").length ?? 0, warning: report?.checks.filter((item) => item.status === "warning").length ?? 0, fail: report?.checks.filter((item) => item.status === "fail").length ?? 0 }), [report]);
  return <section className={`workspace troubleshoot-workspace ${active ? "" : "tab-hidden"}`}>
    <div className="workspace-heading"><div><h1>Troubleshooting</h1><p>Check the installation, find logs, and collect useful support information.</p></div><div className="heading-actions"><button className="button quiet" type="button" disabled={busy !== null} onClick={() => void bundle()}><TIcon name="bundle"/>{busy === "bundle" ? "Collecting…" : "Support bundle"}</button><button className="button primary-small" type="button" disabled={busy !== null} onClick={() => void run()}><TIcon name="refresh"/>{busy === "checks" ? "Checking…" : "Run checks"}</button></div></div>
    <div className="trouble-summary"><div><span className={`trouble-summary-mark ${counts.fail ? "fail" : counts.warning ? "warning" : "pass"}`}><TIcon name={counts.fail ? "fail" : counts.warning ? "warning" : "check"}/></span><span><small>System status</small><strong>{counts.fail ? "Action required" : counts.warning ? "Mostly ready" : "Everything looks good"}</strong></span></div><span><strong>{counts.pass}</strong> passed</span><span><strong>{counts.warning}</strong> notices</span><span><strong>{counts.fail}</strong> problems</span></div>
    <div className="trouble-layout">
      <section className="trouble-checks"><header><div><span className="eyebrow">Health check</span><h2>Installation status</h2></div></header><div>{report?.checks.map((check) => <details className={`diagnostic-row ${check.status}`} key={check.id}><summary><span className="diagnostic-icon"><TIcon name={check.status === "pass" ? "check" : check.status === "warning" ? "warning" : "fail"}/></span><span><strong>{check.label}</strong><small>{check.summary}</small></span><i>{check.status}</i></summary>{check.detail && <p>{check.detail}</p>}</details>)}{!report && <div className="trouble-empty">{error ?? "Running system checks…"}</div>}</div></section>
      <aside className="trouble-side">
        <section><header><span className="eyebrow">Quick access</span><h2>Important folders</h2></header><div className="path-actions">{report?.paths.map((item) => <button type="button" disabled={!item.available} key={item.id} title={item.path} onClick={() => void openPath(item.path)}><TIcon name="folder"/><span><strong>{item.label}</strong><small>{item.available ? "Open folder" : "Not available yet"}</small></span></button>)}</div></section>
        <section><header><span className="eyebrow">Recent files</span><h2>Logs</h2></header><div className="trouble-file-list">{report?.logs.slice(0, 5).map((log) => <button type="button" key={log.path} onClick={() => void openPath(log.path)}><TIcon name="log"/><span><strong>{log.name}</strong><small>{date(log.modified)} · {bytes(log.size)}</small></span></button>)}{report?.logs.length === 0 && <p>No logs have been created yet.</p>}</div></section>
        <details className="trouble-maintenance"><summary><TIcon name="repair"/><span><strong>Advanced maintenance</strong><small>Backups and conditional repairs</small></span></summary><div><h3>Compatibility backups</h3>{report?.backups.slice(0, 4).map((backup) => <button type="button" key={backup.path} title={backup.path} onClick={() => void openPath(backup.path)}><TIcon name="backup"/><span><strong>{backup.name}</strong><small>{date(backup.modified)} · {bytes(backup.size)}</small></span></button>)}{report?.backups.length === 0 && <p>No launcher-created backups yet.</p>}<div className="conditional-repair"><strong>ACRE MFC/VC140 repair</strong><p>Install only when an ACRE extension error explicitly asks for it.</p><button className="button" type="button" disabled={busy !== null} onClick={() => void repair()}>{busy === "repair" ? "Repairing…" : "Run conditional repair"}</button></div></div></details>
        {(message || error) && <div className={error ? "trouble-message error" : "trouble-message"}>{error ?? message}</div>}
      </aside>
    </div>
  </section>;
}
