//! Test-only process boundary. Not packaged or used by the production installer.
use openforge_update_helper::InstallTransaction;
use serde::Deserialize;
use std::{io::Read, path::PathBuf};

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
    let mut input = Vec::new();
    std::io::stdin()
        .take(16 * 1024 + 1)
        .read_to_end(&mut input)
        .map_err(|e| e.to_string())?;
    if input.len() > 16 * 1024 {
        return Err("request exceeds limit".into());
    }
    let request: Request = serde_json::from_slice(&input).map_err(|_| "invalid fixture request")?;
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
