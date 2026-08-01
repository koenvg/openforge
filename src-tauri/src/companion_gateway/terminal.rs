use super::live_events::CompanionStreamTermination;
use super::terminal_protocol::{
    ClientTerminalControl, ServerTerminalControl, TerminalDimensions, TerminalErrorCode,
};
use crate::pty_manager::{AgentTerminalAttachmentError, AgentTerminalEvent, PtyManager};
use axum::extract::ws::{Message, WebSocket};
use std::collections::HashMap;
use std::future::Future;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{oneshot, Mutex};

const INITIAL_ATTACH_TIMEOUT: Duration = Duration::from_secs(10);
const SOCKET_SEND_TIMEOUT: Duration = Duration::from_secs(2);

struct RegisteredAttachment {
    id: u64,
    replace: oneshot::Sender<()>,
}

#[derive(Clone, Default)]
pub(crate) struct CompanionTerminalRegistry {
    next_id: Arc<AtomicU64>,
    active: Arc<Mutex<HashMap<String, RegisteredAttachment>>>,
}

impl CompanionTerminalRegistry {
    pub(crate) async fn register(&self, device_id: &str) -> (u64, oneshot::Receiver<()>) {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        let (replace, receiver) = oneshot::channel();
        let previous = self
            .active
            .lock()
            .await
            .insert(device_id.to_string(), RegisteredAttachment { id, replace });
        if let Some(previous) = previous {
            let _ = previous.replace.send(());
        }
        (id, receiver)
    }

    pub(crate) async fn unregister(&self, device_id: &str, id: u64) {
        let mut active = self.active.lock().await;
        if active.get(device_id).is_some_and(|entry| entry.id == id) {
            active.remove(device_id);
        }
    }
}

pub(crate) async fn serve_terminal_socket(
    mut socket: WebSocket,
    task_id: String,
    device_id: String,
    pty_manager: PtyManager,
    mut cancellation: tokio::sync::mpsc::UnboundedReceiver<CompanionStreamTermination>,
    registry: CompanionTerminalRegistry,
) {
    let (registration_id, mut replaced) = registry.register(&device_id).await;
    serve_registered_socket(
        &mut socket,
        &task_id,
        &pty_manager,
        &mut cancellation,
        &mut replaced,
    )
    .await;
    registry.unregister(&device_id, registration_id).await;
    let _ = tokio::time::timeout(SOCKET_SEND_TIMEOUT, socket.close()).await;
}

async fn serve_registered_socket(
    socket: &mut WebSocket,
    task_id: &str,
    pty_manager: &PtyManager,
    cancellation: &mut tokio::sync::mpsc::UnboundedReceiver<CompanionStreamTermination>,
    replaced: &mut oneshot::Receiver<()>,
) {
    let dimensions = match receive_initial_attach(socket, cancellation, replaced).await {
        Ok(dimensions) => dimensions,
        Err(stop) => {
            send_initialization_stop(socket, stop).await;
            return;
        }
    };
    let attachment_result = match initialization_step(
        cancellation,
        replaced,
        pty_manager.attach_agent_terminal(task_id),
    )
    .await
    {
        Ok(result) => result,
        Err(stop) => {
            send_initialization_stop(socket, stop).await;
            return;
        }
    };
    let mut attachment = match attachment_result {
        Ok(attachment) => attachment,
        Err(AgentTerminalAttachmentError::NoActiveAgentTerminal) => {
            let _ = send_control(socket, ServerTerminalControl::no_active_agent_terminal()).await;
            return;
        }
        Err(_) => {
            let _ = send_error(
                socket,
                TerminalErrorCode::TemporarilyUnavailable,
                "Agent terminal is temporarily unavailable",
            )
            .await;
            return;
        }
    };
    match initialization_step(
        cancellation,
        replaced,
        attachment.resize(dimensions.columns, dimensions.rows),
    )
    .await
    {
        Ok(Ok(())) => {}
        Ok(Err(_)) => {
            let _ = send_control(socket, ServerTerminalControl::no_active_agent_terminal()).await;
            return;
        }
        Err(stop) => {
            send_initialization_stop(socket, stop).await;
            return;
        }
    }
    let replay = attachment.replay().to_vec();
    if !replay.is_empty() {
        match initialization_step(cancellation, replaced, send_output(socket, replay)).await {
            Ok(Ok(())) => {}
            Ok(Err(())) => return,
            Err(stop) => {
                send_initialization_stop(socket, stop).await;
                return;
            }
        }
    }
    match initialization_step(
        cancellation,
        replaced,
        send_control(socket, ServerTerminalControl::ready()),
    )
    .await
    {
        Ok(Ok(())) => {}
        Ok(Err(())) => return,
        Err(stop) => {
            send_initialization_stop(socket, stop).await;
            return;
        }
    }

    loop {
        tokio::select! {
            biased;
            termination = cancellation.recv() => {
                let control = match termination {
                    Some(CompanionStreamTermination::AuthorizationRevoked) => {
                        ServerTerminalControl::AuthorizationRevoked
                    }
                    Some(CompanionStreamTermination::GatewayClosing) => {
                        ServerTerminalControl::GatewayClosing
                    }
                    None => break,
                };
                let _ = send_control(socket, control).await;
                break;
            }
            _ = &mut *replaced => {
                let _ = send_error(
                    socket,
                    TerminalErrorCode::AttachmentReplaced,
                    "Terminal attachment was replaced",
                ).await;
                break;
            },
            event = attachment.recv() => {
                match event {
                    Ok(AgentTerminalEvent::Output(output)) => {
                        if send_output(socket, output).await.is_err() {
                            break;
                        }
                    }
                    Ok(AgentTerminalEvent::Exited) => {
                        let _ = send_control(socket, ServerTerminalControl::Exited).await;
                        break;
                    }
                    Err(AgentTerminalAttachmentError::SlowConsumer) => {
                        let _ = send_error(
                            socket,
                            TerminalErrorCode::SlowConsumer,
                            "Terminal output consumer is too slow",
                        ).await;
                        break;
                    }
                    Err(_) => break,
                }
            }
            message = socket.recv() => {
                let Some(Ok(message)) = message else {
                    break;
                };
                match message {
                    Message::Text(encoded) => {
                        let Ok(ClientTerminalControl::Resize(dimensions)) =
                            ClientTerminalControl::decode(&encoded)
                        else {
                            let _ = send_protocol_error(socket).await;
                            break;
                        };
                        if attachment.resize(dimensions.columns, dimensions.rows).await.is_err() {
                            break;
                        }
                    }
                    Message::Ping(payload) => {
                        if send_message(socket, Message::Pong(payload)).await.is_err() {
                            break;
                        }
                    }
                    Message::Pong(_) => {}
                    Message::Close(_) => break,
                    Message::Binary(_) => {
                        let _ = send_protocol_error(socket).await;
                        break;
                    }
                }
            }
        }
    }
}

