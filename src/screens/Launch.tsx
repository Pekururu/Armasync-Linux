import type { LauncherSettings, SavedServer } from "../bindings";
import type { Launcher } from "../state/launcher";
import { confirm } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { Banner, Dialog, Icon, MenuButton, copyText, toast } from "../ui";

type Toggle = { key: keyof LauncherSettings; title: string; sub: string };

const startup: Toggle[] = [
  { key: "noLauncher", title: "Skip official launcher", sub: "Start the game straight from Armasync" },
  { key: "noSplash", title: "Skip splash screens", sub: "No publisher logos at startup" },
  { key: "skipIntro", title: "Skip menu intro", sub: "No animated world behind the main menu" },
  { key: "noPause", title: "Keep running when unfocused", sub: "Don't pause when you switch windows" },
  { key: "worldEmpty", title: "Start with an empty world", sub: "Faster main menu" },
];

const advanced: Toggle[] = [
  { key: "showScriptErrors", title: "Show script errors", sub: "Useful when you build missions or mods" },
  { key: "filePatching", title: "File patching", sub: "Allow unpacked development files" },
  { key: "checkSignatures", title: "Check signatures", sub: "Verify addon signatures at startup" },
  { key: "enableHt", title: "Hyper-threading", sub: "Let Arma use hyper-threaded cores" },
  { key: "hugePages", title: "Huge pages", sub: "Use large memory pages when available" },
];

function SwitchRow({ toggle, settings, update }: { toggle: Toggle; settings: LauncherSettings; update: Launcher["update"] }) {
  return <label className="k-switch-row as-divided-switch">
    <span className="k-switch-text"><span>{toggle.title}</span><span>{toggle.sub}</span></span>
    <input type="checkbox" role="switch" className="k-switch" checked={Boolean(settings[toggle.key])} onChange={(event) => update(toggle.key, event.target.checked as never)} />
  </label>;
}

function NumberField({ id, label, value, min, max, onChange }: { id: string; label: string; value: number | null; min: number; max?: number; onChange: (value: number | null) => void }) {
  return <div className="k-field"><label className="k-field-label" htmlFor={id}>{label}</label>
    <input id={id} className="k-input k-num" type="number" min={min} max={max} value={value ?? ""} placeholder="Automatic" onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)} /></div>;
}

