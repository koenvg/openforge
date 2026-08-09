#[cfg(test)]
use super::contract::CompanionAuthorizer;
use super::{
    contract::CompanionErrorCode,
    pairing::{CompanionStreamTermination as PairingStreamTermination, PairingCoordinator},
    project_board::CompanionProjectBoardSource,
};
use crate::app_events::{AppEventBus, AppEventFrame, AppEventSubscription};
use axum::{http::HeaderMap, response::sse::Event};
use futures::Stream;
use serde::Serialize;
use std::{convert::Infallible, sync::Arc};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CompanionStreamTermination {
    AuthorizationRevoked,
    GatewayClosing,
}

/// Narrow integration seam for stream authorization and targeted cancellation.
///
/// The canonical SSE route depends only on this opaque cancellation receiver. Paired-device
/// lifecycle code can issue immediate device-specific termination without learning about App
/// Event Bus envelopes or the public invalidation protocol.
pub(crate) trait CompanionStreamAccess: Send + Sync {
    fn open(
        &self,
        headers: &HeaderMap,
    ) -> Result<tokio::sync::mpsc::UnboundedReceiver<CompanionStreamTermination>, CompanionErrorCode>;

    fn gateway_closing(&self);
}

/// Test fallback for routers that inject a standalone authorizer.
#[cfg(test)]
pub(crate) struct GatewayCompanionStreamAccess {
    authorizer: Arc<dyn CompanionAuthorizer>,
    gateway_closing: tokio::sync::broadcast::Sender<()>,
}

#[cfg(test)]
impl GatewayCompanionStreamAccess {
    pub(crate) fn new(authorizer: Arc<dyn CompanionAuthorizer>) -> Self {
        let (gateway_closing, _) = tokio::sync::broadcast::channel(16);
        Self {
            authorizer,
            gateway_closing,
        }
    }
}

#[cfg(test)]
impl CompanionStreamAccess for GatewayCompanionStreamAccess {
    fn open(
        &self,
        headers: &HeaderMap,
    ) -> Result<tokio::sync::mpsc::UnboundedReceiver<CompanionStreamTermination>, CompanionErrorCode>
    {
        self.authorizer.authorize(headers)?;
        let mut shutdown = self.gateway_closing.subscribe();
        let (sender, receiver) = tokio::sync::mpsc::unbounded_channel();
        tokio::spawn(async move {
            tokio::select! {
                _ = sender.closed() => {}
                result = shutdown.recv() => {
                    if result.is_ok() {
                        let _ = sender.send(CompanionStreamTermination::GatewayClosing);
                    }
                }
            }
        });
        Ok(receiver)
    }

    fn gateway_closing(&self) {
        let _ = self.gateway_closing.send(());
    }
}

/// Production stream access backed by the paired-device trust lifecycle.
pub(crate) struct PairingCompanionStreamAccess {
    pairing: Arc<PairingCoordinator>,
}

impl PairingCompanionStreamAccess {
    pub(crate) fn new(pairing: Arc<PairingCoordinator>) -> Self {
        Self { pairing }
    }
}

impl CompanionStreamAccess for PairingCompanionStreamAccess {
    fn open(
        &self,
        headers: &HeaderMap,
    ) -> Result<tokio::sync::mpsc::UnboundedReceiver<CompanionStreamTermination>, CompanionErrorCode>
    {
        let mut authorization = self.pairing.authorize_stream(headers)?;
        let (sender, receiver) = tokio::sync::mpsc::unbounded_channel();
        tokio::spawn(async move {
            tokio::select! {
                _ = sender.closed() => {}
                termination = authorization.wait_for_termination() => {
                    let termination = match termination {
                        PairingStreamTermination::DeviceRevoked { .. }
                        | PairingStreamTermination::AllDevicesRevoked => {
                            CompanionStreamTermination::AuthorizationRevoked
                        }
                        PairingStreamTermination::GatewayClosing => {
                            CompanionStreamTermination::GatewayClosing
                        }
                    };
                    let _ = sender.send(termination);
                }
            }
        });
        Ok(receiver)
    }

