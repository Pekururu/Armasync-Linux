import { invoke } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useState } from "react";

type DisplayMode = "game_setting" | "windowed" | "borderless_window";
export type SavedServer = { id: string; name: string; address: string; port: number; password: string | null };
export type LauncherSettings = {
  displayMode: DisplayMode; profile: string | null; noLauncher: boolean; noSplash: boolean;
  skipIntro: boolean; noPause: boolean; showScriptErrors: boolean; worldEmpty: boolean;
  filePatching: boolean; checkSignatures: boolean; enableHt: boolean; hugePages: boolean;
  cpuCount: number | null; exThreads: number | null; maxMemory: number | null;
  playerProfiles: string[]; servers: SavedServer[]; selectedServerId: string | null;
  serverAddress?: string | null; serverPort?: number | null; extraArguments: string[];
};
export type LauncherEnvironment = { gameDirectory: string | null; executable: string | null; prefixDirectory: string | null; selectedProton: string | null; profiles: string[] };
export type OptionsView = { settings: LauncherSettings; environment: LauncherEnvironment; arguments: string[]; commandPreview: string };

function OIcon({ name }: { name: "save" | "reset" | "display" | "rocket" | "server" | "profile" | "advanced" | "check" }) {
  const paths = {
    save: <><path d="M5 4h12l2 2v14H5z"/><path d="M8 4v6h8V4M8 20v-6h8v6"/></>, reset: <><path d="M20 12a8 8 0 1 1-2.3-5.7L20 8"/><path d="M20 3v5h-5"/></>,
    display: <><rect x="3" y="4" width="18" height="13" rx="1"/><path d="M8 21h8m-4-4v4"/></>, rocket: <><path d="M14 5c3-2 5-2 5-2s0 2-2 5l-5 5-4-1-1-4z"/><path d="m8 12-3 1-2 3 5-1m4-3 1 4-3 3-1-4"/></>,
    server: <><rect x="4" y="4" width="16" height="6" rx="1"/><rect x="4" y="14" width="16" height="6" rx="1"/><path d="M8 7h.01M8 17h.01"/></>, profile: <><circle cx="12" cy="8" r="4"/><path d="M5 21a7 7 0 0 1 14 0"/></>,
    advanced: <><path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1M18.4 5.6l-2.1 2.1m-8.6 8.6-2.1 2.1"/><circle cx="12" cy="12" r="3"/></>, check: <path d="m5 12 4 4L19 6"/>,
  };
  return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="option-toggle"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)}/><span/></label>;
}