enum InitializationStop {
    Control(ServerTerminalControl),
    Replaced,
    ProtocolError,
    Closed,
}

fn termination_stop(termination: Option<CompanionStreamTermination>) -> InitializationStop {
    match termination {
        Some(CompanionStreamTermination::AuthorizationRevoked) => {
            InitializationStop::Control(ServerTerminalControl::AuthorizationRevoked)
        }
        Some(CompanionStreamTermination::GatewayClosing) => {
            InitializationStop::Control(ServerTerminalControl::GatewayClosing)
        }
        None => InitializationStop::Closed,
    }
}

async fn initialization_step<T, F>(
    cancellation: &mut tokio::sync::mpsc::UnboundedReceiver<CompanionStreamTermination>,
    replaced: &mut oneshot::Receiver<()>,
    future: F,
) -> Result<T, InitializationStop>
where
    F: Future<Output = T>,
{
    tokio::select! {
        biased;
        termination = cancellation.recv() => Err(termination_stop(termination)),
        _ = &mut *replaced => Err(InitializationStop::Replaced),
        result = future => Ok(result),
    }
}

async fn receive_initial_attach(
    socket: &mut WebSocket,
    cancellation: &mut tokio::sync::mpsc::UnboundedReceiver<CompanionStreamTermination>,
    replaced: &mut oneshot::Receiver<()>,
) -> Result<TerminalDimensions, InitializationStop> {
    let timeout = tokio::time::sleep(INITIAL_ATTACH_TIMEOUT);
    tokio::pin!(timeout);
    let message = tokio::select! {
        biased;
        termination = cancellation.recv() => return Err(termination_stop(termination)),
        _ = &mut *replaced => return Err(InitializationStop::Replaced),
        _ = &mut timeout => return Err(InitializationStop::Closed),
        message = socket.recv() => message,
    };
    let message = message
        .ok_or(InitializationStop::Closed)?
        .map_err(|_| InitializationStop::Closed)?;
    let Message::Text(encoded) = message else {
        return Err(InitializationStop::ProtocolError);
    };
    match ClientTerminalControl::decode(&encoded) {
        Ok(ClientTerminalControl::Attach(dimensions)) => Ok(dimensions),
        _ => Err(InitializationStop::ProtocolError),
    }
}

async fn send_initialization_stop(socket: &mut WebSocket, stop: InitializationStop) {
    match stop {
        InitializationStop::Control(control) => {
            let _ = send_control(socket, control).await;
        }
        InitializationStop::Replaced => {
            let _ = send_error(
                socket,
                TerminalErrorCode::AttachmentReplaced,
                "Terminal attachment was replaced",
            )
            .await;
        }
        InitializationStop::ProtocolError => {
            let _ = send_protocol_error(socket).await;
        }
        InitializationStop::Closed => {}
    }
}

async fn send_protocol_error(socket: &mut WebSocket) -> Result<(), ()> {
    send_error(
        socket,
        TerminalErrorCode::ProtocolError,
        "Invalid terminal protocol frame",
    )
    .await
}

async fn send_error(
    socket: &mut WebSocket,
    code: TerminalErrorCode,
    message: &str,
) -> Result<(), ()> {
    send_control(
        socket,
        ServerTerminalControl::Error {
            code,
            message: message.to_string(),
        },
    )
    .await
}

async fn send_control(socket: &mut WebSocket, control: ServerTerminalControl) -> Result<(), ()> {
    let encoded = control.encode().map_err(|_| ())?;
    send_message(socket, Message::Text(encoded)).await
}

async fn send_output(socket: &mut WebSocket, output: Vec<u8>) -> Result<(), ()> {
    send_message(socket, Message::Binary(output)).await
}

async fn send_message(socket: &mut WebSocket, message: Message) -> Result<(), ()> {
    tokio::time::timeout(SOCKET_SEND_TIMEOUT, socket.send(message))
        .await
        .map_err(|_| ())?
        .map_err(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn newer_attachment_replaces_only_the_same_device() {
        let registry = CompanionTerminalRegistry::default();
        let (first_id, mut first) = registry.register("device-a").await;
        let (_other_id, mut other) = registry.register("device-b").await;
        let (new_id, _new) = registry.register("device-a").await;

        assert!(first.try_recv().is_ok());
        assert!(other.try_recv().is_err());

        registry.unregister("device-a", first_id).await;
        assert!(registry.active.lock().await.contains_key("device-a"));
        registry.unregister("device-a", new_id).await;
        assert!(!registry.active.lock().await.contains_key("device-a"));
    }
}
