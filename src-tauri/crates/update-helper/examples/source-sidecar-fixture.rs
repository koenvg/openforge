//! Private Electron-owned source. Uses the production native startup service, not supplied birth data.
use std::{io::BufRead, path::PathBuf};

fn run() -> Result<(), String> {
    if std::env::var("OPENFORGE_ELECTRON_SIDECAR").as_deref() != Ok("1") {
        return Err("fixture requires an Electron owner".into());
    }
    openforge_update_helper::exit_with_host()?;
    let root = |name| {
        std::env::var_os(name)
            .map(PathBuf::from)
            .ok_or_else(|| format!("missing fixture root: {name}"))
    };
    let token = std::env::var("OPENFORGE_BACKEND_TOKEN").map_err(|e| e.to_string())?;
    openforge_update_helper::initialize_source_attestation(
        &root("OPENFORGE_ELECTRON_USER_DATA_DIR")?,
        &root("OPENFORGE_APP_DATA_DIR")?,
        &root("OPENFORGE_SESSION_DAEMON_ROOT")?,
        &token,
    )?;
    if !openforge_update_helper::source_attestation_available() {
        return Err("source attestation service is unavailable".into());
    }
    println!("source-ready");
    // The exact owned child exits on the host's private pipe. The helper watches its kernel exit.
    let mut command = String::new();
    std::io::stdin()
        .lock()
        .read_line(&mut command)
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
