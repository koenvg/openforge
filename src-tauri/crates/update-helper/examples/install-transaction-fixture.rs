// Test-only process boundary. Not packaged or used by the production installer.
use openforge_update_helper::InstallTransaction;
use serde::Deserialize;
use std::{io::Read, path::PathBuf};

#[path = "common/admitted_runtime.rs"]
mod admitted_runtime;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    root: PathBuf,
    destination: PathBuf,
    authorization: PathBuf,
    staging: PathBuf,
    installation: String,
    operation: String,
    action: String,
    controller: Option<openforge_session_protocol::Controller>,
}

fn run() -> Result<(), String> {
    if std::env::args_os().any(|arg| arg == openforge_update_helper::SIDECAR_STARTUP_ARGUMENT) {
        println!("sidecar-awaiting-admission");
    }
    if openforge_update_helper::authorize_sidecar_startup()? {
        println!("sidecar-authorized");
        if let Some(mode) = std::env::args().find(|arg| {
            matches!(
                arg.as_str(),
                "--cold-runtime" | "--live-runtime" | "--wrong-cold-runtime"
            )
        }) {
            return admitted_runtime::run(&mode);
        }
        return Ok(());
    }
    let mut input = Vec::new();
    std::io::stdin()
        .take(16 * 1024 + 1)
        .read_to_end(&mut input)
        .map_err(|e| e.to_string())?;
    if input.len() > 16 * 1024 {
        return Err("request exceeds limit".into());
    }
    let request: Request = serde_json::from_slice(&input).map_err(|_| "invalid fixture request")?;
    if request.action == "runtime-observe" {
        let controller = request
            .controller
            .ok_or("missing observation installation")?;
        let operation = openforge_session_protocol::OperationId::parse(&request.operation)
            .map_err(|e| e.to_string())?;
        let (capabilities, status) =
            openforge_session_client::MaintenanceClient::observe_replacement(
                &request.root,
                &controller.installation,
                &operation,
            )
            .map_err(|e| e.to_string())?;
        println!(
            "{}",
            serde_json::json!({ "capabilities": capabilities, "status": status })
        );
        return Ok(());
    }
    if request.action == "runtime-inventory" {
        let (inventory, capabilities) = if let Some(controller) = request.controller {
            openforge_session_client::MaintenanceClient::attach(&request.root, controller)
                .and_then(|client| Ok((client.inventory()?, client.capabilities()?)))
        } else {
            openforge_session_client::Client::connect(&request.root)
                .and_then(|client| Ok((client.inventory()?, client.capabilities()?)))
        }
        .map_err(|e| e.to_string())?;
        println!(
            "{}",
            serde_json::json!({ "controller": inventory.controller, "sessions": inventory.sessions, "capabilities": capabilities })
        );
        return Ok(());
    }
    let mut transaction =
        InstallTransaction::open(&request.root, &request.installation, &request.destination)?;
    match request.action.as_str() {
        "idle" => {}
        "target-exited" => {
            if transaction.launched_process_running(&request.operation)? {
                return Err("target process is still running".into());
            }
        }
        "prepare" => {
            transaction.prepare(&request.authorization, &request.staging, &request.operation)?
        }
        "replace" => transaction.replace(&request.operation)?,
        "recover" => {
            transaction.recover(&request.operation)?;
        }
        _ => return Err("unsupported fixture action".into()),
    }
    println!("ok");
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
