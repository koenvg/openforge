//! Private inherited-pipe protocol. An authorization file alone is not a live handoff.
use crate::{authorization, files, InstallTransaction};
use ring::{
    hmac,
    rand::{SecureRandom, SystemRandom},
};
use serde::Deserialize;
use serde_json::json;
use std::{
    io::{BufRead, Read, Write},
    path::PathBuf,
};

const CONTEXT: &[u8] = b"openforge-update-handoff-v1\0";
const FRAME_LIMIT: u64 = 32 * 1024;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Envelope {
    payload: String,
    mac: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Prepare {
    version: u32,
    challenge: String,
    action: String,
    root: PathBuf,
    destination: PathBuf,
    authorization: PathBuf,
    staging: PathBuf,
    installation: String,
    operation: String,
    #[serde(rename = "manifestSha256")]
    manifest_sha256: String,
    controller: Option<openforge_session_protocol::Controller>,
    #[serde(rename = "sidecarPid")]
    sidecar_pid: Option<u32>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Decision {
    version: u32,
    challenge: String,
    action: String,
    operation: String,
}

fn frame(input: &mut impl BufRead) -> Result<Envelope, String> {
    let mut bytes = Vec::new();
    input
        .take(FRAME_LIMIT + 1)
        .read_until(b'\n', &mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > FRAME_LIMIT || bytes.last() != Some(&b'\n') {
        return Err("missing or oversized handoff frame".into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "invalid handoff envelope".into())
}

fn verify(key: &hmac::Key, envelope: &Envelope) -> Result<(), String> {
    hmac::verify(
        key,
        &[CONTEXT, envelope.payload.as_bytes()].concat(),
        &authorization::decode_mac(&envelope.mac)?,
    )
    .map_err(|_| "invalid handoff authentication".into())
}

fn emit(value: &serde_json::Value) -> Result<(), String> {
    let mut output = std::io::stdout().lock();
    writeln!(output, "{value}")
        .and_then(|()| output.flush())
        .map_err(|e| e.to_string())
}

fn await_decision(
    input: &mut std::io::BufReader<crate::handoff_input::HandoffInput>,
    key: &hmac::Key,
    challenge: &str,
    operation: &str,
) -> Result<String, String> {
    emit(&json!({"status":"prepared","operation":operation}))?;
    *input.get_mut() = crate::handoff_input::HandoffInput::new();
    let envelope = frame(input)?;
    verify(key, &envelope)?;
    let decision: Decision =
        serde_json::from_str(&envelope.payload).map_err(|_| "invalid handoff decision")?;
    if decision.version != 1 || decision.challenge != challenge || decision.operation != operation {
        return Err("stale handoff decision".into());
    }
    Ok(decision.action)
}

fn run() -> Result<(), String> {
    let host = crate::host_exit::HostExit::watch()?;
    let mut random = [0_u8; 32];
    SystemRandom::new()
        .fill(&mut random)
        .map_err(|_| "cannot generate handoff challenge")?;
    let challenge: String = random.iter().map(|b| format!("{b:02x}")).collect();
    // Handshake v2 requires process-bound readiness/commit. Signed record formats stay v1.
    emit(
        &json!({"version":2,"challenge":challenge,"capabilities":["relaunch","launch-gate","atomic-replace"]}),
    )?;
    let mut input = std::io::BufReader::new(crate::handoff_input::HandoffInput::new());
    let envelope = frame(&mut input)?;
    let request: Prepare =
        serde_json::from_str(&envelope.payload).map_err(|_| "invalid handoff request")?;
    if request.version != 1
        || request.challenge != challenge
        || !matches!(
            request.action.as_str(),
            "prepare"
                | "commit"
                | "verify-launch"
                | "verify-ready"
                | "register-sidecar"
                | "prepare-relaunch"
        )
        || (request.action == "register-sidecar") != request.sidecar_pid.is_some()
        || (request.action == "prepare-relaunch" && request.controller.is_some())
    {
        return Err("stale or unsupported handoff request".into());
    }
    files::check_private_directory(&request.authorization)?;
    let bytes = files::read_private(&request.authorization.join("authorization.key"), 32)?;
    if bytes.len() != 32 {
        return Err("invalid handoff key".into());
    }
    let key = hmac::Key::new(hmac::HMAC_SHA256, &bytes);
    verify(&key, &envelope)?;
    // Authenticate the grant before creating any ownership or recovery files.
    let destination = request
        .destination
        .parent()
        .ok_or("missing destination parent")?
        .canonicalize()
        .map_err(|e| e.to_string())?
        .join(
            request
                .destination
                .file_name()
                .ok_or("missing destination name")?,
        );
    let staging = request.staging.canonicalize().map_err(|e| e.to_string())?;
    let authority = authorization::read(
        &request.authorization,
        &request.operation,
        &request.installation,
        &destination,
        &staging,
    )?;
    if authority.manifest_sha256 != request.manifest_sha256 {
        return Err("handoff target does not match authorization".into());
    }
    let launch = authority
        .launch
        .as_ref()
        .ok_or("missing authorized launch context")?;
    launch.validate(&destination, &authority.bundle_path)?;
    let mut transaction = match InstallTransaction::open(
        &request.root,
        &request.installation,
        &request.destination,
    ) {
        Ok(transaction) => transaction,
        Err(error)
            if request.action == "verify-launch"
                && error == "another updater owns this installation" =>
        {
            return emit(&json!({"status":"launch-pending","operation":request.operation}));
        }
        Err(error) => return Err(error),
    };
    if request.action == "verify-launch" {
        transaction.verify_launch(&request.operation, host.parent_pid()?)?;
        return emit(&json!({"status":"launch-verified","operation":request.operation}));
    }
    if request.action == "register-sidecar" {
        let admission = transaction.register_sidecar(
            &request.operation,
            host.parent_pid()?,
            request.sidecar_pid.ok_or("missing sidecar pid")?,
        )?;
        return emit(
            &json!({"status":"sidecar-registered","operation":request.operation,"admission":admission}),
        );
    }
    if request.action == "verify-ready" {
        transaction.verify_readiness(&request.operation, host.parent_pid()?, request.controller)?;
        return emit(&json!({"status":"target-ready","operation":request.operation}));
    }
    if request.action == "commit" {
        transaction.commit_from_process(
            &request.operation,
            host.parent_pid()?,
            request.controller,
        )?;
        return emit(&json!({"status":"committed","operation":request.operation}));
    }
    if request.action == "prepare-relaunch" {
        transaction.prepare_relaunch(&request.operation, host.parent_pid()?)?;
        let record = transaction.require(&request.operation)?;
        if record.runtime.is_none() {
            return Err("cold update relaunch requires separate recovery".into());
        }
        let action = await_decision(&mut input, &key, &challenge, &request.operation)?;
        if action == "cancel" {
            // Recovery cancellation releases ownership; it must never roll back installed data.
            return emit(&json!({"status":"cancelled","operation":request.operation}));
        }
        if action != "relaunch" {
            return Err("unsupported relaunch decision".into());
        }
        transaction.prepare_relaunch(&request.operation, host.parent_pid()?)?;
        if let Some(sidecar) = record.sidecar {
            if sidecar.running()? {
                return Err("admitted Sidecar is still running".into());
            }
        }
        emit(&json!({"status":"armed","operation":request.operation}))?;
        host.wait()?;
        transaction.relaunch(&request.operation)?;
        return Ok(());
    }
    // Refuse an unsealed target while the source app and Sidecar are still running.
    crate::native_image::verify_integrity(&authority.bundle_path)?;
    let cold_runtime = if request.controller.is_none() {
        Some(crate::runtime_update::ColdRuntime::reserve(
            &launch.daemon_root,
        )?)
    } else {
        None
    };
    transaction.prepare(&request.authorization, &request.staging, &request.operation)?;
    if let Some(cold) = &cold_runtime {
        let mut record = transaction.require(&request.operation)?;
        record.cold_installation = Some(cold.installation.clone());
        crate::journal::write(&transaction.root, &record)?;
    }
    let mut runtime = if let Some(controller) = request.controller {
        match crate::runtime_update::RuntimeUpdate::stage(&authority, controller) {
            Ok(runtime) => Some(runtime),
            Err(error) => {
                transaction.recover(&request.operation)?;
                return Err(error);
            }
        }
    } else {
        None
    };
    if let Some(runtime) = &mut runtime {
        let prepared = (|| {
            transaction.record_runtime(&request.operation, runtime.plan.clone())?;
            runtime.prepare(&request.operation)?;
            transaction.record_runtime(&request.operation, runtime.plan.clone())
        })();
        if let Err(error) = prepared {
            runtime.cancel(&request.operation)?;
            transaction.recover(&request.operation)?;
            return Err(error);
        }
    }
    let decision: Result<String, String> = (|| {
        let action = await_decision(&mut input, &key, &challenge, &request.operation)?;
        match action.as_str() {
            "cancel" => Ok(action),
            "install" => {
                emit(&json!({"status":"armed","operation":request.operation}))?;
                host.wait()?;
                Ok(action)
            }
            _ => Err("unsupported handoff decision".into()),
        }
    })();
    if decision.as_deref() != Ok("install") {
        if let Some(runtime) = &runtime {
            runtime.cancel(&request.operation)?;
        }
        transaction.recover(&request.operation)?;
        decision?;
        return emit(&json!({"status":"cancelled","operation":request.operation}));
    }
    if let Err(error) = transaction.replace(&request.operation) {
        if let Some(runtime) = &runtime {
            runtime.cancel(&request.operation)?;
        }
        transaction.recover(&request.operation)?;
        return Err(error);
    }
    if let Err(error) = launch.validate(&destination, &authority.bundle_path) {
        transaction.recover(&request.operation)?;
        return Err(error);
    }
    if let Some(runtime) = &runtime {
        let activation = runtime.activate(&request.operation);
        #[cfg(feature = "test-fixtures")]
        let activation = activation.and_then(|()| {
            if transaction
                .root
                .join("lose-runtime-activation-ack")
                .exists()
            {
                return Err("fixture lost runtime activation acknowledgement".into());
            }
            Ok(())
        });
        if let Err(error) = activation {
            transaction.recover(&request.operation)?;
            return Err(error);
        }
    }
    // The old host has exited. Release cold-start admission before the target
    // can launch its daemon; target readiness must still verify the running image.
    drop(cold_runtime);
    match transaction.launch(&request.operation) {
        Ok(_target) => Ok(()),
        Err(error) => {
            if transaction.require(&request.operation)?.phase == crate::Phase::Installed {
                transaction.recover(&request.operation)?;
            }
            Err(error)
        }
    }
}

/// Serve exactly one authenticated operation through inherited stdin/stdout.
/// # Errors
/// Rejects malformed, unauthenticated or stale commands without replacing an app.
pub fn run_helper() -> Result<(), String> {
    let result = run();
    if result.is_err() {
        let _ = emit(&json!({"status":"refused"}));
    }
    result
}
