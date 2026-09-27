import type { AddonGroup, LaunchSelection, LauncherOptionsView, LauncherSettings } from "../bindings";
import { invoke } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";

// The launch selection is stored separately, so it never goes into the saved settings.
function comparable(settings: LauncherSettings) {
  return JSON.stringify({ ...settings, profile: null, selectedServerId: null });
}

/**
 * Launch settings save themselves shortly after each change. Launching waits
 * for `flush`, so Arma always starts with what is on screen.
 */
export function useLauncher() {
  const [view, setView] = useState<LauncherOptionsView | null>(null);
  const [settings, setSettings] = useState<LauncherSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const saved = useRef<string | null>(null);
  const latest = useRef<LauncherSettings | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  latest.current = settings;

  function adopt(next: LauncherOptionsView) {
    setView(next);
    setSettings(next.settings);
    saved.current = comparable(next.settings);
  }

  useEffect(() => {
    void invoke<LauncherOptionsView>("get_launcher_options").then((next) => { adopt(next); setLoadError(null); }).catch((cause) => setLoadError(String(cause)));
  }, []);

  // The command preview follows every change, saved or not.
  useEffect(() => {
    if (!settings) return;
    const timeout = window.setTimeout(() => {
      void invoke<LauncherOptionsView>("preview_launcher_options", { settings }).then((next) => {
        setView((current) => current ? { ...next, settings: current.settings } : next);
      }).catch(() => undefined);
    }, 120);
    return () => window.clearTimeout(timeout);
  }, [settings]);

  async function save() {
    const current = latest.current;
    if (!current || comparable(current) === saved.current) return;
    setSaving(true);
    try {
      const next = await invoke<LauncherOptionsView>("save_launcher_options", { settings: { ...current, profile: null, selectedServerId: null } });
      saved.current = comparable(current);
      setView((previous) => ({ ...next, settings: previous?.settings ?? next.settings }));
      setSaveError(null);
    } catch (cause) {
      setSaveError(String(cause));
      throw cause;
    } finally {
      setSaving(false);
    }
  }

  function run() {
    const job = (inFlight.current ?? Promise.resolve()).catch(() => undefined).then(save);
    inFlight.current = job;
    return job;
  }

  useEffect(() => {
    if (!settings || comparable(settings) === saved.current) return;
    const timeout = window.setTimeout(() => void run().catch(() => undefined), 400);
    return () => window.clearTimeout(timeout);
  }, [settings]);

  function update<K extends keyof LauncherSettings>(key: K, value: LauncherSettings[K]) {
    setSettings((current) => current ? { ...current, [key]: value } : current);
  }

  async function reset() {
    const approved = await confirm("Restore the recommended launch settings? Your addon groups stay as they are.", { title: "Reset launch settings", kind: "warning" });
    if (!approved) return false;
    try {
      adopt(await invoke<LauncherOptionsView>("reset_launcher_options"));
      setSaveError(null);
      return true;
    } catch (cause) {
      setSaveError(String(cause));
      return false;
    }
  }

  const dirty = !!settings && comparable(settings) !== saved.current;
  return { view, settings, setSettings, update, reset, flush: run, saving: saving || dirty, saveError, loadError };
}

export type Launcher = ReturnType<typeof useLauncher>;

/** Remembers the group, server and profile chosen for the next launch. */
export function useLaunchSelection(groups: AddonGroup[], groupsLoaded: boolean, settings: LauncherSettings | null, setActiveGroupId: (id: string) => void, activeGroupId: string) {
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [playerProfile, setPlayerProfile] = useState("");
  const [persisted, setPersisted] = useState<LaunchSelection | null>(null);
  const [fetched, setFetched] = useState(false);
  const [ready, setReady] = useState(false);
  const hydrated = useRef(false);

  useEffect(() => {
    void invoke<LaunchSelection>("get_launch_selection").then(setPersisted).catch(() => undefined).finally(() => setFetched(true));
  }, []);

  useEffect(() => {
    if (hydrated.current || !groupsLoaded || !settings || !fetched) return;
    hydrated.current = true;
    const preferredGroupId = persisted?.activeAddonGroupId;
    if (preferredGroupId && groups.some((group) => group.id === preferredGroupId)) setActiveGroupId(preferredGroupId);
    const preferredServerId = persisted?.selectedServerId;
    setSelectedServerId(preferredServerId && settings.servers.some((server) => server.id === preferredServerId) ? preferredServerId : null);
    const preferredProfile = persisted?.playerProfile ?? "";
    setPlayerProfile(preferredProfile && settings.playerProfiles.includes(preferredProfile) ? preferredProfile : "");
    setReady(true);
  }, [groupsLoaded, settings, fetched, persisted, groups]);

  // A removed server or profile falls back to none.
  useEffect(() => {
    if (!settings) return;
    setSelectedServerId((current) => !current || settings.servers.some((server) => server.id === current) ? current : null);
    setPlayerProfile((current) => !current || settings.playerProfiles.includes(current) ? current : "");
  }, [settings]);

  useEffect(() => {
    if (!ready) return;
    const timeout = window.setTimeout(() => {
      void invoke("save_launch_selection", { selection: { activeAddonGroupId: activeGroupId, selectedServerId, playerProfile: playerProfile || null } }).catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [activeGroupId, selectedServerId, playerProfile, ready]);

  return { selectedServerId, setSelectedServerId, playerProfile, setPlayerProfile };
}