function SettingRow({ title, description, checked, onChange }: { title: string; description: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <div className="launch-setting-row"><div><strong>{title}</strong><small>{description}</small></div><Toggle checked={checked} onChange={onChange}/></div>;
}

export default function LauncherOptionsView({ active, onOptionsChanged }: { active: boolean; onOptionsChanged: (value: OptionsView, dirty: boolean) => void }) {
  const [view, setView] = useState<OptionsView | null>(null);
  const [settings, setSettings] = useState<LauncherSettings | null>(null);
  const [savedSettings, setSavedSettings] = useState<LauncherSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [serverEditor, setServerEditor] = useState<SavedServer | null>(null);
  const [profileEditor, setProfileEditor] = useState<{ original: string | null; value: string } | null>(null);
  const dirty = useMemo(() => JSON.stringify(settings) !== JSON.stringify(savedSettings), [settings, savedSettings]);

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (view && settings) onOptionsChanged({ ...view, settings }, dirty);
  }, [dirty, onOptionsChanged, settings, view]);
  useEffect(() => {
    if (!settings) return;
    const timeout = window.setTimeout(() => {
      void invoke<OptionsView>("preview_launcher_options", { settings }).then((next) => {
        setView((current) => current ? { ...next, settings: current.settings } : next);
      }).catch(() => undefined);
    }, 120);
    return () => window.clearTimeout(timeout);
  }, [settings]);
  async function load() { try { const next = await invoke<OptionsView>("get_launcher_options"); setView(next); setSettings(next.settings); setSavedSettings(next.settings); setError(null); } catch (cause) { setError(String(cause)); } }
  function update<K extends keyof LauncherSettings>(key: K, value: LauncherSettings[K]) { setSettings((current) => current ? { ...current, [key]: value } : current); setNotice(null); }
  async function persist(nextSettings: LauncherSettings, successNotice: string) { setBusy(true); setError(null); try { const next = await invoke<OptionsView>("save_launcher_options", { settings: { ...nextSettings, profile: null, selectedServerId: null } }); setView(next); setSettings(next.settings); setSavedSettings(next.settings); setNotice(successNotice); } catch (cause) { setError(String(cause)); } finally { setBusy(false); } }
  async function save() { if (settings) await persist(settings, "Configuration saved."); }
  async function reset() { const approved = await confirm("Restore the recommended launch defaults? Your addon groups are not affected.", { title: "Reset launch settings", kind: "warning" }); if (!approved) return; setBusy(true); try { const next = await invoke<OptionsView>("reset_launcher_options"); setView(next); setSettings(next.settings); setSavedSettings(next.settings); setNotice("Recommended defaults restored."); setError(null); } catch (cause) { setError(String(cause)); } finally { setBusy(false); } }
  function editServer(server?: SavedServer) { setServerEditor(server ? { ...server } : { id: crypto.randomUUID(), name: "", address: "", port: 2302, password: null }); }
  function editProfile(profile?: string) { setProfileEditor({ original: profile ?? null, value: profile ?? "" }); }
  async function commitProfile() {
    if (!settings || !profileEditor?.value.trim()) return;
    const value = profileEditor.value.trim();
    const next = { ...settings, playerProfiles: profileEditor.original === null ? [...settings.playerProfiles, value] : settings.playerProfiles.map((profile) => profile === profileEditor.original ? value : profile) };
    setSettings(next);
    setProfileEditor(null); setNotice(null);
    await persist(next, "Player profile saved.");
  }
  async function removeProfile(profile: string) { const approved = await confirm(`Remove “${profile}” from the launcher profile list? Arma's profile files will not be deleted.`, { title: "Remove player profile", kind: "warning" }); if (!approved || !settings) return; const next = { ...settings, playerProfiles: settings.playerProfiles.filter((item) => item !== profile) }; setSettings(next); await persist(next, "Player profile removed."); }
  async function commitServer() {
    if (!settings || !serverEditor || !serverEditor.name.trim() || !serverEditor.address.trim() || serverEditor.port < 1 || serverEditor.port > 65535) return;
    const savedServer = { ...serverEditor, name: serverEditor.name.trim(), address: serverEditor.address.trim() };
    const next = { ...settings, servers: settings.servers.some((item) => item.id === serverEditor.id) ? settings.servers.map((item) => item.id === serverEditor.id ? savedServer : item) : [...settings.servers, savedServer] };
    setSettings(next);
    setServerEditor(null); setNotice(null);
    await persist(next, "Server saved.");
  }
  async function removeServer(server: SavedServer) { const approved = await confirm(`Remove “${server.name}” from the launcher?`, { title: "Remove saved server", kind: "warning" }); if (!approved || !settings) return; const next = { ...settings, servers: settings.servers.filter((item) => item.id !== server.id), selectedServerId: settings.selectedServerId === server.id ? null : settings.selectedServerId }; setSettings(next); await persist(next, "Server removed."); }
  if (!settings) return <section className={`workspace options-workspace ${active ? "" : "tab-hidden"}`}><div className="options-loading">{error ?? "Loading launch settings…"}</div></section>;

  return <section className={`workspace options-workspace ${active ? "" : "tab-hidden"}`}>
    <div className="workspace-heading"><div><h1>Configuration</h1><p>Manage profiles, servers, and how Arma starts.</p></div><div className="heading-actions"><button className="button quiet" type="button" disabled={busy} onClick={() => void reset()}><OIcon name="reset"/> Defaults</button><button className="button primary-small" type="button" disabled={busy || !dirty} onClick={() => void save()}><OIcon name={dirty ? "save" : "check"}/>{busy ? "Saving…" : dirty ? "Save changes" : "Saved"}</button></div></div>
    <div className="options-environment"><span><OIcon name="rocket"/><small>Compatibility</small><strong>{view?.environment.selectedProton ?? "Steam default"}</strong></span><span><OIcon name="profile"/><small>Profiles</small><strong>{settings.playerProfiles.length}</strong></span><span><OIcon name="server"/><small>Servers</small><strong>{settings.servers.length}</strong></span><span><OIcon name="display"/><small>Display</small><strong>{settings.displayMode === "game_setting" ? "Use Arma setting" : settings.displayMode === "windowed" ? "Windowed" : "Borderless window"}</strong></span></div>
    <div className="options-layout">
      <div className="options-main">
        <section className="options-card display-card"><header><span className="option-card-icon"><OIcon name="display"/></span><div><h2>Display</h2><p>Arma remembers fullscreen and resolution itself.</p></div></header><div className="display-choices">{([ ["game_setting", "Use Arma setting", "Recommended", "Keeps your saved Fullscreen Window setting."], ["windowed", "Windowed", "", "Runs Arma in a normal resizable window."], ["borderless_window", "Borderless window", "", "Removes the border from windowed mode."] ] as const).map(([value, title, badge, detail]) => <label className={settings.displayMode === value ? "selected" : ""} key={value}><input type="radio" name="display-mode" checked={settings.displayMode === value} onChange={() => update("displayMode", value)}/><span><strong>{title}{badge && <i>{badge}</i>}</strong><small>{detail}</small></span></label>)}</div></section>
        <section className="options-card"><header><span className="option-card-icon"><OIcon name="rocket"/></span><div><h2>Startup</h2><p>Sensible defaults for regular play.</p></div></header><div className="setting-list"><SettingRow title="Skip official launcher" description="Start the game directly from this application." checked={settings.noLauncher} onChange={(value) => update("noLauncher", value)}/><SettingRow title="Skip splash screens" description="Hide publisher logos during startup." checked={settings.noSplash} onChange={(value) => update("noSplash", value)}/><SettingRow title="Skip menu intro" description="Disable the animated background world." checked={settings.skipIntro} onChange={(value) => update("skipIntro", value)}/><SettingRow title="Keep running when unfocused" description="Do not pause when switching to another window." checked={settings.noPause} onChange={(value) => update("noPause", value)}/><SettingRow title="Start with an empty world" description="Reduce work while loading the main menu." checked={settings.worldEmpty} onChange={(value) => update("worldEmpty", value)}/></div></section>
      </div>
      <div className="options-side">
        <section className="options-card compact profile-manager-card"><header><span className="option-card-icon"><OIcon name="profile"/></span><div><h2>Player profiles</h2><p>Identities available from the launch bar.</p></div><button className="server-add" type="button" disabled={busy} onClick={() => editProfile()}>+ Add</button></header><div className="managed-profile-list">{settings.playerProfiles.map((profile) => <div className="managed-profile" key={profile}><span><strong>{profile}</strong><small>{view?.environment.profiles.includes(profile) ? "Existing Arma profile" : "Created on first launch"}</small></span><span className="saved-server-actions"><button type="button" disabled={busy} onClick={() => editProfile(profile)}>Edit</button><button type="button" disabled={busy} onClick={() => void removeProfile(profile)}>Remove</button></span></div>)}{settings.playerProfiles.length === 0 && <div className="server-list-empty"><strong>No configured profiles</strong><small>Add an existing identity or create a new one.</small></div>}</div>{profileEditor && <div className="profile-editor"><strong>{profileEditor.original === null ? "Add profile" : "Edit profile"}</strong><label><span>Player name</span><input list="detected-arma-profiles" value={profileEditor.value} onChange={(event) => setProfileEditor({ ...profileEditor, value: event.target.value })} placeholder="Player name" autoFocus maxLength={64}/><datalist id="detected-arma-profiles">{view?.environment.profiles.map((profile) => <option value={profile} key={profile}/>)}</datalist></label><small>Select a detected identity or type a new name. Removing it later will not delete Arma files.</small><footer><button type="button" disabled={busy} onClick={() => setProfileEditor(null)}>Cancel</button><button type="button" disabled={busy || !profileEditor.value.trim() || settings.playerProfiles.some((profile) => profile.toLocaleLowerCase() === profileEditor.value.trim().toLocaleLowerCase() && profile !== profileEditor.original)} onClick={() => void commitProfile()}>Apply</button></footer></div>}</section>
        <section className="options-card compact server-card"><header><span className="option-card-icon"><OIcon name="server"/></span><div><h2>Server manager</h2><p>Addresses available from the launch bar.</p></div><button className="server-add" type="button" disabled={busy} onClick={() => editServer()}>+ Add</button></header><div className="server-list">{settings.servers.map((server) => <div className="saved-server" key={server.id}><span className="saved-server-address"><strong>{server.name}</strong><small>{server.address}:{server.port}{server.password ? " · Password saved" : ""}</small></span><span className="saved-server-actions"><button type="button" disabled={busy} onClick={() => editServer(server)}>Edit</button><button type="button" disabled={busy} onClick={() => void removeServer(server)}>Remove</button></span></div>)}{settings.servers.length === 0 && <div className="server-list-empty"><strong>No saved servers</strong><small>Add a server here, then choose it when launching.</small></div>}</div>{serverEditor && <div className="server-editor"><strong>{settings.servers.some((item) => item.id === serverEditor.id) ? "Edit server" : "Add server"}</strong><div><label><span>Name</span><input value={serverEditor.name} onChange={(event) => setServerEditor({ ...serverEditor, name: event.target.value })} placeholder="Unit server" autoFocus/></label><label><span>Address</span><input value={serverEditor.address} onChange={(event) => setServerEditor({ ...serverEditor, address: event.target.value })} placeholder="play.example.org"/></label><label><span>Port</span><input type="number" min="1" max="65535" value={serverEditor.port} onChange={(event) => setServerEditor({ ...serverEditor, port: Number(event.target.value) })}/></label><label className="server-editor-password"><span>Password <i>Optional · stored locally</i></span><input type="password" value={serverEditor.password ?? ""} onChange={(event) => setServerEditor({ ...serverEditor, password: event.target.value || null })} placeholder="No password" autoComplete="off"/></label></div><footer><button type="button" disabled={busy} onClick={() => setServerEditor(null)}>Cancel</button><button type="button" disabled={busy || !serverEditor.name.trim() || !serverEditor.address.trim() || serverEditor.port < 1 || serverEditor.port > 65535} onClick={() => void commitServer()}>Apply</button></footer></div>}</section>
        <details className="options-card advanced-options"><summary><span className="option-card-icon"><OIcon name="advanced"/></span><span><strong>Advanced options</strong><small>Performance, debugging, and custom arguments</small></span></summary><div className="advanced-content"><SettingRow title="Show script errors" description="Useful for mission and mod development." checked={settings.showScriptErrors} onChange={(value) => update("showScriptErrors", value)}/><SettingRow title="File patching" description="Allow unpacked development files." checked={settings.filePatching} onChange={(value) => update("filePatching", value)}/><SettingRow title="Check signatures" description="Verify loaded addon signatures at startup." checked={settings.checkSignatures} onChange={(value) => update("checkSignatures", value)}/><SettingRow title="Hyper-threading" description="Let Arma use hyper-threaded CPU cores." checked={settings.enableHt} onChange={(value) => update("enableHt", value)}/><SettingRow title="Huge pages" description="Use large memory pages when available." checked={settings.hugePages} onChange={(value) => update("hugePages", value)}/><div className="advanced-number-grid"><label><span>CPU count</span><input type="number" min="1" max="255" value={settings.cpuCount ?? ""} onChange={(event) => update("cpuCount", event.target.value ? Number(event.target.value) : null)}/></label><label><span>Extra threads</span><input type="number" min="0" max="7" value={settings.exThreads ?? ""} onChange={(event) => update("exThreads", event.target.value ? Number(event.target.value) : null)}/></label><label><span>Maximum memory (MB)</span><input type="number" min="512" value={settings.maxMemory ?? ""} onChange={(event) => update("maxMemory", event.target.value ? Number(event.target.value) : null)}/></label></div><label className="extra-arguments"><span>Additional arguments <small>One complete argument per line</small></span><textarea value={settings.extraArguments.join("\n")} onChange={(event) => update("extraArguments", event.target.value.split("\n").filter((line) => line.length > 0))} placeholder="-someParameter=value"/></label></div></details>
        <details className="command-preview"><summary>Preview launch command</summary><code>{view?.commandPreview}</code></details>
        {(error || notice) && <div className={error ? "options-message error" : "options-message"}>{error ?? notice}</div>}
      </div>
    </div>
  </section>;
}
