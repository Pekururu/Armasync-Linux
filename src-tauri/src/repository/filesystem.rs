//! All repository I/O is relative to pinned directory descriptors. Symlinks are
//! rejected at every component, including state and staging directories.
use rustix::fs::{AtFlags, Mode, OFlags, mkdirat, openat, renameat, unlinkat};
use std::{
    fs::File,
    io,
    path::{Component, Path},
};

pub(crate) struct Directory(File);

impl Directory {
    pub(crate) fn open(path: &Path) -> io::Result<Self> {
        Ok(Self(
            rustix::fs::open(
                path,
                OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                Mode::empty(),
            )?
            .into(),
        ))
    }

    fn components(path: &Path) -> io::Result<Vec<&std::ffi::OsStr>> {
        let mut result = Vec::new();
        for component in path.components() {
            match component {
                Component::Normal(name) => result.push(name),
                _ => {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidInput,
                        "repository path must contain only relative normal components",
                    ));
                }
            }
        }
        if result.is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "empty repository path",
            ));
        }
        Ok(result)
    }

    pub(crate) fn directory(&self, path: &Path, create: bool) -> io::Result<Self> {
        let mut current = Self(self.0.try_clone()?);
        for name in Self::components(path)? {
            if create {
                match mkdirat(&current.0, name, Mode::from_bits_truncate(0o700)) {
                    Ok(()) => current.0.sync_all()?,
                    Err(rustix::io::Errno::EXIST) => {}
                    Err(error) => return Err(error.into()),
                }
            }
            current = Self(
                openat(
                    &current.0,
                    name,
                    OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                    Mode::empty(),
                )?
                .into(),
            );
        }
        Ok(current)
    }

    fn parent(&self, path: &Path, create: bool) -> io::Result<(Self, std::ffi::OsString)> {
        let parts = Self::components(path)?;
        let name = parts.last().unwrap().to_os_string();
        let parent = if parts.len() == 1 {
            Self(self.0.try_clone()?)
        } else {
            self.directory(path.parent().unwrap(), create)?
        };
        Ok((parent, name))
    }

    pub(crate) fn read(&self, path: &Path) -> io::Result<File> {
        let (parent, name) = self.parent(path, false)?;
        let file: File = openat(
            &parent.0,
            name,
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        )?
        .into();
        if !file.metadata()?.is_file() {
            return Err(io::Error::other("repository entry is not a regular file"));
        }
        Ok(file)
    }

    pub(crate) fn create(&self, path: &Path) -> io::Result<File> {
        let (parent, name) = self.parent(path, true)?;
        Ok(openat(
            &parent.0,
            name,
            OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::from_bits_truncate(0o600),
        )?
        .into())
    }

    pub(crate) fn lock(&self) -> io::Result<File> {
        let state = self.directory(Path::new(".armasync"), true)?;
        let file: File = openat(
            &state.0,
            "sync.lock",
            OFlags::RDWR | OFlags::CREATE | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::from_bits_truncate(0o600),
        )?
        .into();
        if !file.metadata()?.is_file() {
            return Err(io::Error::other("invalid repository lock"));
        }
        fs2::FileExt::try_lock_exclusive(&file).map_err(|_| {
            io::Error::other("this destination is being checked or synchronized by another process")
        })?;
        Ok(file)
    }

    pub(crate) fn rename(&self, from: &Path, to: &Path) -> io::Result<()> {
        let (source, source_name) = self.parent(from, false)?;
        let (target, target_name) = self.parent(to, true)?;
        renameat(&source.0, source_name, &target.0, target_name)?;
        target.0.sync_all()?;
        source.0.sync_all()
    }

    pub(crate) fn remove(&self, path: &Path) -> io::Result<()> {
        let (parent, name) = self.parent(path, false)?;
        unlinkat(&parent.0, name, AtFlags::empty())?;
        parent.0.sync_all()
    }

    pub(crate) fn write_atomic(&self, path: &Path, bytes: &[u8]) -> io::Result<()> {
        use std::io::Write;
        let temporary = path.with_extension(format!(
            "tmp-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        let mut file = self.create(&temporary)?;
        let result = (|| {
            file.write_all(bytes)?;
            file.sync_all()?;
            self.rename(&temporary, path)
        })();
        if result.is_err() {
            let _ = self.remove(&temporary);
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_symlink_parents_and_state_and_keeps_outside_files_intact() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("file"), b"original").unwrap();
        let dir = Directory::open(root.path()).unwrap();
        std::os::unix::fs::symlink(outside.path(), root.path().join("@addon")).unwrap();
        assert!(dir.create(Path::new("@addon/new")).is_err());
        assert!(dir.read(Path::new("@addon/file")).is_err());
        dir.create(Path::new("staged")).unwrap();
        assert!(
            dir.rename(Path::new("staged"), Path::new("@addon/file"))
                .is_err()
        );
        std::os::unix::fs::symlink(outside.path(), root.path().join(".armasync")).unwrap();
        assert!(dir.lock().is_err());
        assert_eq!(
            std::fs::read(outside.path().join("file")).unwrap(),
            b"original"
        );
        assert!(dir.create(Path::new("../escape")).is_err());
    }
    #[test]
    fn destination_lock_excludes_independent_handles() {
        let root = tempfile::tempdir().unwrap();
        let first = Directory::open(root.path()).unwrap();
        let second = Directory::open(root.path()).unwrap();
        let lock = first.lock().unwrap();
        assert!(second.lock().is_err());
        drop(lock);
        assert!(second.lock().is_ok());
    }
}