    fn gateway_closing(&self) {
        self.pairing.notify_gateway_closing();
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicResourceInvalidation<'a> {
    resources: Vec<PublicResource<'a>>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum PublicResource<'a> {
    Attention,
    ProjectCatalog,
    ProjectBoard { id: &'a str },
    Task { id: &'a str },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicGap {
    refresh_required: bool,
}

#[derive(Debug, Serialize)]
struct PublicAuthorizationTermination {
    reason: &'static str,
}

#[derive(Debug, Serialize)]
struct PublicGatewayTermination {
    reason: &'static str,
}

struct StreamState {
    subscription: AppEventSubscription,
    cancellation: tokio::sync::mpsc::UnboundedReceiver<CompanionStreamTermination>,
    project_board: Arc<dyn CompanionProjectBoardSource>,
    terminal: bool,
}

pub(crate) fn companion_event_stream(
    events: &AppEventBus,
    cursor: Option<crate::app_events::AppEventCursor>,
    cancellation: tokio::sync::mpsc::UnboundedReceiver<CompanionStreamTermination>,
    project_board: Arc<dyn CompanionProjectBoardSource>,
) -> Result<impl Stream<Item = Result<Event, Infallible>> + Send + 'static, CompanionErrorCode> {
    let subscription = events
        .subscribe(cursor)
        .map_err(|_| CompanionErrorCode::TemporarilyUnavailable)?;
    Ok(futures::stream::unfold(
        StreamState {
            subscription,
            cancellation,
            project_board,
            terminal: false,
        },
        |mut state| async move {
            if state.terminal {
                return None;
            }
            loop {
                tokio::select! {
                    biased;
                    termination = state.cancellation.recv() => {
                        match termination {
                            Some(CompanionStreamTermination::AuthorizationRevoked) => {
                                state.terminal = true;
                                let event = public_event(
                                    "authorization-revoked",
                                    &PublicAuthorizationTermination { reason: "revoked" },
                                );
                                return Some((Ok(event), state));
                            }
                            Some(CompanionStreamTermination::GatewayClosing) => {
                                state.terminal = true;
                                let event = public_event(
                                    "gateway-closing",
                                    &PublicGatewayTermination { reason: "shutdown" },
                                );
                                return Some((Ok(event), state));
                            }
                            None => return None,
                        }
                    }
                    frame = state.subscription.recv() => {
                        let frame = frame?;
                        if let Some(event) = map_app_event(frame, state.project_board.as_ref()) {
                            return Some((Ok(event), state));
                        }
                    }
                }
            }
        },
    ))
}

fn map_app_event(
    frame: AppEventFrame,
    project_board: &dyn CompanionProjectBoardSource,
) -> Option<Event> {
    match frame {
        AppEventFrame::Gap(gap) => Some(
            public_event(
                "stream-gap",
                &PublicGap {
                    refresh_required: true,
                },
            )
            .id(gap.newest_available.as_sse_id()),
        ),
        AppEventFrame::Event(envelope) => {
            let resources = match envelope.event_name.as_str() {
                "task-changed"
                | "agent-status-changed"
                | "ci-status-changed"
                | "review-status-changed" => {
                    let task_id = envelope.payload.get("task_id")?.as_str()?;
                    let project_id = envelope.payload.get("project_id")?.as_str()?;
                    if task_id.is_empty()
                        || project_id.is_empty()
                        || !project_board.is_project_visible(project_id).ok()?
                    {
                        return None;
                    }
                    vec![
                        PublicResource::Attention,
                        PublicResource::ProjectBoard { id: project_id },
                        PublicResource::Task { id: task_id },
                    ]
                }
                "project-catalog-changed" => vec![PublicResource::ProjectCatalog],
                "project-board-changed" => {
                    let project_id = envelope.payload.get("project_id")?.as_str()?;
                    if project_id.is_empty()
                        || !project_board.is_project_visible(project_id).ok()?
                    {
                        return None;
                    }
                    vec![PublicResource::ProjectBoard { id: project_id }]
                }
                "project-changed" => {
                    let project_id = envelope.payload.get("project_id")?.as_str()?;
                    let mut resources = vec![PublicResource::ProjectCatalog];
                    if !project_id.is_empty()
                        && project_board
                            .is_project_visible(project_id)
                            .unwrap_or(false)
                    {
                        resources.push(PublicResource::ProjectBoard { id: project_id });
                    }
                    resources
                }
                _ => return None,
            };
            let event = public_event(
                "resources-invalidated",
                &PublicResourceInvalidation { resources },
            );
            Some(with_envelope_id(event, &envelope))
        }
    }
}

fn public_event<T: Serialize>(name: &'static str, data: &T) -> Event {
    let data = serde_json::to_string(data).unwrap_or_else(|_| "{}".to_string());
    Event::default().event(name).data(data)
}

fn with_envelope_id(mut event: Event, envelope: &crate::app_events::AppEventEnvelope) -> Event {
    if let Some(id) = &envelope.id {
        event = event.id(id.as_sse_id());
    }
    event
}
