use regex::Regex;
use std::{fs, path::PathBuf};

const ARMA_APP_ID: &str = "107410";

#[derive(Clone, Debug)]
pub struct ArmaInstallation {
    pub manifest_path: PathBuf,
    pub game_directory: PathBuf,
    pub workshop_directory: PathBuf,
    pub prefix_directory: PathBuf,
}

pub fn discover_arma() -> Option<ArmaInstallation> {
    steam_libraries().into_iter().find_map(|library| {
        let manifest_path = library.join(format!("steamapps/appmanifest_{ARMA_APP_ID}.acf"));
        let manifest = fs::read_to_string(&manifest_path).ok()?;
        let install_dir = capture_value(&manifest, "installdir").unwrap_or_else(|| "Arma 3".into());
        let game_directory = library.join("steamapps/common").join(install_dir);
        game_directory.is_dir().then(|| ArmaInstallation {
            workshop_directory: library.join("steamapps/workshop/content").join(ARMA_APP_ID),
            prefix_directory: library.join("steamapps/compatdata").join(ARMA_APP_ID),
            manifest_path,
            game_directory,
        })
    })
}

pub fn selected_proton() -> Option<String> {
    let expression =
        Regex::new(r#"(?s)"CompatToolMapping"\s*\{.*?"107410"\s*\{.*?"name"\s*"([^"]+)""#)
            .expect("valid compatibility-tool regex");
    steam_libraries().into_iter().find_map(|root| {
        let contents = fs::read_to_string(root.join("config/config.vdf")).ok()?;
        expression
            .captures(&contents)
            .map(|capture| capture[1].to_owned())
    })
}

fn steam_libraries() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        for candidate in [
            home.join(".local/share/Steam"),
            home.join(".steam/steam"),
            home.join(".steam/root"),
        ] {
            if candidate.is_dir() && !roots.contains(&candidate) {
                roots.push(candidate);
            }
        }
    }

    let mut libraries = roots.clone();
    let path_pattern = Regex::new(r#""path"\s+"([^"]+)""#).expect("valid Steam path regex");
    for root in roots {
        let folders = root.join("steamapps/libraryfolders.vdf");
        let Ok(contents) = fs::read_to_string(folders) else {
            continue;
        };
        for capture in path_pattern.captures_iter(&contents) {
            let path = PathBuf::from(capture[1].replace(r"\\", r"\"));
            if path.is_dir() && !libraries.contains(&path) {
                libraries.push(path);
            }
        }
    }
    libraries
}

fn capture_value(contents: &str, key: &str) -> Option<String> {
    let pattern = Regex::new(&format!(r#""{}"\s+"([^"]*)""#, regex::escape(key))).ok()?;
    pattern
        .captures(contents)
        .map(|capture| capture[1].to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn captures_vdf_string_values() {
        assert_eq!(
            capture_value(r#""installdir" "Arma 3""#, "installdir").as_deref(),
            Some("Arma 3")
        );
    }
}
