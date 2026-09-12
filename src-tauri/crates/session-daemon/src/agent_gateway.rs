//! Authenticated command forwarding and separately journaled lifecycle notifications.
use crate::backend::Backend;
use axum::{
    body::{to_bytes, Body},
    extract::{Request, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::any,
    Json, Router,
};
use hyper_util::rt::TokioIo;
use openforge_session_protocol::SidecarEndpoint;
use std::{
    sync::{Arc, RwLock},
    time::Duration,
};
use tokio::sync::Semaphore;

pub(crate) type Registration = Arc<RwLock<Option<Arc<SidecarEndpoint>>>>;
const REQUEST_LIMIT: usize = 64 * 1024;
const RESPONSE_LIMIT: usize = 4 * 1024 * 1024;
const DEADLINE: Duration = Duration::from_secs(30);

#[derive(Clone)]
struct GatewayState {
    backend: Backend,
    registration: Registration,
    notifications: Arc<std::sync::Mutex<crate::notification_journal::NotificationJournal>>,
}

pub(crate) fn start(
    listener: std::net::TcpListener,
    backend: Backend,
    registration: Registration,
    notifications: crate::notification_journal::NotificationJournal,
) -> Result<(), openforge_session_protocol::Error> {
    listener
        .set_nonblocking(true)
        .map_err(openforge_session_client::runtime::io_error)?;
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(openforge_session_client::runtime::io_error)?;
    std::thread::Builder::new()
        .name("agent-gateway".into())
        .spawn(move || {
            runtime.block_on(async move {
                let Ok(listener) = tokio::net::TcpListener::from_std(listener) else {
                    return;
                };
                let notifications = Arc::new(std::sync::Mutex::new(notifications));
                tokio::spawn(crate::notification_delivery::run(
                    Arc::clone(&notifications),
                    Arc::clone(&registration),
                    backend.clone(),
                ));
                let router = Router::new()
                    .fallback(any(forward))
                    .with_state(GatewayState {
                        backend,
                        registration,
                        notifications,
                    });
                let permits = Arc::new(Semaphore::new(32));
                loop {
                    let Ok((stream, _)) = listener.accept().await else {
                        break;
                    };
                    let Ok(permit) = Arc::clone(&permits).try_acquire_owned() else {
                        reject_capacity(stream).await;
                        continue;
                    };
                    let router = router.clone();
                    tokio::spawn(async move {
                        let _permit = permit;
                        crate::agent_connection::serve(
                            stream,
                            router,
                            DEADLINE + Duration::from_secs(8),
                        )
                        .await;
                    });
                }
            })
        })
        .map_err(openforge_session_client::runtime::io_error)?;
    Ok(())
}

// A single bounded rejection slot, not a queue of domain requests.
async fn reject_capacity(stream: tokio::net::TcpStream) {
    let router = Router::new().fallback(|| async {
        rejected(
            StatusCode::SERVICE_UNAVAILABLE,
            "gateway capacity exhausted; request not executed",
        )
    });
    crate::agent_connection::serve(stream, router, Duration::from_millis(200)).await;
}

pub(super) fn rejected(status: StatusCode, message: &'static str) -> Response {
    (status, Json(serde_json::json!({"outcome":"notExecuted", "error":message, "retry":"retry only after correcting the request or backend availability returns"}))).into_response()
}
fn unavailable() -> Response {
    rejected(
        StatusCode::SERVICE_UNAVAILABLE,
        "Sidecar unavailable; request not executed",
    )
}
fn unknown() -> Response {
    (StatusCode::BAD_GATEWAY, Json(serde_json::json!({"outcome":"unknown", "error":"forwarded request outcome unknown", "retry":"do not automatically retry; inspect current state before issuing another mutation"}))).into_response()
}

async fn forward(State(state): State<GatewayState>, request: Request) -> Response {
    if request
        .headers()
        .get_all(header::AUTHORIZATION)
        .iter()
        .count()
        != 1
    {
        return rejected(
            StatusCode::UNAUTHORIZED,
            "exactly one agent authorization is required",
        );
    }
    let token = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));
    let Some(token) = token else {
        return rejected(StatusCode::UNAUTHORIZED, "agent authorization required");
    };
    let Ok(agent) = state.backend.authenticate_agent(token) else {
        return rejected(StatusCode::UNAUTHORIZED, "agent authorization rejected");
    };
    // Identity is derived from the capability, never from caller-supplied ownership headers.
    if request
        .headers()
        .keys()
        .any(|name| name.as_str().starts_with("x-openforge-"))
    {
        return rejected(
            StatusCode::FORBIDDEN,
            "caller-supplied ownership is forbidden",
        );
    }
    if request.uri().path() == openforge_session_protocol::NOTIFICATION_PATH {
        if request.method() != "POST" || request.uri().query().is_some() {
            return rejected(StatusCode::BAD_REQUEST, "invalid notification request");
        }
        let bytes = match tokio::time::timeout(
            Duration::from_secs(2),
            to_bytes(
                request.into_body(),
                openforge_session_protocol::MAX_NOTIFICATION_BYTES,
            ),
        )
        .await
        {
            Ok(Ok(bytes)) => bytes,
            _ => {
                return rejected(
                    StatusCode::PAYLOAD_TOO_LARGE,
                    "notification body exceeds limit or is incomplete",
                )
            }
        };
        let envelope = match serde_json::from_slice::<
            openforge_session_protocol::NotificationEnvelope,
        >(&bytes)
        {
            Ok(envelope) => envelope,
            Err(_) => return rejected(StatusCode::BAD_REQUEST, "invalid notification envelope"),
        };
        return match tokio::task::spawn_blocking(move || {
            state
                .notifications
                .lock()
                .map_err(|_| openforge_session_protocol::Error::OutcomeUnknown)?
                .accept(&agent, envelope)
        })
        .await
        {
            Ok(Ok(receipt)) => (StatusCode::ACCEPTED, Json(receipt)).into_response(),
            Ok(Err(openforge_session_protocol::Error::InvalidRequest)) => {
                rejected(StatusCode::BAD_REQUEST, "invalid notification envelope")
            }
            Ok(Err(openforge_session_protocol::Error::Unauthorized)) => {
                rejected(StatusCode::FORBIDDEN, "notification ownership rejected")
            }
            Ok(Err(openforge_session_protocol::Error::OperationConflict)) => rejected(
                StatusCode::CONFLICT,
                "notification ID reused with different payload",
            ),
            _ => rejected(
                StatusCode::SERVICE_UNAVAILABLE,
                "notification journal full or unavailable; acceptance not confirmed",
            ),
        };
    }
    if !openforge_session_protocol::agent_route_allowed(
        request.method().as_str(),
        request.uri().path(),
    ) {
        return rejected(StatusCode::FORBIDDEN, "route unavailable to agents");
    }
    let Some(endpoint) = state
        .registration
        .read()
        .ok()
        .and_then(|value| value.clone())
    else {
        return unavailable();
    };
    let (parts, body) = request.into_parts();
    let bytes =
        match tokio::time::timeout(Duration::from_secs(2), to_bytes(body, REQUEST_LIMIT)).await {
            Ok(Ok(bytes)) => bytes,
            _ => {
                return rejected(
                    StatusCode::PAYLOAD_TOO_LARGE,
                    "request body invalid, too large or incomplete",
                )
            }
        };
    if (!bytes.is_empty()
        && !serde_json::from_slice::<serde_json::Value>(&bytes).is_ok_and(|v| v.is_object()))
        || (parts.method == "GET" && !bytes.is_empty())
    {
        return rejected(StatusCode::BAD_REQUEST, "malformed JSON request");
    }
    let stream = match tokio::time::timeout(
        Duration::from_secs(2),
        tokio::net::TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, endpoint.port)),
    )
    .await
    {
        Ok(Ok(stream)) => stream,
        _ => return unavailable(),
    };
    let Ok((mut sender, connection)) =
        hyper::client::conn::http1::handshake(TokioIo::new(stream)).await
    else {
        return unavailable();
    };
    let connection = tokio::spawn(async move {
        let _ = connection.await;
    });
    let current = state
        .registration
        .read()
        .ok()
        .and_then(|value| value.clone());
    if !current.is_some_and(|value| Arc::ptr_eq(&value, &endpoint)) {
        connection.abort();
        return unavailable();
    }
    let uri = parts
        .uri
        .path_and_query()
        .map(|v| v.as_str())
        .unwrap_or("/");
    let outgoing = hyper::Request::builder()
        .method(parts.method)
        .uri(uri)
        .header(header::HOST, format!("127.0.0.1:{}", endpoint.port))
        .header(header::AUTHORIZATION, format!("Bearer {}", endpoint.token))
        .header(header::CONTENT_TYPE, "application/json")
        .header("x-openforge-agent-task", agent.owner.task_id())
        .header("x-openforge-agent-session", agent.owner.session_key())
        .header("x-openforge-agent-instance", agent.pty.instance.to_string())
        .header(
            "x-openforge-agent-installation",
            agent.pty.installation.as_str(),
        )
        .body(Body::from(bytes));
    let Ok(outgoing) = outgoing else {
        connection.abort();
        return rejected(StatusCode::BAD_REQUEST, "invalid owner identity");
    };
    // This is the forwarding boundary. All subsequent failures have unknown outcome.
    // HTTP/1, one connection, one send: no redirects, retries, buffering queue or replay.
    let result = tokio::time::timeout(DEADLINE, async {
        let response = sender.send_request(outgoing).await.map_err(|_| ())?;
        let status = response.status();
        let bytes = to_bytes(Body::new(response.into_body()), RESPONSE_LIMIT)
            .await
            .map_err(|_| ())?;
        Ok::<_, ()>((status, bytes))
    })
    .await;
    connection.abort();
    match result {
        Ok(Ok((status, bytes))) => {
            let text = String::from_utf8_lossy(&bytes)
                .replace(&endpoint.token, "<redacted>")
                .replace(&agent.token, "<redacted>");
            (status, [(header::CONTENT_TYPE, "application/json")], text).into_response()
        }
        _ => unknown(),
    }
}
