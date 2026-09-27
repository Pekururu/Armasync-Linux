import type { VoiceStatus } from "../bindings";
import type { Voice as VoiceState } from "../state/system";
import { openPath } from "@tauri-apps/plugin-opener";
import type { CSSProperties, ReactNode } from "react";
import { Banner, Icon, Status, type StatusKey } from "../ui";

type Step = { id: string; title: string; done: boolean; doneSub: string; body: ReactNode; actions: ReactNode; futureSub: string };

/** How far voice setup is, for the Voice screen and the Play readiness row. */
export function voiceProgress(status: VoiceStatus | null) {
  const radios = status?.radioPlugins.filter((radio) => radio.modDirectory) ?? [];
  const prefix = !!status?.prefixInitialized && !!status.runtimeComponents.every((item) => item.installed);
  const mods = radios.length > 0 && !!status?.cbaDirectory;
  const teamspeak = !!status?.teamspeakInstalled;
  const ready = !!status?.ready;
  return { radios, steps: [prefix, mods, teamspeak, ready], done: [prefix, mods, teamspeak, ready].filter(Boolean).length };
}

export default function Voice({ voice, onOpenSources }: { voice: VoiceState; onOpenSources: () => void }) {
  const { status, busy } = voice;
  const { radios, steps: [prefixDone, modsDone, teamspeakDone, readyDone], done } = voiceProgress(status);
  const toolsReady = !!status?.protontricksAvailable && !!status?.protontricksLaunchAvailable;
  const radioNames = radios.map((radio) => radio.label).join(" and ");
  const checkAgain = <button type="button" className="k-btn k-btn-quiet" disabled={busy !== null} onClick={() => void voice.refresh()}>{busy === "refresh" ? "Checking…" : "Check Again"}</button>;
  // Notes the steps below already explain are left out of the last step.
  const leftoverNotes = (status?.notes ?? []).filter((note) => !/Proton prefix|protontricks|TeamSpeak 3\.6\.2|radio mod|CBA_A3/i.test(note));

  const steps: Step[] = [
    {
      id: "prefix", title: "Prepare Proton prefix", done: prefixDone,
      doneSub: "Done. The Windows files TeamSpeak needs are in place",
      futureSub: "Windows files TeamSpeak needs",
      body: !status?.prefixInitialized ? <p className="body as-flat">Launch Arma 3 once so Proton creates its prefix. Then check again.</p>
        : !toolsReady ? <p className="body as-flat">Install <b>protontricks</b> from your distribution first. The Flatpak version isn't enough, because Armasync needs <span className="as-mono">protontricks-launch</span> too.</p>
        : <p className="body as-flat">Armasync installs the Windows files TeamSpeak and ACRE need inside Arma's prefix. It makes a restore point first. This takes a few minutes.</p>,
      actions: status?.prefixInitialized && toolsReady
        ? <><button type="button" className="k-btn k-btn-primary" disabled={busy !== null} onClick={() => void voice.prepareRuntime()}>{busy === "runtime" ? "Preparing…" : "Prepare Prefix"}</button>{checkAgain}</>
        : checkAgain,
    },
    {
      id: "mods", title: "Radio mod and CBA_A3", done: modsDone,
      doneSub: `${radioNames} and CBA_A3 found`,
      futureSub: "ACRE2 or TFAR, plus CBA_A3, in your sources",
      body: <p className="body as-flat">{radios.length === 0 && !status?.cbaDirectory ? "Armasync can't find a radio mod (ACRE2 or TFAR) or CBA_A3." : radios.length === 0 ? "Armasync can't find a radio mod. Add ACRE2 or TFAR." : "Armasync can't find CBA_A3. The radio mods need it."} Add the folder that holds them under Sources, or sync your unit's repository.</p>,
      actions: <><button type="button" className="k-btn k-btn-primary" onClick={onOpenSources}>Open Sources</button>{checkAgain}</>,
    },
    {
      id: "teamspeak", title: "Install TeamSpeak 3.6.2", done: teamspeakDone,
      doneSub: "Installed in Arma's prefix",
      futureSub: "The official Windows installer",
      body: <p className="body as-flat">Armasync opens the official Windows installer inside Arma's prefix. Choose <b>Install for all users</b> and keep the default folder.</p>,
      actions: <><button type="button" className="k-btn k-btn-primary" disabled={busy !== null || !status?.prefixInitialized || !status.protontricksLaunchAvailable} onClick={() => void voice.installTeamSpeak()}>{busy === "install" ? "Opening…" : "Open Installer"}</button>{checkAgain}</>,
    },
    {
      id: "settings", title: "One-time TeamSpeak settings", done: readyDone,
      doneSub: "Radio plugin connected",
      futureSub: "Turn off gamepad hotkeys, turn on the radio plugin, check your mic",
      body: <>
        <ol className="as-steps body">
          <li>Turn off <b>Gamepad and Joystick Hotkey Support</b>.</li>
          <li>Make sure the <b>{radioNames || "ACRE2"} plugin</b> is turned on.</li>
          <li>Pick your microphone and speakers if TeamSpeak chose the wrong ones.</li>
        </ol>
        {leftoverNotes.map((note) => <p key={note} className="subtext k-muted as-flat as-inline as-spaced"><Icon name="info" />{note}</p>)}
      </>,
      actions: <>{status?.teamspeakInstalled && !status.teamspeakRunning && <button type="button" className="k-btn k-btn-primary" disabled={busy !== null} onClick={() => void voice.startTeamSpeak()}>{busy === "start" ? "Starting…" : "Start TeamSpeak"}</button>}{checkAgain}</>,
    },
  ];
  const current = steps.findIndex((step) => !step.done);

  const teamspeak: { status: StatusKey; word: string } = status?.teamspeakRunning ? { status: "done", word: "TeamSpeak running" }
    : status?.teamspeakInstalled ? { status: "todo", word: "TeamSpeak off" } : { status: "todo", word: "TeamSpeak not installed" };

  return <div className="as-screen as-voice">
    <div className="as-column">
      <header className="as-screen-head as-end-align">
        <div className="as-stack-tight as-grow"><h1 className="title-1 as-flat">Voice</h1><span className="subtext k-muted">TeamSpeak 3 and your radio mod, set up for Proton</span></div>
        <Status status={teamspeak.status} cut="var(--bg)">{teamspeak.word}</Status>
        {status?.teamspeakInstalled && !status.teamspeakRunning && current === -1 && <button type="button" className="k-btn k-btn-neutral" disabled={busy !== null} onClick={() => void voice.startTeamSpeak()}>{busy === "start" ? "Starting…" : "Start TeamSpeak"}</button>}
      </header>

      <div className="k-focus-meta"><span>{done} of 4 done</span><div className="k-focus-track"><span style={{ "--p": `${done * 25}%` } as CSSProperties} /></div></div>

      {voice.error && <Banner tone="danger" title="That didn't work">{voice.error}</Banner>}
      {voice.runtimeResult && !voice.runtimeResult.success && <Banner tone="danger" title="The prefix couldn't be prepared"
        action={<button type="button" className="k-btn k-btn-quiet" onClick={() => void openPath(voice.runtimeResult!.logFile)}>Open Log</button>}>
        {voice.runtimeResult.components.filter((item) => !item.success).map((item) => item.detail).join(" ")}
      </Banner>}
      {voice.notice && <Banner title={voice.notice} action={<button type="button" className="k-btn k-btn-icon" aria-label="Dismiss" onClick={voice.dismissNotice}><Icon name="close" /></button>} />}

      {!status ? <div className="k-card"><Status status="doing">Checking voice setup</Status></div> : <div className="k-stack">
        {steps.map((step, index) => index === current
          ? <section key={step.id} className="k-card as-current-step as-stack-loose" aria-current="step">
            <div className="as-row-center"><Status status="doing" /><span className="headline as-grow">{step.title}</span><span className="caption k-muted">Step {index + 1}</span></div>
            {step.body}
            <div className="k-actions">{step.actions}</div>
          </section>
          : <div key={step.id} className={`k-card k-card-flush ${current !== -1 && index > current ? "as-future" : ""}`}>
            <div className="k-row as-static">
              <Status status={step.done ? "done" : "todo"} />
              <div className="k-row-body"><span className="k-row-title">{step.title}</span><span className="k-row-sub">{step.done ? step.doneSub : step.futureSub}</span></div>
              {step.id === "teamspeak" && step.done && <span className="k-row-trail"><button type="button" className="k-btn k-btn-quiet as-btn-compact" disabled={busy !== null} onClick={() => void voice.installTeamSpeak()}>Reinstall</button></span>}
            </div>
          </div>)}
      </div>}

      <label className="k-switch-row as-divider-top">
        <span className="k-switch-text"><span>Armasync Dark skin for TeamSpeak</span><span>{status?.teamspeakInstalled ? "Optional. Changes colours only." : "Install TeamSpeak first."}</span></span>
        <input type="checkbox" role="switch" className="k-switch" checked={!!status?.darkThemeInstalled} disabled={!status?.teamspeakInstalled || busy !== null} onChange={(event) => void voice.setDarkTheme(event.target.checked)} />
      </label>
    </div>
  </div>;
}
