use super::contract::{CompanionAuthorizer, CompanionErrorCode};
use crate::app_events::{AppEventBus, AppEventFrame, AppEventSubscription};
use axum::{http::HeaderMap, response::sse::Event};
use futures::Stream;
use serde::Serialize;
use std::{convert::Infallible, sync::Arc};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CompanionStreamTermination {
    // Constructed by KVG-2950's device-targeted trust-lifecycle implementation.
    #[allow(dead_code)]
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

/// Default composition until paired-device lifecycle supplies device-targeted cancellation.
/// Authorization happens once at stream creation; the bearer header is not retained.
pub(crate) struct GatewayCompanionStreamAccess {
    authorizer: Arc<dyn CompanionAuthorizer>,
    gateway_closing: tokio::sync::broadcast::Sender<()>,
}

impl GatewayCompanionStreamAccess {
    pub(crate) fn new(authorizer: Arc<dyn CompanionAuthorizer>) -> Self {
        let (gateway_closing, _) = tokio::sync::broadcast::channel(16);
        Self {
            authorizer,
            gateway_closing,
        }
    }
}

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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicResourceInvalidation<'a> {
    resources: [PublicResource<'a>; 2],
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum PublicResource<'a> {
    Attention,
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
    terminal: bool,
}

pub(crate) fn companion_event_stream(
    events: &AppEventBus,
    cursor: Option<crate::app_events::AppEventCursor>,
    cancellation: tokio::sync::mpsc::UnboundedReceiver<CompanionStreamTermination>,
) -> Result<impl Stream<Item = Result<Event, Infallible>> + Send + 'static, CompanionErrorCode> {
    let subscription = events
        .subscribe(cursor)
        .map_err(|_| CompanionErrorCode::TemporarilyUnavailable)?;
    Ok(futures::stream::unfold(
        StreamState {
            subscription,
            cancellation,
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
                        if let Some(event) = map_app_event(frame) {
                            return Some((Ok(event), state));
                        }
                    }
                }
            }
        },
    ))
}

fn map_app_event(frame: AppEventFrame) -> Option<Event> {
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
            if !matches!(
                envelope.event_name.as_str(),
                "task-changed" | "agent-status-changed"
            ) {
                return None;
            }
            let task_id = envelope.payload.get("task_id")?.as_str()?;
            if task_id.is_empty() {
                return None;
            }
            let event = public_event(
                "resources-invalidated",
                &PublicResourceInvalidation {
                    resources: [
                        PublicResource::Attention,
                        PublicResource::Task { id: task_id },
                    ],
                },
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
