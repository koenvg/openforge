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
    PresentationBoundary {
        #[serde(rename = "sessionBinding")]
        session_binding: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        receipt: Option<String>,
        #[serde(rename = "finalOutput")]
        final_output: bool,
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
            Some("presentation_boundary") if object.contains_key("receipt") => {
                &["type", "sessionBinding", "receipt", "finalOutput"]
            }
            Some("presentation_boundary") => &["type", "sessionBinding", "finalOutput"],
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
        let control: Self =
            serde_json::from_value(value).map_err(|_| "invalid terminal control".to_string())?;
        if let Self::PresentationBoundary {
            session_binding,
            receipt,
            final_output,
        } = &control
        {
            let valid = |token: &str| {
                token.len() == 43
                    && token
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
            };
            if !valid(session_binding)
                || receipt.as_deref().is_some_and(|token| !valid(token))
                || (!final_output && receipt.is_none())
            {
                return Err("invalid terminal control".to_string());
            }
        }
        Ok(control)
    }

    pub(crate) fn encode(&self) -> Result<String, String> {
        serde_json::to_string(self).map_err(|_| "failed to encode terminal control".to_string())
    }

    pub(crate) fn ready() -> Self {
        Self::Ready {
            initial_state: TerminalInitialState::Replay,
        }
    }
    pub(crate) fn presentation_boundary(
        session_binding: String,
        receipt: Option<String>,
        final_output: bool,
    ) -> Self {
        Self::PresentationBoundary {
            session_binding,
            receipt,
            final_output,
        }
    }

    pub(crate) fn no_active_agent_terminal() -> Self {
        Self::Error {
            code: TerminalErrorCode::NoActiveAgentTerminal,
            message: "No active Agent terminal".to_string(),
        }
    }
}
