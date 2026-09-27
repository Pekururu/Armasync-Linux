import type { DiagnosticCheck, HostDependency } from "../bindings";
import type { Health as HealthState } from "../state/system";
import { openPath } from "@tauri-apps/plugin-opener";
import { bytes, fileDate, plural, tidyPath } from "../format";
import { Banner, Icon, Status, copyText } from "../ui";

/** The first shell command in a piece of advice, if it has one. */
export function commandIn(...texts: (string | undefined)[]) {
  for (const text of texts) {
    if (!text) continue;
    const quoted = text.match(/`([^`]+)`/);
    if (quoted) return quoted[1];
    const bare = text.match(/\b((?:sudo )?(?:pacman|apt|dnf|zypper|pipx|flatpak) [\w .@/+-]+?)(?=[.;,)]?(?:\s|$))/);
    if (bare) return bare[1].trim();
  }
  return null;
}

// Checks whose fix lives in a host package Armasync already knows about.
const dependencyFor: Record<string, string[]> = { protontricks: ["protontricks"], audio: ["wireplumber", "pipewire-pulse"], arma: ["steam"] };
const coveredDependencies = new Set(Object.values(dependencyFor).flat());

type Navigate = { voice: () => void; sources: () => void };

function noticeAction(check: DiagnosticCheck, go: Navigate) {
  if (check.id === "voice") return { label: "Open Voice", run: go.voice };
  if (check.id === "sources") return { label: "Open Sources", run: go.sources };
  if (check.id === "space" && check.detail.startsWith("/")) return { label: "Open Folder", run: () => void openPath(check.detail) };
  return null;
}

export default function Health({ health, go }: { health: HealthState; go: Navigate }) {
  const { report, dependencies, busy } = health;
  const checks = report?.checks ?? [];
  const problems = checks.filter((check) => check.status === "fail");
  const notices = checks.filter((check) => check.status === "warning");
  const passed = checks.filter((check) => check.status === "pass");
  const missingTools = dependencies.filter((dependency) => !dependency.installed && !coveredDependencies.has(dependency.id));
  const latestLog = report?.logs[0];

  function hintsFor(check: DiagnosticCheck) {
    return (dependencyFor[check.id] ?? []).map((id) => dependencies.find((dependency) => dependency.id === id)).filter((dependency): dependency is HostDependency => !!dependency && !dependency.installed);
  }

  return <div className="as-screen as-health">
    <header className="as-screen-head">
      <div className="as-stack-tight as-grow">
        <h1 className="title-1 as-flat">Health</h1>
        <ul className="k-legend" aria-label="Summary">
          <li data-status="exception"><Icon name="exception" /><b>{problems.length}</b> {problems.length === 1 ? "problem" : "problems"}</li>
          <li data-status="doing"><Icon name="doing" /><b>{notices.length + missingTools.length}</b> {notices.length + missingTools.length === 1 ? "notice" : "notices"}</li>
          <li data-status="done"><Icon name="done" /><b>{passed.length}</b> passed</li>
        </ul>
      </div>
      <button type="button" className="k-btn k-btn-quiet" disabled={busy !== null} onClick={() => void health.bundle()}>{busy === "bundle" ? "Collecting…" : "Support Bundle"}</button>
      <button type="button" className="k-btn k-btn-neutral" disabled={busy !== null} onClick={() => void health.run()}><Icon name="undo" />{busy === "checks" ? "Checking…" : "Run Checks"}</button>
    </header>

    {health.error && <Banner tone="danger" title="That didn't work">{health.error}</Banner>}
    {health.message && <Banner title={health.message} action={<button type="button" className="k-btn k-btn-icon" aria-label="Dismiss" onClick={health.dismissMessage}><Icon name="close" /></button>} />}

    <div className="as-health-grid">
      <div className="k-stack">
        {!report && <div className="k-card"><Status status="doing">{busy === "checks" ? "Running checks" : "No results yet"}</Status></div>}

        {problems.map((check) => {
          const hints = hintsFor(check);
          const command = commandIn(...hints.map((hint) => hint.hint), check.detail, check.summary);
          const advice = hints.map((hint) => hint.hint).join(" ") || check.detail;
          return <section key={check.id} className="k-card as-stack-loose" aria-labelledby={`problem-${check.id}`}>
            <div className="as-row-center">
              <Status status="exception" />
              <div className="as-stack-hair as-grow as-min0"><span className="headline" id={`problem-${check.id}`}>{check.label}</span><span className="subtext k-muted">{check.summary}</span></div>
            </div>
            {command
              ? <div className="as-command-box"><code className="subtext as-mono as-grow as-ellipsis" title={command}>{command}</code><button type="button" className="k-btn k-btn-quiet as-btn-compact" onClick={() => void copyText(command)}>Copy</button></div>
              : advice && <p className="subtext k-muted as-flat">{advice}</p>}
            <div className="k-actions"><button type="button" className="k-btn k-btn-primary" disabled={busy !== null} onClick={() => void health.run()}>{busy === "checks" ? "Checking…" : "Check Again"}</button></div>
          </section>;
        })}

        {(notices.length > 0 || missingTools.length > 0) && <div className="k-card k-card-flush">
          {notices.map((check) => {
            const action = noticeAction(check, go);
            return <div key={check.id} className="k-row as-static as-divided">
              <Status status="doing" />
              <div className="k-row-body"><span className="k-row-title">{check.label}: {check.summary}</span><span className="k-row-sub" title={check.detail}>{check.detail}</span></div>
              {action && <span className="k-row-trail"><button type="button" className="k-btn k-btn-quiet as-btn-compact" onClick={action.run}>{action.label}</button></span>}
            </div>;
          })}
          {missingTools.map((dependency) => {
            const command = commandIn(dependency.hint);
            return <div key={dependency.id} className="k-row as-static as-divided">
              <Status status="doing" />
              <div className="k-row-body"><span className="k-row-title">{dependency.label} isn't installed</span><span className="k-row-sub" title={dependency.hint}>Needed for {dependency.purpose}. {dependency.hint}</span></div>
              {command && <span className="k-row-trail"><button type="button" className="k-btn k-btn-quiet as-btn-compact" onClick={() => void copyText(command)}>Copy Command</button></span>}
            </div>;
          })}
        </div>}

        {report && problems.length === 0 && notices.length === 0 && missingTools.length === 0 && <div className="k-card"><Status status="done">Everything checks out</Status></div>}

        {passed.length > 0 && <details className="k-more as-more-pad">
          <summary>{plural(passed.length, "Check")} Passed<Icon name="chevron" /></summary>
          <div className="k-card k-card-flush as-more-body">
            {passed.map((check) => <div key={check.id} className="k-row as-static as-divided">
              <Status status="done" />
              <div className="k-row-body"><span className="k-row-title">{check.label}</span><span className="k-row-sub" title={check.detail}>{check.summary}{check.detail ? `. ${check.detail}` : ""}</span></div>
            </div>)}
          </div>
        </details>}
      </div>

      <div className="k-stack">
        <section className="k-card k-card-flush" aria-labelledby="folders-title">
          <div className="k-card-head"><h2 className="k-card-title" id="folders-title">Folders</h2></div>
          {report?.paths.map((item) => <button type="button" key={item.id} className="k-row as-divided" disabled={!item.available} title={item.path} onClick={() => void openPath(item.path)}>
            <div className="k-row-body"><span className="k-row-title">{item.label}</span><span className="k-row-sub">{item.available ? tidyPath(item.path) : "Not created yet"}</span></div>
            <span className="k-row-trail"><Icon name="next" /></span>
          </button>)}
          {latestLog && <button type="button" className="k-row as-divided" title={latestLog.path} onClick={() => void openPath(latestLog.path)}>
            <div className="k-row-body"><span className="k-row-title">Latest log</span><span className="k-row-sub">{latestLog.name}. {fileDate(latestLog.modified)}. {bytes(latestLog.size)}</span></div>
            <span className="k-row-trail"><Icon name="next" /></span>
          </button>}
          {report && report.logs.length > 1 && <details className="k-more as-more-pad">
            <summary>{plural(Math.min(report.logs.length, 5) - 1, "Older Log")}<Icon name="chevron" /></summary>
            <div>{report.logs.slice(1, 5).map((log) => <button type="button" key={log.path} className="k-row as-divided" title={log.path} onClick={() => void openPath(log.path)}>
              <div className="k-row-body"><span className="k-row-title as-ellipsis">{log.name}</span><span className="k-row-sub">{fileDate(log.modified)}. {bytes(log.size)}</span></div>
              <span className="k-row-trail"><Icon name="next" /></span>
            </button>)}</div>
          </details>}
          {report && report.logs.length === 0 && <div className="k-row as-static as-divided"><div className="k-row-body"><span className="k-row-title">Logs</span><span className="k-row-sub">None yet. Arma writes one each time it runs.</span></div></div>}
        </section>

        <section className="k-card k-card-flush" aria-labelledby="repairs-title">
          <div className="k-card-head"><h2 className="k-card-title" id="repairs-title">Repairs</h2></div>
          <div className="k-row as-static as-divided">
            <div className="k-row-body"><span className="k-row-title">ACRE MFC/VC140 repair</span><span className="k-row-sub">Only when ACRE shows an extension error</span></div>
            <span className="k-row-trail"><button type="button" className="k-btn k-btn-quiet as-btn-compact" disabled={busy !== null} onClick={() => void health.repair()}>{busy === "repair" ? "Repairing…" : "Run"}</button></span>
          </div>
          {report && report.backups.length === 0 && <div className="k-row as-static as-divided"><div className="k-row-body"><span className="k-row-title">Prefix backups</span><span className="k-row-sub">None yet. Made before any repair.</span></div></div>}
          {report?.backups.slice(0, 4).map((backup) => <button type="button" key={backup.path} className="k-row as-divided" title={backup.path} onClick={() => void openPath(backup.path)}>
            <div className="k-row-body"><span className="k-row-title as-ellipsis">{backup.name}</span><span className="k-row-sub">Prefix backup. {fileDate(backup.modified)}. {bytes(backup.size)}</span></div>
            <span className="k-row-trail"><Icon name="next" /></span>
          </button>)}
        </section>
      </div>
    </div>
  </div>;
}
