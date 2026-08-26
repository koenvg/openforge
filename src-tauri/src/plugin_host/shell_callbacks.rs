use super::callbacks::{optional_param_string, required_param_string};
use super::PluginHost;
use crate::pty_manager::shell_session_key;
use serde_json::Value;

impl PluginHost {
    fn pty_manager_for_host(&self) -> Result<crate::pty_manager::PtyManager, String> {
        self.app_handle
            .try_state::<crate::pty_manager::PtyManager>()
            .map(|state| state.inner().clone())
            .ok_or_else(|| "PTY manager is not available".to_string())
    }

    pub(super) async fn spawn_shell_for_host(&self, params: &Value) -> Result<Value, String> {
        let task_id = required_param_string(params, "taskId")?;
        let cwd = required_param_string(params, "cwd")?;
        let cols = required_param_u16(params, "cols")?;
        let rows = required_param_u16(params, "rows")?;
        let terminal_index = Some(required_param_u32(params, "terminalIndex")?);
        let terminal_image_protocol =
            match optional_param_string(params, "terminalImageProtocol")?.as_deref() {
                None => None,
                Some("iterm2") => Some(crate::pty_manager::TerminalImageProtocol::Iterm2),
                Some(value) => return Err(format!("unsupported terminal image protocol: {value}")),
            };
        let pty_manager = self.pty_manager_for_host()?;
        serde_json::to_value(
            pty_manager
                .spawn_shell_pty(
                    crate::pty_manager::PtySpawnContext {
                        task_id: &task_id,
                        cwd: std::path::Path::new(&cwd),
                        cols,
                        rows,
                        app_handle: Some(self.app_handle.clone()),
                        app_event_tx: self.app_event_tx.clone(),
                    },
                    terminal_index,
                    terminal_image_protocol,
                )
                .await
                .map_err(|error| format!("failed to spawn shell PTY: {error}"))?,
        )
        .map_err(|error| format!("failed to serialize shell PTY id: {error}"))
    }

    pub(super) async fn write_shell_for_host(&self, params: &Value) -> Result<Value, String> {
        let task_id = required_shell_session_key(params)?;
        let data = params
            .get("data")
            .and_then(Value::as_str)
            .ok_or_else(|| "plugin host callback missing string param: data".to_string())?;
        self.pty_manager_for_host()?
            .write_pty(&task_id, data.as_bytes())
            .await
            .map_err(|error| format!("failed to write to PTY: {error}"))?;
        Ok(Value::Null)
    }

    pub(super) async fn resize_shell_for_host(&self, params: &Value) -> Result<Value, String> {
        let task_id = required_shell_session_key(params)?;
        let cols = required_param_u16(params, "cols")?;
        let rows = required_param_u16(params, "rows")?;
        self.pty_manager_for_host()?
            .resize_pty(&task_id, cols, rows)
            .await
            .map_err(|error| format!("failed to resize PTY: {error}"))?;
        Ok(Value::Null)
    }

    pub(super) async fn kill_shell_for_host(&self, params: &Value) -> Result<Value, String> {
        let task_id = required_shell_session_key(params)?;
        self.pty_manager_for_host()?
            .kill_pty(&task_id)
            .await
            .map_err(|error| format!("failed to kill PTY: {error}"))?;
        Ok(Value::Null)
    }

    pub(super) async fn get_shell_buffer_for_host(&self, params: &Value) -> Result<Value, String> {
        let task_id = required_shell_session_key(params)?;
        serde_json::to_value(
            self.pty_manager_for_host()?
                .pty_buffer_state(&task_id)
                .await,
        )
        .map_err(|error| format!("failed to serialize PTY buffer: {error}"))
    }
}

fn required_shell_session_key(params: &Value) -> Result<String, String> {
    let task_id = required_param_string(params, "taskId")?;
    let terminal_index = required_param_u32(params, "terminalIndex")?;
    Ok(shell_session_key(&task_id, Some(terminal_index)))
}

fn required_param_u16(params: &Value, key: &str) -> Result<u16, String> {
    required_unsigned_param(params, key)
}

fn required_param_u32(params: &Value, key: &str) -> Result<u32, String> {
    required_unsigned_param(params, key)
}

fn required_unsigned_param<T>(params: &Value, key: &str) -> Result<T, String>
where
    T: TryFrom<u64>,
{
    let value = params
        .get(key)
        .and_then(Value::as_u64)
        .ok_or_else(|| format!("plugin host callback missing integer param: {key}"))?;
    T::try_from(value)
        .map_err(|_| format!("plugin host callback integer param out of range: {key}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn shell_session_key_uses_task_id_and_terminal_index() {
        let params = json!({ "taskId": "project-P-1", "terminalIndex": 2 });

        assert_eq!(
            required_shell_session_key(&params).expect("valid shell request"),
            "project-P-1-shell-2"
        );
    }

    #[test]
    fn shell_session_key_supports_the_pty_u32_index_range() {
        let params = json!({ "taskId": "project-P-1", "terminalIndex": u32::MAX });

        assert_eq!(
            required_shell_session_key(&params).expect("valid shell request"),
            "project-P-1-shell-4294967295"
        );
    }

    #[test]
    fn shell_session_key_rejects_an_index_above_the_pty_u32_range() {
        let params = json!({
            "taskId": "project-P-1",
            "terminalIndex": u64::from(u32::MAX) + 1,
        });

        assert_eq!(
            required_shell_session_key(&params).expect_err("terminalIndex should be rejected"),
            "plugin host callback integer param out of range: terminalIndex"
        );
    }

    #[test]
    fn shell_session_key_rejects_missing_terminal_index() {
        let params = json!({ "taskId": "project-P-1" });

        assert_eq!(
            required_shell_session_key(&params).expect_err("terminalIndex should be required"),
            "plugin host callback missing integer param: terminalIndex"
        );
    }
}
