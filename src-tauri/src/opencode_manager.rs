use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tokio::time::{sleep, timeout};

const OPENCODE_PORT: u16 = 4096;
const OPENCODE_HOST: &str = "127.0.0.1";
const HEALTH_CHECK_INTERVAL: Duration = Duration::from_millis(500);
const HEALTH_CHECK_TIMEOUT: Duration = Duration::from_secs(30);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug)]
pub enum OpenCodeError {
    CommandNotFound,
    SpawnFailed(std::io::Error),
    HealthCheckTimeout,
    HealthCheckFailed(String),
}

impl std::fmt::Display for OpenCodeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            OpenCodeError::CommandNotFound => {
                write!(f, "OpenCode CLI not found in PATH. Please install OpenCode: https://github.com/opencode/opencode")
            }
            OpenCodeError::SpawnFailed(e) => write!(f, "Failed to spawn opencode process: {}", e),
            OpenCodeError::HealthCheckTimeout => {
                write!(f, "OpenCode server failed to become healthy within {} seconds", HEALTH_CHECK_TIMEOUT.as_secs())
            }
            OpenCodeError::HealthCheckFailed(e) => write!(f, "Health check failed: {}", e),
        }
    }
}

impl std::error::Error for OpenCodeError {}

/// Manages the OpenCode web server process lifecycle
pub struct OpenCodeManager {
    child: Arc<Mutex<Option<Child>>>,
    health_url: String,
}

impl OpenCodeManager {
    /// Spawns the OpenCode web server and waits for it to become healthy
    pub async fn start() -> Result<Self, OpenCodeError> {
        // Check if opencode command exists
        let opencode_path = which::which("opencode").map_err(|_| OpenCodeError::CommandNotFound)?;

        println!("Starting OpenCode server at {}:{}", OPENCODE_HOST, OPENCODE_PORT);

        // Spawn the opencode web process
        let child = Command::new(opencode_path)
            .arg("serve")
            .arg("--port")
            .arg(OPENCODE_PORT.to_string())
            .arg("--hostname")
            .arg(OPENCODE_HOST)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(OpenCodeError::SpawnFailed)?;

        let manager = Self {
            child: Arc::new(Mutex::new(Some(child))),
            health_url: format!("http://{}:{}/global/health", OPENCODE_HOST, OPENCODE_PORT),
        };

        // Wait for server to become healthy
        manager.wait_for_health().await?;

        println!("OpenCode server is healthy and ready");

        Ok(manager)
    }

    /// Polls the health endpoint until the server responds or timeout is reached
    async fn wait_for_health(&self) -> Result<(), OpenCodeError> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .map_err(|e| OpenCodeError::HealthCheckFailed(e.to_string()))?;

        let health_check = async {
            loop {
                match client.get(&self.health_url).send().await {
                    Ok(response) if response.status().is_success() => {
                        println!("Health check passed: {}", response.status());
                        return Ok(());
                    }
                    Ok(response) => {
                        println!("Health check returned non-success status: {}", response.status());
                    }
                    Err(e) => {
                        println!("Health check failed (will retry): {}", e);
                    }
                }
                sleep(HEALTH_CHECK_INTERVAL).await;
            }
        };

        timeout(HEALTH_CHECK_TIMEOUT, health_check)
            .await
            .map_err(|_| OpenCodeError::HealthCheckTimeout)?
    }

    /// Returns the base URL for the OpenCode API
    pub fn api_url(&self) -> String {
        format!("http://{}:{}", OPENCODE_HOST, OPENCODE_PORT)
    }

    /// Gracefully shuts down the OpenCode server
    pub async fn shutdown(&self) -> Result<(), std::io::Error> {
        let mut child_guard = self.child.lock().await;
        
        if let Some(mut child) = child_guard.take() {
            println!("Shutting down OpenCode server...");

            // Try graceful shutdown first (SIGTERM)
            #[cfg(unix)]
            {
                use nix::sys::signal::{kill, Signal};
                use nix::unistd::Pid;
                
                if let Some(pid) = child.id() {
                    let pid = Pid::from_raw(pid as i32);
                    let _ = kill(pid, Signal::SIGTERM);
                    
                    // Wait for graceful shutdown with timeout
                    let wait_result = timeout(SHUTDOWN_TIMEOUT, child.wait()).await;
                    
                    match wait_result {
                        Ok(Ok(status)) => {
                            println!("OpenCode server exited gracefully: {:?}", status);
                            return Ok(());
                        }
                        _ => {
                            println!("Graceful shutdown timed out, forcing kill...");
                        }
                    }
                }
            }

            // Force kill if graceful shutdown failed or on Windows
            child.kill().await?;
            println!("OpenCode server killed");
        }

        Ok(())
    }
}

impl Drop for OpenCodeManager {
    fn drop(&mut self) {
        // Attempt cleanup in drop, but can't await in sync context
        // The shutdown() method should be called explicitly before drop
        println!("OpenCodeManager dropped");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_opencode_command_exists() {
        // This test verifies that the opencode command is available
        let result = which::which("opencode");
        assert!(result.is_ok(), "opencode command should be in PATH");
    }
}