export default function Launch({ launcher, playerProfile, onChooseProfile }: { launcher: Launcher; playerProfile: string; onChooseProfile: (profile: string) => void }) {
  const { settings, view, update } = launcher;
  const [serverEditor, setServerEditor] = useState<{ server: SavedServer; isNew: boolean } | null>(null);
  const [profileEditor, setProfileEditor] = useState<{ original: string | null; value: string } | null>(null);

  if (!settings) return <div className="as-screen as-center-screen"><div className="k-empty"><Icon name="settings" /><p className="k-empty-title">{launcher.loadError ? "Couldn't load launch settings" : "Loading launch settings"}</p>{launcher.loadError && <p className="k-empty-text">{launcher.loadError}</p>}</div></div>;

  const detected = view?.environment.profiles ?? [];
  const profileTaken = !!profileEditor && settings.playerProfiles.some((profile) => profile.toLocaleLowerCase() === profileEditor.value.trim().toLocaleLowerCase() && profile !== profileEditor.original);
  const serverValid = !!serverEditor && !!serverEditor.server.name.trim() && !!serverEditor.server.address.trim() && serverEditor.server.port >= 1 && serverEditor.server.port <= 65535;

  function commitProfile() {
    if (!settings || !profileEditor?.value.trim() || profileTaken) return;
    const value = profileEditor.value.trim();
    launcher.setSettings({ ...settings, playerProfiles: profileEditor.original === null ? [...settings.playerProfiles, value] : settings.playerProfiles.map((profile) => profile === profileEditor.original ? value : profile) });
    if (profileEditor.original !== null && playerProfile === profileEditor.original) onChooseProfile(value);
    setProfileEditor(null);
  }

  async function removeProfile(profile: string) {
    const approved = await confirm(`Remove “${profile}” from the list? Arma's profile files stay on disk.`, { title: "Remove player profile", kind: "warning" });
    if (!approved || !settings) return;
    launcher.setSettings({ ...settings, playerProfiles: settings.playerProfiles.filter((item) => item !== profile) });
  }

  function commitServer() {
    if (!settings || !serverEditor || !serverValid) return;
    const saved = { ...serverEditor.server, name: serverEditor.server.name.trim(), address: serverEditor.server.address.trim() };
    launcher.setSettings({ ...settings, servers: serverEditor.isNew ? [...settings.servers, saved] : settings.servers.map((item) => item.id === saved.id ? saved : item) });
    setServerEditor(null);
  }

  async function removeServer(server: SavedServer) {
    const approved = await confirm(`Remove “${server.name}” from Armasync?`, { title: "Remove saved server", kind: "warning" });
    if (!approved || !settings) return;
    launcher.setSettings({ ...settings, servers: settings.servers.filter((item) => item.id !== server.id) });
  }

  return <div className="as-screen as-launch">
    <header className="as-screen-head">
      <div className="as-stack-tight as-grow"><h1 className="title-1 as-flat">Launch</h1><span className="subtext k-muted" aria-live="polite">{launcher.saveError ? "Couldn't save. Your changes stay here and will retry." : launcher.saving ? "Saving…" : "Saved automatically"}</span></div>
      <button type="button" className="k-btn k-btn-quiet" onClick={() => void launcher.reset().then((done) => { if (done) toast("Defaults restored"); })}><Icon name="undo" />Reset To Defaults</button>
    </header>
    {launcher.saveError && <Banner tone="danger" title="Couldn't save launch settings">{launcher.saveError}</Banner>}

    <div className="as-launch-grid">
      <section className="k-card as-flex-col" aria-labelledby="startup-title">
        <h2 className="k-card-title as-card-title-gap" id="startup-title">Startup</h2>
        {startup.map((toggle) => <SwitchRow key={toggle.key} toggle={toggle} settings={settings} update={update} />)}
        <details className="k-more as-divider-top">
          <summary>Performance And Debugging<Icon name="chevron" /></summary>
          <div className="as-stack-loose as-more-body">
            <div>{advanced.map((toggle) => <SwitchRow key={toggle.key} toggle={toggle} settings={settings} update={update} />)}</div>
            <div className="as-number-grid">
              <NumberField id="cpu-count" label="CPU count" value={settings.cpuCount} min={1} max={255} onChange={(value) => update("cpuCount", value)} />
              <NumberField id="ex-threads" label="Extra threads" value={settings.exThreads} min={0} max={7} onChange={(value) => update("exThreads", value)} />
              <NumberField id="max-memory" label="Max memory (MB)" value={settings.maxMemory} min={512} onChange={(value) => update("maxMemory", value)} />
            </div>
            <div className="k-field">
              <label className="k-field-label" htmlFor="extra-arguments">Additional arguments</label>
              <textarea id="extra-arguments" className="k-textarea as-mono" value={settings.extraArguments.join("\n")} placeholder="-someParameter=value" onChange={(event) => update("extraArguments", event.target.value.split("\n").filter((line) => line.length > 0))} />
              <span className="k-field-help">One complete argument per line.</span>
            </div>
          </div>
        </details>
      </section>

      <div className="k-stack">
        <section className="k-card k-card-flush" aria-labelledby="profiles-title">
          <div className="k-card-head"><h2 className="k-card-title" id="profiles-title">Profiles</h2><button type="button" className="k-btn k-btn-quiet as-btn-compact" onClick={() => setProfileEditor({ original: null, value: "" })}><Icon name="plus" />Add</button></div>
          {settings.playerProfiles.map((profile) => <div key={profile} className="k-row as-divided" role="button" tabIndex={0} aria-pressed={playerProfile === profile}
            onClick={() => onChooseProfile(playerProfile === profile ? "" : profile)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onChooseProfile(playerProfile === profile ? "" : profile); } }}>
            <div className="k-row-body"><span className="k-row-title as-ellipsis">{profile}</span><span className="k-row-sub">{[playerProfile === profile && "Used at launch", detected.includes(profile) ? "Found in Arma's profile folder" : "Created on first launch"].filter(Boolean).join(". ")}</span></div>
            <span className="k-row-trail">
              {playerProfile === profile && <Icon name="check" />}
              <span onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}><MenuButton className="k-btn k-btn-icon" label={`Actions for ${profile}`} title="More" items={[
                { label: "Edit", onSelect: () => setProfileEditor({ original: profile, value: profile }) },
                { label: "Remove", sub: "Arma's files stay on disk", onSelect: () => void removeProfile(profile) },
              ]} /></span>
            </span>
          </div>)}
          {settings.playerProfiles.length === 0 && <div className="k-empty"><p className="k-empty-title">No profiles yet</p><p className="k-empty-text">Add the name you play under. Arma picks one if you don't.</p></div>}
        </section>

        <section className="k-card k-card-flush" aria-labelledby="servers-title">
          <div className="k-card-head"><h2 className="k-card-title" id="servers-title">Servers</h2><button type="button" className="k-btn k-btn-quiet as-btn-compact" onClick={() => setServerEditor({ isNew: true, server: { id: crypto.randomUUID(), name: "", address: "", port: 2302, password: null } })}><Icon name="plus" />Add</button></div>
          {settings.servers.map((server) => <div key={server.id} className="k-row as-static as-divided">
            <div className="k-row-body"><span className="k-row-title as-ellipsis">{server.name}</span><span className="k-row-sub k-num">{server.address}:{server.port}{server.password ? ". Password saved" : ""}</span></div>
            <span className="k-row-trail"><MenuButton className="k-btn k-btn-icon" label={`Actions for ${server.name}`} title="More" items={[
              { label: "Edit", onSelect: () => setServerEditor({ isNew: false, server: { ...server } }) },
              { label: "Remove", onSelect: () => void removeServer(server) },
            ]} /></span>
          </div>)}
          {settings.servers.length === 0 && <div className="k-empty"><p className="k-empty-title">No servers yet</p><p className="k-empty-text">Add one to join it straight from launch.</p></div>}
        </section>
      </div>
    </div>

    <section className="k-card as-sunken as-command" aria-label="Launch command">
      <div className="as-stack-hair as-grow as-min0">
        <span className="caption k-muted">Launch command{view?.environment.selectedProton ? `. ${view.environment.selectedProton}` : ""}</span>
        <code className="subtext as-mono as-ellipsis" title={view?.commandPreview}>{view?.commandPreview ?? "…"}</code>
      </div>
      <button type="button" className="k-btn k-btn-neutral" disabled={!view?.commandPreview} onClick={() => view && void copyText(view.commandPreview)}>Copy</button>
    </section>

    <Dialog open={!!profileEditor} onClose={() => setProfileEditor(null)} eyebrow="Player profile" title={profileEditor?.original === null ? "Add profile" : "Edit profile"}
      actions={<>
        <button type="button" className="k-btn k-btn-quiet" onClick={() => setProfileEditor(null)}>Cancel</button>
        <button type="button" className="k-btn k-btn-primary" disabled={!profileEditor?.value.trim() || profileTaken} onClick={commitProfile}>{profileEditor?.original === null ? "Add Profile" : "Save Profile"}</button>
      </>}>
      <div className="k-field" data-invalid={profileTaken || undefined}>
        <label className="k-field-label" htmlFor="profile-name">Player name</label>
        <input id="profile-name" className="k-input" list="detected-arma-profiles" value={profileEditor?.value ?? ""} maxLength={64} autoFocus placeholder="Player name"
          onChange={(event) => profileEditor && setProfileEditor({ ...profileEditor, value: event.target.value })} onKeyDown={(event) => { if (event.key === "Enter") commitProfile(); }} />
        <datalist id="detected-arma-profiles">{detected.map((profile) => <option value={profile} key={profile} />)}</datalist>
        <span className="k-field-help">{profileTaken ? "That profile is already in the list." : "Pick a profile Arma already has, or type a new name."}</span>
      </div>
    </Dialog>

    <Dialog open={!!serverEditor} onClose={() => setServerEditor(null)} eyebrow="Server" title={serverEditor?.isNew ? "Add server" : "Edit server"}
      actions={<>
        <button type="button" className="k-btn k-btn-quiet" onClick={() => setServerEditor(null)}>Cancel</button>
        <button type="button" className="k-btn k-btn-primary" disabled={!serverValid} onClick={commitServer}>{serverEditor?.isNew ? "Add Server" : "Save Server"}</button>
      </>}>
      {serverEditor && <>
        <div className="k-field"><label className="k-field-label" htmlFor="server-name">Name</label><input id="server-name" className="k-input" value={serverEditor.server.name} autoFocus placeholder="Unit server" onChange={(event) => setServerEditor({ ...serverEditor, server: { ...serverEditor.server, name: event.target.value } })} /></div>
        <div className="as-address-grid">
          <div className="k-field"><label className="k-field-label" htmlFor="server-address">Address</label><input id="server-address" className="k-input" value={serverEditor.server.address} placeholder="play.example.org" onChange={(event) => setServerEditor({ ...serverEditor, server: { ...serverEditor.server, address: event.target.value } })} /></div>
          <div className="k-field"><label className="k-field-label" htmlFor="server-port">Port</label><input id="server-port" className="k-input k-num" type="number" min={1} max={65535} value={serverEditor.server.port} onChange={(event) => setServerEditor({ ...serverEditor, server: { ...serverEditor.server, port: Number(event.target.value) } })} /></div>
        </div>
        <div className="k-field"><label className="k-field-label" htmlFor="server-password">Password</label><input id="server-password" className="k-input" type="password" autoComplete="off" value={serverEditor.server.password ?? ""} placeholder="No password" onChange={(event) => setServerEditor({ ...serverEditor, server: { ...serverEditor.server, password: event.target.value || null } })} /><span className="k-field-help">Optional. Stored on this computer only.</span></div>
      </>}
    </Dialog>
  </div>;
}
