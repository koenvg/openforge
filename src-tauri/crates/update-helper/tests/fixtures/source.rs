//! Owned native source app/Sidecar fixture. Never contacts a development runtime.
use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, Command, Stdio},
};

struct Owned(Child);
impl Drop for Owned {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
fn read(input: &mut impl BufRead) -> Value {
    let mut line = String::new();
    input.read_line(&mut line).unwrap();
    serde_json::from_str(&line).unwrap()
}
fn send(child: &mut Child, value: &Value) {
    writeln!(child.stdin.as_mut().unwrap(), "{value}").unwrap();
}
fn signed(payload: String) -> Value {
    let key = ring::hmac::Key::new(ring::hmac::HMAC_SHA256, &[42; 32]);
    let tag = ring::hmac::sign(
        &key,
        &[
            b"openforge-update-handoff-v1\0".as_slice(),
            payload.as_bytes(),
        ]
        .concat(),
    );
    json!({"payload":payload,"mac":tag.as_ref().iter().map(|b| format!("{b:02x}")).collect::<String>()})
}
fn main() {
    let root = PathBuf::from(std::env::args().nth(1).unwrap());
    let destination = root.join("Installed.app");
    if matches!(
        std::env::args().nth(2).as_deref(),
        Some("sidecar" | "guard-only-sidecar")
    ) {
        openforge_update_helper::exit_with_host().unwrap();
        if std::env::args().nth(2).as_deref() == Some("sidecar") {
            openforge_update_helper::initialize_source_attestation(
                &root,
                &root,
                &root,
                &"2a".repeat(32),
            )
            .unwrap();
        }
        println!("ready");
        let mut input = BufReader::new(std::io::stdin());
        let request = read(&mut input);
        println!(
            "{}",
            openforge_update_helper::source_attestation(&request, &"2a".repeat(32))
                .unwrap_or_else(|_| json!({"unavailable":true}))
        );
        let mut line = String::new();
        let _ = input.read_line(&mut line);
        if line.trim() == "exec" {
            #[cfg(target_os = "macos")]
            {
                use std::os::unix::process::CommandExt;
                panic!(
                    "exec failed: {}",
                    Command::new("/bin/sleep").arg("2").env_clear().exec()
                );
            }
        }
        return;
    }
    let mut sidecar = Owned(
        Command::new(destination.join("Contents/MacOS/openforge-sidecar"))
            .args([
                root.to_str().unwrap(),
                if std::env::args().nth(2).as_deref() == Some("guard-only") {
                    "guard-only-sidecar"
                } else {
                    "sidecar"
                },
            ])
            .env_clear()
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap(),
    );
    let mut source_output = BufReader::new(sidecar.0.stdout.take().unwrap());
    let mut ready = String::new();
    source_output.read_line(&mut ready).unwrap();
    assert_eq!(ready.trim(), "ready");
    let mut helper = Owned(
        Command::new(root.join("private-helper"))
            .env_clear()
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap(),
    );
    let mut output = BufReader::new(helper.0.stdout.take().unwrap());
    let hello = read(&mut output);
    let grant: Value = serde_json::from_slice(
        &std::fs::read(root.join("authorization/operation-one.json")).unwrap(),
    )
    .unwrap();
    let grant: Value = serde_json::from_str(grant["payload"].as_str().unwrap()).unwrap();
    let binding = json!({"challenge":hello["challenge"],"installation":"installation-one","operation":"operation-one",
        "manifestSha256":grant["manifestSha256"],"recoveryRoot":root.join("transaction"),"controller":null});
    send(&mut sidecar.0, &binding);
    let mut proof = read(&mut source_output);
    let scenario = std::env::args().nth(2).unwrap_or_default();
    if scenario == "tamper" {
        proof["mac"] = json!("00".repeat(32));
    }
    if [
        "wrong-app",
        "changed-birth",
        "wrong-image",
        "wrong-roots",
        "stale-challenge",
        "wrong-operation",
    ]
    .contains(&scenario.as_str())
    {
        let mut payload: Value = serde_json::from_str(proof["payload"].as_str().unwrap()).unwrap();
        match scenario.as_str() {
            "wrong-app" => payload["birth"]["app"]["pid"] = json!(std::process::id() + 1),
            "changed-birth" => payload["birth"]["sidecar"]["startedMicroseconds"] = json!(0),
            "wrong-image" => payload["birth"]["sidecarImage"] = json!(vec![0; 20]),
            "wrong-roots" => payload["birth"]["roots"]["appData"] = json!(root.join("wrong-data")),
            "stale-challenge" => payload["binding"]["challenge"] = json!("ff".repeat(32)),
            "wrong-operation" => payload["binding"]["operation"] = json!("different-operation"),
            _ => unreachable!(),
        }
        let payload = payload.to_string();
        let tag = ring::hmac::sign(
            &ring::hmac::Key::new(ring::hmac::HMAC_SHA256, &[42; 32]),
            &[
                b"openforge-original-source-v1\0".as_slice(),
                payload.as_bytes(),
            ]
            .concat(),
        );
        proof = json!({"payload":payload,"mac":tag.as_ref().iter().map(|b| format!("{b:02x}")).collect::<String>()});
    }
    if scenario == "exec-after-proof" {
        writeln!(sidecar.0.stdin.as_mut().unwrap(), "exec").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(100));
        // Disk still holds the original source while the same PID/birth executes /bin/sleep.
    }
    if scenario == "source-loss" {
        drop(sidecar.0.stdin.take());
        sidecar.0.wait().unwrap();
    }
    let request = json!({"version":1,"action":"prepare","challenge":hello["challenge"],"root":root.join("transaction"),
        "destination":destination,"authorization":root.join("authorization"),"staging":root.join("staged"),
        "installation":"installation-one","operation":"operation-one","manifestSha256":grant["manifestSha256"],
        "source":{"key":"2a".repeat(32),"sidecarPid":sidecar.0.id()}});
    let mut request = request;
    if [
        "tamper",
        "wrong-app",
        "changed-birth",
        "wrong-image",
        "wrong-roots",
        "stale-challenge",
        "wrong-operation",
    ]
    .contains(&scenario.as_str())
    {
        request["source"]["proof"] = proof;
    }
    if scenario == "wrong-key" {
        request["source"]["key"] = json!("ff".repeat(32));
    }
    if scenario == "wrong-process" {
        request["source"]["sidecarPid"] = json!(helper.0.id());
    }
    send(&mut helper.0, &signed(request.to_string()));
    let response = read(&mut output);
    println!("{response}");
    if response["status"] == "prepared" {
        if scenario.starts_with("recover-") {
            helper.0.kill().unwrap();
            helper.0.wait().unwrap();
            if scenario == "recover-source-loss" {
                drop(sidecar.0.stdin.take());
                sidecar.0.wait().unwrap();
            }
            if matches!(
                scenario.as_str(),
                "recover-missing-source"
                    | "recover-reused-birth"
                    | "recover-stale-boot"
                    | "recover-replayed-operation"
                    | "recover-tamper"
            ) {
                let path = root.join("transaction/current.json");
                let mut envelope: Value =
                    serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
                let mut payload: Value =
                    serde_json::from_str(envelope["payload"].as_str().unwrap()).unwrap();
                match scenario.as_str() {
                    "recover-missing-source" => {
                        payload.as_object_mut().unwrap().remove("source");
                    }
                    "recover-reused-birth" => {
                        payload["source"]["proof"]["birth"]["sidecar"]["startedSeconds"] = json!(1)
                    }
                    "recover-stale-boot" => {
                        payload["source"]["proof"]["birth"]["bootSession"] = json!("stale-boot")
                    }
                    "recover-replayed-operation" => {
                        payload["source"]["proof"]["binding"]["operation"] =
                            json!("another-operation")
                    }
                    _ => {}
                }
                let payload = payload.to_string();
                let key = std::fs::read(root.join("transaction/journal.key")).unwrap();
                let tag = ring::hmac::sign(
                    &ring::hmac::Key::new(ring::hmac::HMAC_SHA256, &key),
                    &[
                        b"openforge-update-journal-v1\0".as_slice(),
                        payload.as_bytes(),
                    ]
                    .concat(),
                );
                envelope = json!({"payload":payload,"mac":if scenario == "recover-tamper" { "00".repeat(32) } else { tag.as_ref().iter().map(|b| format!("{b:02x}")).collect::<String>() }});
                std::fs::write(path, envelope.to_string()).unwrap();
            }
            let mut recovering = Owned(
                Command::new(root.join("private-helper"))
                    .env_clear()
                    .stdin(Stdio::piped())
                    .stdout(Stdio::piped())
                    .spawn()
                    .unwrap(),
            );
            let mut recovered = BufReader::new(recovering.0.stdout.take().unwrap());
            let hello = read(&mut recovered);
            let mut recovery = request.clone();
            recovery["action"] = json!("recover-preparation");
            recovery["challenge"] = hello["challenge"].clone();
            send(&mut recovering.0, &signed(recovery.to_string()));
            println!("{}", read(&mut recovered));
            return;
        }
        if scenario == "pipe-loss" {
            drop(helper.0.stdin.take());
            println!("{}", read(&mut output));
            return;
        }
        if scenario == "arm-exited" {
            drop(sidecar.0.stdin.take());
            sidecar.0.wait().unwrap();
            send(&mut helper.0, &signed(json!({"version":1,"action":"install","challenge":hello["challenge"],"operation":"operation-one"}).to_string()));
            println!("{}", read(&mut output));
            assert!(
                helper.0.try_wait().unwrap().is_none(),
                "helper replaced a live original app"
            );
            return;
        }
        if scenario == "lose-after-prepared" {
            drop(sidecar.0.stdin.take());
            sidecar.0.wait().unwrap();
        }
        if scenario == "arm-live" {
            send(&mut helper.0, &signed(json!({"version":1,"action":"install","challenge":hello["challenge"],"operation":"operation-one"}).to_string()));
            println!("{}", read(&mut output));
            return;
        }
        send(&mut helper.0, &signed(json!({"version":1,"action":"cancel","challenge":hello["challenge"],"operation":"operation-one"}).to_string()));
        println!("{}", read(&mut output));
    }
}
