//! Shared durable config writes. Callers hold `lock` across read/modify/write.
use serde::{Serialize, de::DeserializeOwned};
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

pub fn config_path(name: &str) -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .or_else(|| home.map(|path| path.join(".config")))
        .ok_or("could not determine configuration directory")?;
    Ok(base.join("armasync").join(name))
}

pub fn lock(path: &Path) -> Result<File, String> {
    let parent = path.parent().ok_or("invalid config path")?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(path.with_extension("lock"))
        .map_err(|error| error.to_string())?;
    fs2::FileExt::lock_exclusive(&file).map_err(|error| error.to_string())?;
    Ok(file)
}

pub fn load<T: DeserializeOwned + Default>(path: &Path) -> Result<T, String> {
    // Keep existing installations readable when XDG_CONFIG_HOME is first honored.
    let legacy = std::env::var_os("HOME").map(|home| {
        PathBuf::from(home)
            .join(".config/armasync")
            .join(path.file_name().unwrap())
    });
    load_with_legacy(path, legacy.as_deref())
}

fn load_with_legacy<T: DeserializeOwned + Default>(
    path: &Path,
    legacy: Option<&Path>,
) -> Result<T, String> {
    let input = match fs::read_to_string(path) {
        Ok(input) => input,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            if let Some(legacy) = legacy.filter(|legacy| *legacy != path) {
                return load_with_legacy(legacy, None);
            }
            return Ok(T::default());
        }
        Err(error) => return Err(format!("could not read {}: {error}", path.display())),
    };
    toml::from_str(&input).map_err(|error| format!("could not parse {}: {error}", path.display()))
}

pub fn save<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let output = toml::to_string_pretty(value).map_err(|error| error.to_string())?;
    atomic_write(path, output.as_bytes())
        .map_err(|error| format!("could not save {}: {error}", path.display()))
}

fn atomic_write(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| std::io::Error::other("invalid config path"))?;
    fs::create_dir_all(parent)?;
    let mut temp = tempfile::NamedTempFile::new_in(parent)?;
    temp.write_all(bytes)?;
    temp.as_file().sync_all()?;
    temp.persist(path).map_err(|error| error.error)?;
    File::open(parent)?.sync_all()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[derive(Default, serde::Serialize, serde::Deserialize)]
    struct Counter {
        value: usize,
    }
    #[test]
    fn serializes_concurrent_read_modify_write_transactions() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("counter.toml");
        std::thread::scope(|scope| {
            for _ in 0..8 {
                let path = &path;
                scope.spawn(move || {
                    for _ in 0..10 {
                        let _guard = lock(path).unwrap();
                        let mut count: Counter = load_with_legacy(path, None).unwrap();
                        count.value += 1;
                        save(path, &count).unwrap();
                    }
                });
            }
        });
        assert_eq!(load_with_legacy::<Counter>(&path, None).unwrap().value, 80);
        assert!(!std::fs::read_dir(temp.path()).unwrap().any(|entry| {
            entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".tmp")
        }));
    }
    #[test]
    fn reads_legacy_until_new_config_exists_and_reports_corruption() {
        let temp = tempfile::tempdir().unwrap();
        let legacy = temp.path().join("old.toml");
        let current = temp.path().join("new.toml");
        save(&legacy, &Counter { value: 4 }).unwrap();
        assert_eq!(
            load_with_legacy::<Counter>(&current, Some(&legacy))
                .unwrap()
                .value,
            4
        );
        save(&current, &Counter { value: 5 }).unwrap();
        assert_eq!(
            load_with_legacy::<Counter>(&current, Some(&legacy))
                .unwrap()
                .value,
            5
        );
        std::fs::write(&current, "[bad").unwrap();
        assert!(load_with_legacy::<Counter>(&current, Some(&legacy)).is_err());
    }
}
