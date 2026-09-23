// Generated from Rust. Run pnpm bindings; do not edit.

export type RepositoryInfo = { name: string, protocol: string, host: string, port: number | null, path: string | null, anonymous: boolean, sourceUrl: string, };

export type RepositorySnapshot = { repository: RepositoryInfo, manifest: ManifestSummary, publishedModsets: Array<PublishedModset>, addons: Array<AddonCatalogEntry>, };

export type ManifestSummary = { directories: number, files: number, totalBytes: number, compressedFiles: number, addonRoots: number, unhashedFiles: number, };

export type PublishedModset = { name: string, description: string, addons: Array<string>, userconfigFolders: Array<string>, };

export type AddonCatalogEntry = { id: string, name: string, remotePath: string, files: number, totalBytes: number, transferBytes: number, duplicateName: boolean, };

export type SyncPlan = { requestedAddons: Array<string>, resolvedAddons: Array<string>, missingAddons: Array<string>, ambiguousAddons: Array<string>, totalFiles: number, verifiedFiles: number, downloadFiles: number, replacementFiles: number, downloadBytes: number, finalBytes: number, operations: Array<SyncPlanItem>, };

export type SyncPlanItem = { action: SyncAction, addon: string, relativePath: string, transferBytes: number, finalBytes: number, };

export type SyncAction = "download" | "replace";

export type SyncResult = { installedFiles: number, downloadedBytes: number, destination: string, };

export type SyncPhase = "preparing" | "downloading" | "installing";

export type SyncProgress = { phase: SyncPhase, downloadedBytes: number, totalBytes: number, completedFiles: number, totalFiles: number, currentFile: string | null, };

export type CheckProgress = { phase: CheckPhase, addon: string | null, checkedFiles: number, totalFiles: number, checkedBytes: number, totalBytes: number, };

export type CheckPhase = "metadata" | "verifying";

export type VoiceRuntimeComponent = { id: string, label: string, installed: boolean, };

export type VoiceStatus = { gameDirectory: string | null, prefixDirectory: string | null, prefixInitialized: boolean, protontricksAvailable: boolean, protontricksLaunchAvailable: boolean, pipewireAvailable: boolean, audioInput: string | null, audioOutput: string | null, teamspeakExecutable: string | null, teamspeakInstalled: boolean, teamspeakRunning: boolean, pluginDirectory: string | null, cbaDirectory: string | null, radioPlugins: Array<RadioPluginStatus>, darkThemeInstalled: boolean, darkThemePath: string | null, runtimeComponents: Array<VoiceRuntimeComponent>, ready: boolean, notes: Array<string>, };

export type RuntimeComponentResult = { id: string, label: string, success: boolean, detail: string, };

export type RuntimeSetupResult = { backupArchive: string, logFile: string, components: Array<RuntimeComponentResult>, success: boolean, };

export type InstallerLaunchResult = { processId: number, backupArchive: string, installer: string, logFile: string, };

export type PluginInstallResult = { destination: string, backup: string | null, };

export type RadioPluginStatus = { id: string, label: string, modDirectory: string | null, pluginSource: string | null, pluginInstalled: boolean, pluginDestination: string | null, };

export type ProcessLaunchResult = { processId: number, logFile: string, };

export type LauncherEnvironment = { gameDirectory: string | null, executable: string | null, prefixDirectory: string | null, selectedProton: string | null, profiles: Array<string>, };

export type LauncherOptionsView = { settings: LauncherSettings, environment: LauncherEnvironment, arguments: Array<string>, commandPreview: string, };

export type DiagnosticStatus = "pass" | "warning" | "fail";

export type DiagnosticCheck = { id: string, label: string, status: DiagnosticStatus, summary: string, detail: string, };

export type DiagnosticPath = { id: string, label: string, path: string, available: boolean, };

export type DiagnosticLog = { name: string, path: string, modified: number | null, size: number, };

export type PrefixBackup = { name: string, path: string, size: number, modified: number | null, };

export type DiagnosticReport = { checks: Array<DiagnosticCheck>, paths: Array<DiagnosticPath>, logs: Array<DiagnosticLog>, backups: Array<PrefixBackup>, };

export type SupportBundle = { archive: string, includedFiles: number, };

export type LaunchAddonKind = "mod" | "dlc";

export type LaunchAddonInput = { kind: LaunchAddonKind, value: string, };

export type GroupSource = { repositoryId: string, modsetName: string, };

export type AddonGroup = { id: string, name: string, addonIds: Array<string>, source?: GroupSource | null, };

export type LaunchSelection = { activeAddonGroupId: string | null, selectedServerId: string | null, playerProfile: string | null, };

export type SavedServer = { id: string, name: string, address: string, port: number, password?: string | null, };

export type LauncherSettings = { profile: string | null, noLauncher: boolean, noSplash: boolean, skipIntro: boolean, noPause: boolean, showScriptErrors: boolean, worldEmpty: boolean, filePatching: boolean, checkSignatures: boolean, enableHt: boolean, hugePages: boolean, cpuCount: number | null, exThreads: number | null, maxMemory: number | null, playerProfiles: Array<string>, servers: Array<SavedServer>, selectedServerId: string | null, serverAddress?: string | null, serverPort?: number | null, extraArguments: Array<string>, };

export type SavedRepository = { id: string, name: string, autoconfigUrl: string, destination: string, };

export type SourceKind = "game" | "workshop" | "custom";

export type SourceStatus = "ready" | "disabled" | "missing" | "unreadable";

export type AddonSource = { id: string, name: string, path: string, kind: SourceKind, enabled: boolean, status: SourceStatus, addonCount: number, };

export type DiscoveredAddon = { id: string, name: string, folder: string, path: string, sourceKind: SourceKind, sourceId: string, workshopId: number | null, isRepository: boolean, };

export type DetectedDlc = { handle: string, name: string, appId: number, directory: string | null, creatorDlc: boolean, status: DlcStatus, };

export type DlcStatus = "installed" | "disabled" | "files_only" | "incomplete" | "unavailable";

export type DlcDetection = { gameDirectory: string | null, manifestPath: string | null, dlcs: Array<DetectedDlc>, };

export type HostDependency = { id: string, label: string, purpose: string, installed: boolean, hint: string, };

