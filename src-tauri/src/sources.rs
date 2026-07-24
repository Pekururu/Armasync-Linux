use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SourceKind {
    Game,
    Workshop,
    Custom,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct StoredSource {
    id: String,
    name: String,
    path: String,
    kind: SourceKind,
    enabled: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
struct SourcesConfig {
    #[serde(default)]
    sources: Vec<StoredSource>,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceStatus {
    Ready,
    Disabled,
    Missing,
    Unreadable,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddonSource {
    pub id: String,
    pub name: String,
    pub path: String,
    pub kind: SourceKind,
    pub enabled: bool,
    pub status: SourceStatus,
    pub addon_count: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredAddon {
    pub id: String,
    pub name: String,
    pub folder: String,
    pub path: String,
    pub source_kind: SourceKind,
    pub source_id: String,
    pub workshop_id: Option<u64>,
    pub is_repository: bool,
}

pub fn list() -> Result<Vec<AddonSource>, String> {
    let mut config = load()?;
    let changed = remove_legacy_automatic_sources(&mut config.sources);
    if changed {
        save(&config)?;
    }
    Ok(config.sources.iter().map(inspect).collect())
}

pub fn add(path: &str) -> Result<Vec<AddonSource>, String> {
    let requested = Path::new(path);
    if !requested.is_absolute() {
        return Err("addon search directory must be an absolute path".into());
    }
    let canonical = fs::canonicalize(requested)
        .map_err(|error| format!("could not open addon search directory: {error}"))?;
    if !canonical.is_dir() {
        return Err("selected addon search path is not a directory".into());
    }

    let mut config = load()?;
    remove_legacy_automatic_sources(&mut config.sources);
    if config
        .sources
        .iter()
        .any(|source| same_path(Path::new(&source.path), &canonical))
    {
        return Err("this addon search directory is already configured".into());
    }

    let kind = classify_selected_source(&canonical);
    let name = match kind {
        SourceKind::Game => "Arma 3 directory".to_owned(),
        SourceKind::Workshop => "Steam Workshop".to_owned(),
        SourceKind::Custom => canonical
            .file_name()
            .and_then(|value| value.to_str())
            .filter(|value| !value.is_empty())
            .unwrap_or("Local addons")
            .to_owned(),
    };
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    config.sources.push(StoredSource {
        id: format!("custom-{stamp:x}"),
        name,
        path: canonical.to_string_lossy().into_owned(),
        kind,
        enabled: true,
    });
    save(&config)?;
    list()
}

pub fn add_workshop() -> Result<Vec<AddonSource>, String> {
    let installation = crate::steam::discover_arma()
        .ok_or_else(|| "could not locate the Arma 3 Steam library".to_owned())?;
    if !installation.workshop_directory.is_dir() {
        return Err("the native Steam Workshop directory for Arma 3 does not exist".into());
    }
    add(&installation.workshop_directory.to_string_lossy())
}

pub fn catalog() -> Result<Vec<DiscoveredAddon>, String> {
    let mut config = load()?;
    if remove_legacy_automatic_sources(&mut config.sources) {
        save(&config)?;
    }

    let repository_roots = repository_destination_roots();

    let mut discovered = Vec::new();
    let mut identities = HashSet::new();
    for source in config.sources.iter().filter(|source| source.enabled) {
        let root = Path::new(&source.path);
        let Ok(mod_roots) = discover_mod_roots(root, source.kind) else {
            continue;
        };
        for mod_root in mod_roots {
            let canonical = fs::canonicalize(&mod_root).unwrap_or_else(|_| mod_root.clone());
            let folder = mod_root
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("Unnamed addon")
                .to_owned();
            let workshop_id = (source.kind == SourceKind::Workshop)
                .then(|| folder.parse::<u64>().ok())
                .flatten()
                .or_else(|| metadata_workshop_id(&mod_root));
            let identity = addon_identity(source.kind, workshop_id, &canonical);
            if !identities.insert(identity) {
                continue;
            }
            let name = metadata_name(&canonical).unwrap_or_else(|| folder.clone());
            let is_repository = addon_is_repository(source.kind, &canonical, &repository_roots);
            discovered.push(DiscoveredAddon {
                id: format!("path:{}", canonical.to_string_lossy()),
                name,
                folder,
                path: canonical.to_string_lossy().into_owned(),
                source_kind: source.kind,
                source_id: source.id.clone(),
                workshop_id,
                is_repository,
            });
        }
    }
    Ok(discovered)
}

fn repository_destination_roots() -> Vec<PathBuf> {
    crate::repository_store::list()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|repository| fs::canonicalize(repository.destination).ok())
        .collect()
}

fn addon_is_repository(kind: SourceKind, canonical: &Path, repository_roots: &[PathBuf]) -> bool {
    kind == SourceKind::Custom && repository_roots.iter().any(|root| canonical.starts_with(root))
}

fn addon_identity(kind: SourceKind, workshop_id: Option<u64>, path: &Path) -> String {
    if kind == SourceKind::Workshop
        && let Some(id) = workshop_id
    {
        format!("workshop:{id}")
    } else {
        format!("path:{}", path.to_string_lossy())
    }
}

pub fn set_enabled(id: &str, enabled: bool) -> Result<Vec<AddonSource>, String> {
    let mut config = load()?;
    remove_legacy_automatic_sources(&mut config.sources);
    let source = config
        .sources
        .iter_mut()
        .find(|source| source.id == id)
        .ok_or_else(|| "addon source was not found".to_owned())?;
    source.enabled = enabled;
    save(&config)?;
    list()
}

pub fn remove(id: &str) -> Result<Vec<AddonSource>, String> {
    let mut config = load()?;
    remove_legacy_automatic_sources(&mut config.sources);
    if !config.sources.iter().any(|source| source.id == id) {
        return Err("addon source was not found".into());
    }
    config.sources.retain(|source| source.id != id);
    save(&config)?;
    list()
}

pub fn reorder(ids: &[String]) -> Result<Vec<AddonSource>, String> {
    let mut config = load()?;
    remove_legacy_automatic_sources(&mut config.sources);
    let current: HashSet<&str> = config
        .sources
        .iter()
        .map(|source| source.id.as_str())
        .collect();
    let requested: HashSet<&str> = ids.iter().map(String::as_str).collect();
    if current != requested || ids.len() != config.sources.len() {
        return Err(
            "source priority update did not contain every configured source exactly once".into(),
        );
    }

    let mut remaining = std::mem::take(&mut config.sources);
    config.sources = ids
        .iter()
        .filter_map(|id| {
            let index = remaining.iter().position(|source| &source.id == id)?;
            Some(remaining.remove(index))
        })
        .collect();
    save(&config)?;
    list()
}

fn inspect(source: &StoredSource) -> AddonSource {
    let path = Path::new(&source.path);
    let (status, addon_count) = if !source.enabled {
        (SourceStatus::Disabled, 0)
    } else if !path.is_dir() {
        (SourceStatus::Missing, 0)
    } else {
        match count_addons(path, source.kind) {
            Ok(count) => (SourceStatus::Ready, count),
            Err(()) => (SourceStatus::Unreadable, 0),
        }
    };
    AddonSource {
        id: source.id.clone(),
        name: source.name.clone(),
        path: source.path.clone(),
        kind: source.kind,
        enabled: source.enabled,
        status,
        addon_count,
    }
}

fn count_addons(root: &Path, kind: SourceKind) -> Result<usize, ()> {
    discover_mod_roots(root, kind).map(|roots| roots.len())
}

fn discover_mod_roots(root: &Path, kind: SourceKind) -> Result<Vec<PathBuf>, ()> {
    // An @-prefixed directory is an explicit Arma addon boundary. Even when
    // it contains optional addon folders, those nested folders must not be
    // promoted to independent launch entries.
    if kind == SourceKind::Custom && (has_addon_prefix(root) || looks_like_mod(root)) {
        return Ok(vec![root.to_owned()]);
    }
    let entries = fs::read_dir(root).map_err(|_| ())?;
    let mut roots: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .take(10_000)
        .filter_map(|entry| {
            let path = entry.path();
            if !path.is_dir() {
                return None;
            }
            let explicit_addon = entry.file_name().to_string_lossy().starts_with('@');
            if !explicit_addon && !looks_like_mod(&path) {
                return None;
            }
            if kind == SourceKind::Game && !explicit_addon {
                return None;
            }
            Some(path)
        })
        .collect();
    roots.sort_by_key(|path| {
        path.file_name()
            .map(|value| value.to_string_lossy().to_lowercase())
    });
    Ok(roots)
}

fn has_addon_prefix(path: &Path) -> bool {
    path.file_name()
        .is_some_and(|name| name.to_string_lossy().starts_with('@'))
}

fn looks_like_mod(path: &Path) -> bool {
    path.join("mod.cpp").is_file()
        || path.join("meta.cpp").is_file()
        || child_directory(path, "addons").is_some()
}

fn child_directory(parent: &Path, expected: &str) -> Option<PathBuf> {
    fs::read_dir(parent)
        .ok()?
        .filter_map(Result::ok)
        .find_map(|entry| {
            let is_directory = entry.file_type().ok()?.is_dir();
            let matches = entry
                .file_name()
                .to_string_lossy()
                .eq_ignore_ascii_case(expected);
            (is_directory && matches).then(|| entry.path())
        })
}

fn metadata_name(mod_root: &Path) -> Option<String> {
    let pattern = regex::Regex::new(r#"(?im)^\s*name\s*=\s*"([^"]+)"\s*;"#).ok()?;
    for file_name in ["meta.cpp", "mod.cpp"] {
        let Some(path) = child_file(mod_root, file_name) else {
            continue;
        };
        let contents = String::from_utf8_lossy(&fs::read(path).ok()?).into_owned();
        if let Some(name) = pattern
            .captures(&contents)
            .map(|capture| capture[1].trim().to_owned())
            && !name.is_empty()
        {
            return Some(name);
        }
    }
    None
}

fn metadata_workshop_id(mod_root: &Path) -> Option<u64> {
    let path = child_file(mod_root, "meta.cpp")?;
    let contents = String::from_utf8_lossy(&fs::read(path).ok()?).into_owned();
    let pattern = regex::Regex::new(r"(?im)^\s*publishedid\s*=\s*(\d+)\s*;").ok()?;
    pattern.captures(&contents)?.get(1)?.as_str().parse().ok()
}

fn child_file(parent: &Path, expected: &str) -> Option<PathBuf> {
    fs::read_dir(parent)
        .ok()?
        .filter_map(Result::ok)
        .find_map(|entry| {
            let is_file = entry.file_type().ok()?.is_file();
            let matches = entry
                .file_name()
                .to_string_lossy()
                .eq_ignore_ascii_case(expected);
            (is_file && matches).then(|| entry.path())
        })
}

fn remove_legacy_automatic_sources(sources: &mut Vec<StoredSource>) -> bool {
    let before = sources.len();
    // Versions prior to the explicit-source model created these two IDs.
    // User-added entries always receive a `custom-*` ID, even when the selected
    // path happens to be the game or Workshop directory.
    sources.retain(|source| source.id != "game" && source.id != "workshop");
    sources.len() != before
}

fn classify_selected_source(path: &Path) -> SourceKind {
    let Some(installation) = crate::steam::discover_arma() else {
        return SourceKind::Custom;
    };
    if same_path(path, &installation.game_directory) {
        SourceKind::Game
    } else if same_path(path, &installation.workshop_directory) {
        SourceKind::Workshop
    } else {
        SourceKind::Custom
    }
}

fn same_path(left: &Path, right: &Path) -> bool {
    fs::canonicalize(left).ok().as_deref() == fs::canonicalize(right).ok().as_deref()
}

fn config_path() -> Result<PathBuf, String> {
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))
        .ok_or_else(|| "could not determine the user configuration directory".to_owned())?;
    Ok(base.join("armasync/config.toml"))
}

fn load() -> Result<SourcesConfig, String> {
    let path = config_path()?;
    if !path.is_file() {
        return Ok(SourcesConfig::default());
    }
    let contents = fs::read_to_string(&path)
        .map_err(|error| format!("could not read {}: {error}", path.display()))?;
    toml::from_str(&contents)
        .map_err(|error| format!("could not parse {}: {error}", path.display()))
}

fn save(config: &SourcesConfig) -> Result<(), String> {
    let path = config_path()?;
    let parent = path
        .parent()
        .ok_or_else(|| "invalid configuration path".to_owned())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("could not create {}: {error}", parent.display()))?;
    let contents = toml::to_string_pretty(config)
        .map_err(|error| format!("could not serialize addon sources: {error}"))?;
    let temporary = path.with_extension("toml.tmp");
    fs::write(&temporary, contents)
        .map_err(|error| format!("could not write {}: {error}", temporary.display()))?;
    fs::rename(&temporary, &path)
        .map_err(|error| format!("could not replace {}: {error}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn removes_only_legacy_automatic_ids() {
        let mut sources = vec![
            StoredSource {
                id: "game".into(),
                name: "Game".into(),
                path: "/game".into(),
                kind: SourceKind::Game,
                enabled: true,
            },
            StoredSource {
                id: "custom-1".into(),
                name: "Chosen game".into(),
                path: "/game".into(),
                kind: SourceKind::Game,
                enabled: true,
            },
        ];
        assert!(remove_legacy_automatic_sources(&mut sources));
        assert_eq!(sources.len(), 1);
        assert_eq!(sources[0].id, "custom-1");
    }

    #[test]
    fn custom_addons_inside_a_repository_destination_are_flagged_as_repository() {
        let roots = vec![PathBuf::from("/home/user/unit-mods")];
        assert!(addon_is_repository(
            SourceKind::Custom,
            Path::new("/home/user/unit-mods/@ace"),
            &roots,
        ));
        assert!(!addon_is_repository(
            SourceKind::Custom,
            Path::new("/home/user/other-mods/@ace"),
            &roots,
        ));
        assert!(!addon_is_repository(
            SourceKind::Workshop,
            Path::new("/home/user/unit-mods/@ace"),
            &roots,
        ));
    }

    #[test]
    fn prefixed_source_is_a_boundary_for_nested_optional_addons() {
        let root = std::env::temp_dir().join(format!(
            "armasync-addon-boundary-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        let addon = root.join("@lt_ace");
        let nested = addon.join("optionals/@ace_nomedical/addons");
        fs::create_dir_all(&nested).expect("create nested optional addon fixture");

        let direct = discover_mod_roots(&addon, SourceKind::Custom).expect("scan addon source");
        assert_eq!(direct, vec![addon.clone()]);

        let parent = discover_mod_roots(&root, SourceKind::Custom).expect("scan parent source");
        assert_eq!(parent, vec![addon]);

        fs::remove_dir_all(root).expect("remove addon fixture");
    }

    #[test]
    fn local_mods_with_shared_workshop_metadata_remain_distinct() {
        let first = addon_identity(
            SourceKind::Custom,
            Some(424_190_840),
            Path::new("/@LT_Moderne"),
        );
        let second = addon_identity(
            SourceKind::Custom,
            Some(424_190_840),
            Path::new("/@LT_Moderne_Terrein"),
        );
        assert_ne!(first, second);
        assert_eq!(
            addon_identity(SourceKind::Workshop, Some(424_190_840), Path::new("/one")),
            addon_identity(SourceKind::Workshop, Some(424_190_840), Path::new("/two"))
        );
    }
}
