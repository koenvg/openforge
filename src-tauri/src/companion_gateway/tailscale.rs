use serde::Deserialize;
use std::{
    fs::File,
    io::{Error, ErrorKind, Read, Seek, SeekFrom},
    net::IpAddr,
    process::{Command, Output, Stdio},
    thread,
    time::{Duration, Instant},
};
#[cfg(test)]
use std::{
    io::Write,
    sync::atomic::{AtomicUsize, Ordering},
};

const TAILSCALE_COMMANDS: [&str; 4] = [
    "tailscale",
    "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
    "/opt/homebrew/bin/tailscale",
    "/usr/local/bin/tailscale",
];
const LOCAL_STATUS_TIMEOUT: Duration = Duration::from_secs(2);
const PROCESS_POLL_INTERVAL: Duration = Duration::from_millis(10);
const MAX_LOCAL_STATUS_OUTPUT_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DetectedTailscaleHostname {
    pub(crate) hostname: String,
    pub(crate) addresses: Vec<IpAddr>,
}

pub(crate) trait TailscaleHostnameProvider: Send + Sync {
    fn detect(&self) -> Result<Option<DetectedTailscaleHostname>, String>;
}

#[derive(Debug, Default)]
pub(crate) struct LocalTailscaleHostnameProvider;

impl TailscaleHostnameProvider for LocalTailscaleHostnameProvider {
    fn detect(&self) -> Result<Option<DetectedTailscaleHostname>, String> {
        for command in TAILSCALE_COMMANDS {
            let output = match local_status_output(command) {
                Ok(Some(output)) => output,
                Ok(None) => continue,
                Err(error) => return Err(error),
            };
            if !output.status.success() {
                continue;
            }
            return parse_tailscale_status_json(&String::from_utf8_lossy(&output.stdout));
        }
        Ok(None)
    }
}

fn local_status_output(command: &str) -> Result<Option<Output>, String> {
    let mut command_process = Command::new(command);
    command_process.args(["status", "--json"]);
    match command_output_with_timeout(&mut command_process, LOCAL_STATUS_TIMEOUT) {
        Ok(output) => Ok(Some(output)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!(
            "failed to inspect local Tailscale status with {command}: {error}"
        )),
    }
}

fn command_output_with_timeout(
    command: &mut Command,
    timeout: Duration,
) -> std::io::Result<Output> {
    let mut stdout_file = tempfile::tempfile()?;
    let mut stderr_file = tempfile::tempfile()?;
    let mut child = command
        .stdout(Stdio::from(stdout_file.try_clone()?))
        .stderr(Stdio::from(stderr_file.try_clone()?))
        .spawn()?;
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() < timeout => thread::sleep(PROCESS_POLL_INTERVAL),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(Error::new(
                    ErrorKind::TimedOut,
                    format!("local command timed out after {timeout:?}"),
                ));
            }
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error);
            }
        }
    };
    Ok(Output {
        status,
        stdout: read_bounded_output(&mut stdout_file)?,
        stderr: read_bounded_output(&mut stderr_file)?,
    })
}

fn read_bounded_output(file: &mut File) -> std::io::Result<Vec<u8>> {
    file.seek(SeekFrom::Start(0))?;
    let mut bytes = Vec::new();
    file.take((MAX_LOCAL_STATUS_OUTPUT_BYTES + 1) as u64)
        .read_to_end(&mut bytes)?;
    if bytes.len() > MAX_LOCAL_STATUS_OUTPUT_BYTES {
        return Err(Error::new(
            ErrorKind::InvalidData,
            format!("local Tailscale status exceeded {MAX_LOCAL_STATUS_OUTPUT_BYTES} bytes"),
        ));
    }
    Ok(bytes)
}

#[derive(Deserialize)]
struct LocalTailscaleStatus {
    #[serde(rename = "Self")]
    self_node: Option<LocalTailscaleNode>,
}

#[derive(Deserialize)]
struct LocalTailscaleNode {
    #[serde(rename = "DNSName")]
    dns_name: Option<String>,
    #[serde(rename = "TailscaleIPs", default)]
    tailscale_ips: Vec<IpAddr>,
}

fn parse_tailscale_status_json(
    status_json: &str,
) -> Result<Option<DetectedTailscaleHostname>, String> {
    let status = serde_json::from_str::<LocalTailscaleStatus>(status_json)
        .map_err(|error| format!("failed to decode local Tailscale status: {error}"))?;
    let Some(node) = status.self_node else {
        return Ok(None);
    };
    let Some(hostname) = node
        .dns_name
        .as_deref()
        .map(normalize_magicdns_hostname)
        .transpose()?
    else {
        return Ok(None);
    };
    if node.tailscale_ips.is_empty() {
        return Ok(None);
    }
    Ok(Some(DetectedTailscaleHostname {
        hostname,
        addresses: node.tailscale_ips,
    }))
}

