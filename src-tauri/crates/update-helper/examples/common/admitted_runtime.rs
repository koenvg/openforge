// Fixture-only runtime ownership. EOF on fd 3 releases only the daemon we spawned.
use std::{
    fs::File,
    io::Read,
    os::fd::FromRawFd,
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};

struct OwnedDaemon(Option<Child>);
impl Drop for OwnedDaemon {
    fn drop(&mut self) {
        if let Some(child) = &mut self.0 {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

pub fn run(mode: &str) -> Result<(), String> {
    let root = std::path::PathBuf::from(
        std::env::var_os("OPENFORGE_SESSION_DAEMON_ROOT").ok_or("missing private runtime root")?,
    );
    let mut owned = OwnedDaemon(None);
    if mode != "--live-runtime" {
        let executable = if mode == "--wrong-cold-runtime" {
            root.join("unapproved-daemon")
        } else {
            std::env::current_exe()
                .map_err(|e| e.to_string())?
                .with_file_name("openforge-session-daemon")
        };
        owned.0 = Some(
            Command::new(executable)
                .arg(&root)
                .env_clear()
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|e| e.to_string())?,
        );
    }
    let deadline = Instant::now() + Duration::from_secs(10);
    let client = loop {
        if let Some(child) = &mut owned.0 {
            if child.try_wait().map_err(|e| e.to_string())?.is_some() {
                return Err("owned fixture daemon exited before readiness".into());
            }
        }
        if let Ok(client) = openforge_session_client::Client::connect(&root) {
            break client;
        }
        if Instant::now() >= deadline {
            return Err("fixture daemon readiness timed out".into());
        }
        std::thread::sleep(Duration::from_millis(10));
    };
    println!(
        "runtime-ready:{}",
        serde_json::to_string(&client.inventory().map_err(|e| e.to_string())?.controller)
            .map_err(|e| e.to_string())?
    );
    // SAFETY: the isolated Electron fixture explicitly passes its owned control stream as fd 3.
    let mut control = unsafe { File::from_raw_fd(3) };
    let mut byte = [0_u8; 1];
    control.read(&mut byte).map_err(|e| e.to_string())?;
    Ok(())
}
