// Native target fixture. No domain access; its test owner kills and reaps it.
fn main() {
    let args: Vec<_> = std::env::args_os().collect();
    if args.get(1).is_some_and(|arg| arg == "--owned-launch") {
        use std::io::Read;
        assert_eq!(args.len(), 4);
        let mut transaction = openforge_update_helper::InstallTransaction::open(
            std::path::Path::new(&args[2]),
            "installation-one",
            std::path::Path::new(&args[3]),
        )
        .unwrap();
        let mut child = transaction.launch("operation-one").unwrap();
        drop(transaction);
        let _ = std::io::stdin().read(&mut [0_u8; 1]);
        let _ = child.kill();
        let _ = child.wait();
        return;
    }
    if std::env::args().any(|arg| arg == "--watch-parent") {
        extern "C" fn quit_cleanup() {
            let root = std::path::PathBuf::from(
                std::env::var_os("OPENFORGE_ELECTRON_USER_DATA_DIR").unwrap(),
            );
            let _ = std::fs::write(root.join("quit-cleanup-ran"), b"cleanup");
        }
        // SAFETY: this fixture callback remains valid for the process lifetime.
        assert_eq!(unsafe { libc::atexit(quit_cleanup) }, 0);
        openforge_update_helper::exit_with_host().unwrap();
        let root =
            std::path::PathBuf::from(std::env::var_os("OPENFORGE_ELECTRON_USER_DATA_DIR").unwrap());
        std::fs::write(
            root.join("owner-watch-ready"),
            std::process::id().to_string(),
        )
        .unwrap();
        std::thread::sleep(std::time::Duration::from_secs(10));
        return;
    }
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