pub(crate) fn normalize_magicdns_hostname(hostname: &str) -> Result<String, String> {
    let normalized = hostname.trim().trim_end_matches('.').to_ascii_lowercase();
    if normalized.len() > 253 || !normalized.ends_with(".ts.net") {
        return Err("Tailscale hostname must be a MagicDNS name ending in .ts.net".to_string());
    }
    let labels = normalized.split('.').collect::<Vec<_>>();
    if labels.len() < 4
        || labels.iter().any(|label| {
            label.is_empty()
                || label.len() > 63
                || label.starts_with('-')
                || label.ends_with('-')
                || !label
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        })
    {
        return Err("Tailscale hostname is not a valid MagicDNS name".to_string());
    }
    Ok(normalized)
}

#[cfg(test)]
#[derive(Debug)]
pub(crate) struct FixedTailscaleHostnameProvider {
    detected: Option<DetectedTailscaleHostname>,
    calls: AtomicUsize,
    delay: Duration,
}

#[cfg(test)]
impl FixedTailscaleHostnameProvider {
    pub(crate) fn detected(hostname: &str, addresses: Vec<IpAddr>) -> Self {
        Self {
            detected: Some(DetectedTailscaleHostname {
                hostname: hostname.to_string(),
                addresses,
            }),
            calls: AtomicUsize::new(0),
            delay: Duration::ZERO,
        }
    }

    pub(crate) fn unavailable() -> Self {
        Self {
            detected: None,
            calls: AtomicUsize::new(0),
            delay: Duration::ZERO,
        }
    }

    pub(crate) fn delayed_unavailable(delay: Duration) -> Self {
        Self {
            detected: None,
            calls: AtomicUsize::new(0),
            delay,
        }
    }

    pub(crate) fn calls(&self) -> usize {
        self.calls.load(Ordering::Relaxed)
    }
}

#[cfg(test)]
impl TailscaleHostnameProvider for FixedTailscaleHostnameProvider {
    fn detect(&self) -> Result<Option<DetectedTailscaleHostname>, String> {
        self.calls.fetch_add(1, Ordering::Relaxed);
        thread::sleep(self.delay);
        Ok(self.detected.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_status_yields_a_normalized_magicdns_hostname_and_interface_addresses() {
        let detected = parse_tailscale_status_json(
            r#"{
                "Self": {
                    "DNSName": "Forge-Mac.Example.TS.NET.",
                    "TailscaleIPs": ["100.64.0.20", "fd7a:115c:a1e0::20"]
                }
            }"#,
        )
        .expect("valid local Tailscale status")
        .expect("detected host");

        assert_eq!(detected.hostname, "forge-mac.example.ts.net");
        assert_eq!(
            detected.addresses,
            vec![
                "100.64.0.20".parse::<IpAddr>().expect("IPv4 address"),
                "fd7a:115c:a1e0::20"
                    .parse::<IpAddr>()
                    .expect("IPv6 address"),
            ]
        );
    }

    #[cfg(unix)]
    #[test]
    fn local_status_command_is_killed_at_its_deadline() {
        let started = Instant::now();
        let error = command_output_with_timeout(
            Command::new("sh").args(["-c", "sleep 1"]),
            Duration::from_millis(20),
        )
        .expect_err("slow local status command must time out");

        assert_eq!(error.kind(), ErrorKind::TimedOut);
        assert!(started.elapsed() < Duration::from_millis(500));
    }

    #[cfg(unix)]
    #[test]
    fn exited_status_command_does_not_wait_for_descendant_held_output() {
        let started = Instant::now();
        let output = command_output_with_timeout(
            Command::new("sh").args(["-c", "(sleep 1) &"]),
            Duration::from_millis(100),
        )
        .expect("direct child exits successfully");

        assert!(output.status.success());
        assert!(started.elapsed() < Duration::from_millis(500));
    }

    #[test]
    fn local_status_output_is_size_bounded() {
        let mut file = tempfile::tempfile().expect("temporary output");
        file.write_all(&vec![b'x'; MAX_LOCAL_STATUS_OUTPUT_BYTES + 1])
            .expect("oversized fixture");

        let error = read_bounded_output(&mut file).expect_err("oversized output must fail");

        assert_eq!(error.kind(), ErrorKind::InvalidData);
    }
}
