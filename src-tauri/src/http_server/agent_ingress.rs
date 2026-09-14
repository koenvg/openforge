//! Private Sidecar boundary for daemon forwarding. Domain validation stays here.
use super::AppState;
use axum::{
    extract::{Request, State},
    http::{HeaderMap, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};

pub(super) async fn authorize(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Response {
    match bearer_identity(&state, request.headers()) {
        BearerIdentity::Absent | BearerIdentity::Controller => {}
        BearerIdentity::Unknown => {
            return (StatusCode::UNAUTHORIZED, "agent authorization rejected").into_response()
        }
        BearerIdentity::Generation => {
            if request
                .headers()
                .keys()
                .any(|key| key.as_str().starts_with("x-openforge-"))
            {
                return (
                    StatusCode::FORBIDDEN,
                    "caller-supplied ownership is forbidden",
                )
                    .into_response();
            }
            if !openforge_session_protocol::agent_route_allowed(
                request.method().as_str(),
                request.uri().path(),
            ) {
                return (StatusCode::FORBIDDEN, "agent route forbidden").into_response();
            }
            return next.run(request).await;
        }
    }
    let Some(daemon) = state
        .pty_manager
        .as_ref()
        .and_then(|manager| manager.daemon_shells.as_ref())
    else {
        return next.run(request).await;
    };
    if let Err(error) = super::authentication::require_backend_token(&state, request.headers()) {
        return error.into_response();
    }
    if request
        .headers()
        .keys()
        .any(|key| key.as_str().starts_with("x-openforge-agent-"))
    {
        if !openforge_session_protocol::agent_route_allowed(
            request.method().as_str(),
            request.uri().path(),
        ) {
            return (StatusCode::FORBIDDEN, "agent route forbidden").into_response();
        }
        let Some((task, session, installation, instance)) = ownership(request.headers()) else {
            return (StatusCode::FORBIDDEN, "invalid agent ownership").into_response();
        };
        let task_exists = crate::db::acquire_db(&state.db)
            .get_task(&task)
            .is_ok_and(|task| task.is_some());
        if !task_exists
            || daemon
                .validate_agent_owner(
                    crate::app_events::RuntimeEventPublisher::new(
                        state.app.clone(),
                        state.app_event_tx.clone(),
                    ),
                    task,
                    session,
                    installation,
                    instance,
                )
                .await
                .is_err()
        {
            return (StatusCode::FORBIDDEN, "agent Task/session unavailable").into_response();
        }
    }
    next.run(request).await
}

enum BearerIdentity {
    Absent,
    Controller,
    Generation,
    Unknown,
}

fn bearer_identity(state: &AppState, headers: &HeaderMap) -> BearerIdentity {
    let Some(bearer) = headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
    else {
        return BearerIdentity::Absent;
    };
    if state.backend_token.as_deref() == Some(bearer) {
        return BearerIdentity::Controller;
    }
    if state.agent_generation_identities.authorizes(bearer) {
        return BearerIdentity::Generation;
    }
    BearerIdentity::Unknown
}

fn ownership(headers: &HeaderMap) -> Option<(String, String, String, u64)> {
    let field = |name| {
        headers
            .get(name)?
            .to_str()
            .ok()
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
    };
    Some((
        field("x-openforge-agent-task")?,
        field("x-openforge-agent-session")?,
        field("x-openforge-agent-installation")?,
        field("x-openforge-agent-instance")?.parse().ok()?,
    ))
}

#[cfg(test)]
mod tests {
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use tower::ServiceExt;

    #[tokio::test]
    async fn private_sidecar_rejects_direct_cli_and_forged_agent_ownership() {
        let (mut state, root) = crate::test_support::test_state("private_agent_ingress", |_, _| {});
        let mut manager = crate::pty_manager::PtyManager::new();
        manager.enable_daemon_shell(
            root.path().into(),
            "/unused-daemon".into(),
            "T-fixture-shell-0".into(),
        );
        state.pty_manager = Some(manager);
        state.backend_token = Some("controller-only".into());
        let router = super::super::create_router(state);
        for path in ["/projects", "/debug/process-memory", "/app/health"] {
            let response = router
                .clone()
                .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::UNAUTHORIZED, "{path}");
        }
        let response = router
            .oneshot(
                Request::builder()
                    .uri("/projects")
                    .header("authorization", "Bearer controller-only")
                    .header("x-openforge-agent-task", "forged")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    fn generation_request(path: &str, token: &str) -> Request<Body> {
        Request::builder()
            .uri(path)
            .method("POST")
            .header("authorization", format!("Bearer {token}"))
            .header("content-type", "application/json")
            .body(Body::from("{}"))
            .unwrap()
    }

    async fn refusal(response: axum::response::Response) -> String {
        String::from_utf8_lossy(
            &axum::body::to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap(),
        )
        .into_owned()
    }

    #[tokio::test]
    async fn a_generation_credential_is_refused_off_route_and_with_ownership_headers() {
        let (state, root) = crate::test_support::test_state("generation_ingress", |_, _| {});
        let identities = state.agent_generation_identities.clone();
        identities
            .activate(root.path().join("agent-generations"), 1)
            .expect("activate generation identities");
        let credential = identities.issue().expect("generation credential");
        let router = super::super::create_router(state);

        let off_route = router
            .clone()
            .oneshot(generation_request("/delete_project", credential.token()))
            .await
            .unwrap();
        assert_eq!(off_route.status(), StatusCode::FORBIDDEN);
        assert_eq!(refusal(off_route).await, "agent route forbidden");

        let mut forged = generation_request("/review_threads/list", credential.token());
        forged
            .headers_mut()
            .insert("x-openforge-agent-task", "T-forged".parse().unwrap());
        let refused = router.clone().oneshot(forged).await.unwrap();
        assert_eq!(refused.status(), StatusCode::FORBIDDEN);
        assert_eq!(
            refusal(refused).await,
            "caller-supplied ownership is forbidden"
        );

        let unknown = router
            .oneshot(generation_request("/review_threads/list", &"f".repeat(64)))
            .await
            .unwrap();
        assert_eq!(unknown.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(refusal(unknown).await, "agent authorization rejected");
    }
}
