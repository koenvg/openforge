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
    mut request: Request,
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
        BearerIdentity::Scoped(principal) => {
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
            if !openforge_session_protocol::scoped_agent_route_allowed(
                request.method().as_str(),
                request.uri().path(),
            ) {
                return (StatusCode::FORBIDDEN, "scoped agent route forbidden").into_response();
            }
            let session = crate::db::acquire_db(&state.db)
                .scoped_agent_session_by_id(&principal.session_id)
                .ok()
                .flatten();
            let valid = session.is_some_and(|session| {
                session.owner_plugin_id == principal.owner_plugin_id
                    && session.project_id == principal.project_id
                    && session.namespace == principal.namespace
                    && session.target_key == principal.target_key
                    && session.revision == principal.revision
                    && session.tool_policy == principal.tool_policy
                    && matches!(
                        session.status,
                        crate::db::ScopedAgentSessionStatus::Starting
                            | crate::db::ScopedAgentSessionStatus::Running
                            | crate::db::ScopedAgentSessionStatus::Paused
                    )
            });
            if !valid {
                return (StatusCode::FORBIDDEN, "scoped agent session unavailable").into_response();
            }
            request.extensions_mut().insert(principal);
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
    Scoped(crate::agent_generation_identity::ScopedAgentPrincipal),
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
    match state.agent_generation_identities.identity(bearer) {
        Some(crate::agent_generation_identity::AgentIdentity::HeadlessGeneration) => {
            return BearerIdentity::Generation
        }
        Some(crate::agent_generation_identity::AgentIdentity::Scoped(principal)) => {
            return BearerIdentity::Scoped(principal)
        }
        None => {}
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

    #[tokio::test]
    async fn scoped_credential_is_exact_scope_and_review_routes_only_then_revoked() {
        let (state, root) = crate::test_support::test_state("scoped_agent_ingress", |_, _| {});
        let project_id = {
            let db = crate::db::acquire_db(&state.db);
            let project = db.create_project("Repository", "/tmp/repository").unwrap();
            db.create_scoped_agent_session(&crate::db::NewScopedAgentSession {
                id: "sas-1",
                owner_plugin_id: "com.openforge.github-sync",
                namespace: "github-pr",
                target_key: "owner/repo#42",
                revision: "head-a",
                project_id: &project.id,
                checkout_revision: "head-a",
                provider: "claude-code",
                tool_policy: "review-read-only",
                terminal_key: "scoped-agent-v1-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                status: crate::db::ScopedAgentSessionStatus::Starting,
                queue_sequence: None,
            }).unwrap();
            db.mark_scoped_agent_session_running("sas-1", "conversation-1", 7)
                .unwrap();
            project.id
        };
        let identities = state.agent_generation_identities.clone();
        identities
            .activate(root.path().join("agent-generations"), 1)
            .unwrap();
        let credential = identities
            .issue_scoped(crate::agent_generation_identity::ScopedAgentPrincipal {
                session_id: "sas-1".into(),
                owner_plugin_id: "com.openforge.github-sync".into(),
                project_id: project_id.clone(),
                namespace: "github-pr".into(),
                target_key: "owner/repo#42".into(),
                revision: "head-a".into(),
                tool_policy: "review-read-only".into(),
            })
            .unwrap();
        let token = credential.token().to_string();
        let router = super::super::create_router(state);

        let task_route = router
            .clone()
            .oneshot(generation_request("/create_task", &token))
            .await
            .unwrap();
        assert_eq!(task_route.status(), StatusCode::FORBIDDEN);

        let request = |target: &str| {
            Request::builder()
                .uri("/review_threads/list")
                .method("POST")
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "namespace": "github-pr", "targetKey": target, "revision": "head-a"
                    })
                    .to_string(),
                ))
                .unwrap()
        };
        assert_eq!(
            router
                .clone()
                .oneshot(request("other/repo#1"))
                .await
                .unwrap()
                .status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            router
                .clone()
                .oneshot(request("owner/repo#42"))
                .await
                .unwrap()
                .status(),
            StatusCode::OK
        );

        let plugin_command = |command_id: &str, project_id: Option<&str>| {
            let mut body = serde_json::json!({
                "commandId": command_id,
                "input": {"attemptId": "attempt-1"}
            });
            if let Some(project_id) = project_id {
                body["projectId"] = serde_json::json!(project_id);
            }
            Request::builder()
                .uri("/plugin_commands/invoke")
                .method("POST")
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap()
        };
        assert_eq!(
            router
                .clone()
                .oneshot(plugin_command("com.example.other", None))
                .await
                .unwrap()
                .status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            router
                .clone()
                .oneshot(plugin_command(
                    "com.openforge.github-sync.submit-walkthrough-step",
                    Some("caller-project"),
                ))
                .await
                .unwrap()
                .status(),
            StatusCode::BAD_REQUEST
        );
        let supplied_scope = Request::builder()
            .uri("/plugin_commands/invoke")
            .method("POST")
            .header("authorization", format!("Bearer {token}"))
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::json!({
                    "commandId": "com.openforge.github-sync.submit-walkthrough-step",
                    "scope": {
                        "namespace": "github-pr",
                        "targetKey": "other/repo#1",
                        "revision": "head-b"
                    }
                })
                .to_string(),
            ))
            .unwrap();
        assert_eq!(
            router
                .clone()
                .oneshot(supplied_scope)
                .await
                .unwrap()
                .status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
        assert_eq!(
            router
                .clone()
                .oneshot(plugin_command(
                    "com.openforge.github-sync.submit-walkthrough-step",
                    None,
                ))
                .await
                .unwrap()
                .status(),
            StatusCode::NOT_FOUND
        );

        for invalid_principal in [
            crate::agent_generation_identity::ScopedAgentPrincipal {
                session_id: "other-session".into(),
                owner_plugin_id: "com.openforge.github-sync".into(),
                project_id: project_id.clone(),
                namespace: "github-pr".into(),
                target_key: "owner/repo#42".into(),
                revision: "head-a".into(),
                tool_policy: "review-read-only".into(),
            },
            crate::agent_generation_identity::ScopedAgentPrincipal {
                session_id: "sas-1".into(),
                owner_plugin_id: "com.openforge.github-sync".into(),
                project_id: "other-project".into(),
                namespace: "github-pr".into(),
                target_key: "owner/repo#42".into(),
                revision: "head-a".into(),
                tool_policy: "review-read-only".into(),
            },
            crate::agent_generation_identity::ScopedAgentPrincipal {
                session_id: "sas-1".into(),
                owner_plugin_id: "com.openforge.github-sync".into(),
                project_id: project_id.clone(),
                namespace: "github-pr".into(),
                target_key: "other/repo#1".into(),
                revision: "head-a".into(),
                tool_policy: "review-read-only".into(),
            },
        ] {
            let invalid = identities.issue_scoped(invalid_principal).unwrap();
            let response = router
                .clone()
                .oneshot(
                    Request::builder()
                        .uri("/review_threads/list")
                        .method("POST")
                        .header("authorization", format!("Bearer {}", invalid.token()))
                        .header("content-type", "application/json")
                        .body(Body::from(
                            serde_json::json!({
                                "namespace": "github-pr",
                                "targetKey": "owner/repo#42",
                                "revision": "head-a"
                            })
                            .to_string(),
                        ))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::FORBIDDEN);
        }

        let wrong_plugin = identities
            .issue_scoped(crate::agent_generation_identity::ScopedAgentPrincipal {
                session_id: "sas-1".into(),
                owner_plugin_id: "com.example.other".into(),
                project_id: project_id.clone(),
                namespace: "github-pr".into(),
                target_key: "owner/repo#42".into(),
                revision: "head-a".into(),
                tool_policy: "review-read-only".into(),
            })
            .unwrap();
        let wrong_plugin_request = Request::builder()
            .uri("/review_threads/list")
            .method("POST")
            .header("authorization", format!("Bearer {}", wrong_plugin.token()))
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::json!({
                    "namespace": "github-pr", "targetKey": "owner/repo#42", "revision": "head-a"
                })
                .to_string(),
            ))
            .unwrap();
        assert_eq!(
            router
                .clone()
                .oneshot(wrong_plugin_request)
                .await
                .unwrap()
                .status(),
            StatusCode::FORBIDDEN
        );

        drop(credential);
        assert_eq!(
            router
                .oneshot(request("owner/repo#42"))
                .await
                .unwrap()
                .status(),
            StatusCode::UNAUTHORIZED
        );
    }
}
