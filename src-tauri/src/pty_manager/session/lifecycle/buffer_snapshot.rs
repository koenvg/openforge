use std::sync::Arc;

use base64::Engine;
use log::warn;

use super::super::super::authority::ParsedStateOwner;
use super::super::super::{PtyBufferState, PtyManager, TerminalViewSnapshot};

impl PtyManager {
    pub async fn pty_buffer_state(&self, session_key: &str) -> PtyBufferState {
        let live_session = self
            .terminal_sessions
            .sessions
            .lock()
            .await
            .get(session_key)
            .map(|session| {
                (
                    session.instance_id,
                    session.authority,
                    session.terminal_model.as_ref().map(Arc::clone),
                )
            });

        let Some((instance_id, authority, terminal_model)) = live_session else {
            return PtyBufferState {
                authority: None,
                buffer: self.get_pty_buffer(session_key).await,
                snapshot: None,
                is_live: false,
                instance_id: None,
            };
        };

        if authority.parsed_state_owner == ParsedStateOwner::Ghostty {
            let snapshot = if let Some(terminal_model) = terminal_model {
                match tokio::task::spawn_blocking(move || terminal_model.portable_snapshot()).await
                {
                    Ok(Ok(snapshot)) if snapshot.instance_id == instance_id => {
                        Some(TerminalViewSnapshot {
                            instance_id: snapshot.instance_id,
                            watermark: snapshot.watermark,
                            data: base64::engine::general_purpose::STANDARD
                                .encode(snapshot.portable_vt),
                        })
                    }
                    Ok(Ok(_)) => None,
                    Ok(Err(error)) => {
                        warn!(
                            "[terminal-model] key={} instance={} snapshot unavailable: {}",
                            session_key, instance_id, error
                        );
                        None
                    }
                    Err(error) => {
                        warn!(
                            "[terminal-model] key={} instance={} snapshot worker failed: {}",
                            session_key, instance_id, error
                        );
                        None
                    }
                }
            } else {
                None
            };
            return PtyBufferState {
                authority: Some("ghostty-authoritative"),
                buffer: None,
                snapshot,
                is_live: true,
                instance_id: Some(instance_id),
            };
        }

        PtyBufferState {
            authority: Some("xterm-authoritative"),
            buffer: self.get_pty_buffer(session_key).await,
            snapshot: None,
            is_live: true,
            instance_id: Some(instance_id),
        }
    }

    pub async fn get_pty_buffer(&self, session_key: &str) -> Option<String> {
        let buffers = self.terminal_sessions.output_buffers.lock().await;
        let buffer = buffers.get(session_key)?;
        let buf = buffer.lock().unwrap();
        let content = buf.snapshot();
        if content.is_empty() {
            None
        } else {
            Some(content)
        }
    }
}
