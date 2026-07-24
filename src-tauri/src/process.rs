use std::process::Command;

/// Builds a `Command` for a host system tool with a clean environment.
///
/// When running from an AppImage, the AppImage runtime exports `PYTHONHOME`
/// and `PYTHONPATH` pointing into the AppImage's own AppDir (which contains
/// no real Python installation) and prepends its bundled library directories
/// to `LD_LIBRARY_PATH`. Every child process inherits these by default,
/// which breaks Python-based tools like protontricks outright ("Failed to
/// import encodings module") and risks other host binaries loading
/// mismatched bundled libraries instead of the system ones. Host tools we
/// shell out to must run as if launched normally, outside the AppImage.
pub fn host_command(program: &str) -> Command {
    let mut command = Command::new(program);
    command
        .env_remove("PYTHONHOME")
        .env_remove("PYTHONPATH")
        .env_remove("LD_LIBRARY_PATH");
    command
}
