use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct TerminalDimensions {
    pub(crate) columns: u16,
    pub(crate) rows: u16,
}

impl TerminalDimensions {
    fn new(columns: u16, rows: u16) -> Result<Self, String> {
        if columns == 0 || rows == 0 {
            return Err("terminal dimensions must be positive".to_string());
        }
        Ok(Self { columns, rows })
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
enum ClientTerminalControlWire {
    Attach { columns: u16, rows: u16 },
    Resize { columns: u16, rows: u16 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ClientTerminalControl {
    Attach(TerminalDimensions),
    Resize(TerminalDimensions),
}

impl ClientTerminalControl {
    pub(crate) fn decode(encoded: &str) -> Result<Self, String> {
        let wire: ClientTerminalControlWire =
            serde_json::from_str(encoded).map_err(|_| "invalid terminal control".to_string())?;
        match wire {
            ClientTerminalControlWire::Attach { columns, rows } => {
                TerminalDimensions::new(columns, rows).map(Self::Attach)
            }
            ClientTerminalControlWire::Resize { columns, rows } => {
                TerminalDimensions::new(columns, rows).map(Self::Resize)
            }
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum TerminalInitialState {
    Replay,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum TerminalErrorCode {
    NoActiveAgentTerminal,
    AttachmentReplaced,
    ProtocolError,
    SlowConsumer,
    TemporarilyUnavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum ServerTerminalControl {
    Ready {
        #[serde(rename = "initialState")]
        initial_state: TerminalInitialState,
    },
    Exited,
    Error {
        code: TerminalErrorCode,
        message: String,
    },
    AuthorizationRevoked,
    GatewayClosing,
}

impl ServerTerminalControl {
    #[cfg(test)]
    pub(crate) fn decode(encoded: &str) -> Result<Self, String> {
        let value: serde_json::Value =
            serde_json::from_str(encoded).map_err(|_| "invalid terminal control".to_string())?;
        let object = value
            .as_object()
            .ok_or_else(|| "invalid terminal control".to_string())?;
        let expected_fields: &[&str] = match object.get("type").and_then(serde_json::Value::as_str)
        {
            Some("ready") => &["type", "initialState"],
            Some("exited") | Some("authorization_revoked") | Some("gateway_closing") => &["type"],
            Some("error") => &["type", "code", "message"],
            _ => return Err("invalid terminal control".to_string()),
        };
        if object.len() != expected_fields.len()
            || object
                .keys()
                .any(|field| !expected_fields.contains(&field.as_str()))
        {
            return Err("invalid terminal control".to_string());
        }
        serde_json::from_value(value).map_err(|_| "invalid terminal control".to_string())
    }

    pub(crate) fn encode(&self) -> Result<String, String> {
        serde_json::to_string(self).map_err(|_| "failed to encode terminal control".to_string())
    }

    pub(crate) fn ready() -> Self {
        Self::Ready {
            initial_state: TerminalInitialState::Replay,
        }
    }

    pub(crate) fn no_active_agent_terminal() -> Self {
        Self::Error {
            code: TerminalErrorCode::NoActiveAgentTerminal,
            message: "No active Agent terminal".to_string(),
        }
    }
}
