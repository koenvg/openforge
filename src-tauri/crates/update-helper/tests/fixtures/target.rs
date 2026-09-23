// Native target fixture. No domain access; its test owner kills and reaps it.
fn main() {
    #[cfg(target_os = "macos")]
    if std::path::Path::new(&std::env::var_os("OPENFORGE_ELECTRON_USER_DATA_DIR").unwrap())
        .join("exec-other-image")
        .exists()
    {
        use std::os::unix::process::CommandExt;
        panic!(
            "exec failed: {}",
            std::process::Command::new("/bin/sleep").arg("60").exec()
        );
    }
    std::thread::sleep(std::time::Duration::from_secs(60));
}
