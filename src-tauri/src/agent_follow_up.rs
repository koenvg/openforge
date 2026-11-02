use crate::{
    app_events::{AppEventSender, RuntimeEventPublisher},
    backend_runtime::AppHandle,
    db::{self, AgentSessionRow, Database},
    providers::{Provider, ProviderSessionResult, ProviderStartContext},
    pty_manager::{PtyError, PtyManager},
};
use std::{
    future::Future,
    path::PathBuf,
    pin::Pin,
    sync::{Arc, Mutex},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AgentFollowUpDisposition {
    Delivered,
    Queued,
}

impl AgentFollowUpDisposition {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Delivered => "delivered",
            Self::Queued => "queued",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AgentFollowUpOutcome {
    pub(crate) task_id: String,
    pub(crate) session_id: String,
    pub(crate) disposition: AgentFollowUpDisposition,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AgentResumeOutcome {
    pub(crate) task_id: String,
    pub(crate) session_id: String,
    pub(crate) pty_instance_id: u64,
}

#[derive(Debug, thiserror::Error)]
pub(crate) enum AgentFollowUpError {
    #[error("AGENT_FOLLOW_UP_DELIVERY_FAILED: failed to load Agent Session: {0}")]
    SessionLookup(String),
    #[error("AGENT_FOLLOW_UP_NO_SESSION: Task {task_id} has no Agent Session")]
    NoSession { task_id: String },
    #[error("AGENT_FOLLOW_UP_NO_SESSION: Task {task_id} has no active Agent Session")]
    InactiveSession { task_id: String },
    #[error("AGENT_RESUME_ALREADY_RUNNING: the agent for Task {task_id} is still running")]
    AlreadyLive { task_id: String },
    #[error("AGENT_FOLLOW_UP_DELIVERY_FAILED: Agent Session could not accept the follow-up: {0}")]
    LiveDelivery(String),
    #[error("AGENT_FOLLOW_UP_DELIVERY_FAILED: failed to load Task: {0}")]
    TaskLookup(String),
    #[error("AGENT_FOLLOW_UP_NO_SESSION: Task {task_id} no longer exists")]
    TaskMissing { task_id: String },
    #[error("AGENT_FOLLOW_UP_DELIVERY_FAILED: failed to resolve Task workspace: {0}")]
    WorkspaceResolution(String),
    #[error("AGENT_FOLLOW_UP_DELIVERY_FAILED: Task workspace is unavailable")]
    WorkspaceUnavailable,
    #[error("AGENT_FOLLOW_UP_DELIVERY_FAILED: failed to resume Agent Session: {0}")]
    ProviderResume(String),
    #[error("AGENT_FOLLOW_UP_DELIVERY_FAILED: resumed provider did not return a PTY instance")]
    MissingPtyInstance,
    #[error("AGENT_FOLLOW_UP_DELIVERY_FAILED: failed to persist resumed Agent Session: {0}")]
    Persistence(String),
}

type AgentFollowUpFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

#[derive(Debug)]
enum AgentFollowUpRuntimeError {
    Missing,
    Failed(String),
}

#[derive(Debug)]
struct AgentFollowUpResumeRequest {
    task_id: String,
    message: Option<String>,
    session: AgentSessionRow,
    workspace_path: PathBuf,
    agent: Option<String>,
    permission_mode: Option<String>,
}

trait AgentFollowUpRuntime: Send + Sync {
    fn write<'a>(
        &'a self,
        task_id: &'a str,
        input: &'a [u8],
    ) -> AgentFollowUpFuture<'a, Result<(), AgentFollowUpRuntimeError>>;
    fn is_live<'a>(&'a self, task_id: &'a str) -> AgentFollowUpFuture<'a, bool>;
    fn resume<'a>(
        &'a self,
        request: AgentFollowUpResumeRequest,
    ) -> AgentFollowUpFuture<'a, Result<ProviderSessionResult, String>>;
    fn stop<'a>(&'a self, task_id: &'a str) -> AgentFollowUpFuture<'a, ()>;
}

struct PtyAgentFollowUpRuntime {
    app: Option<AppHandle>,
    app_event_tx: Option<AppEventSender>,
    pty_manager: PtyManager,
}

impl AgentFollowUpRuntime for PtyAgentFollowUpRuntime {
    fn write<'a>(
        &'a self,
        task_id: &'a str,
        input: &'a [u8],
    ) -> AgentFollowUpFuture<'a, Result<(), AgentFollowUpRuntimeError>> {
        Box::pin(async move {
            self.pty_manager
                .write_pty(task_id, input)
                .await
                .map_err(|error| match error {
                    PtyError::ProcessNotFound(_) => AgentFollowUpRuntimeError::Missing,
                    other => AgentFollowUpRuntimeError::Failed(other.to_string()),
                })
        })
    }

    fn is_live<'a>(&'a self, task_id: &'a str) -> AgentFollowUpFuture<'a, bool> {
        Box::pin(async move { self.pty_manager.pty_buffer_state(task_id).await.is_live })
    }

    fn resume<'a>(
        &'a self,
        request: AgentFollowUpResumeRequest,
    ) -> AgentFollowUpFuture<'a, Result<ProviderSessionResult, String>> {
        Box::pin(async move {
            let provider =
                Provider::from_name(&request.session.provider, self.pty_manager.clone())?;
            let start_context = ProviderStartContext::new(RuntimeEventPublisher::new(
                self.app.clone(),
                self.app_event_tx.clone(),
            ));
            provider
                .resume(
                    &request.task_id,
                    &request.session,
                    &request.workspace_path,
                    request.message.as_deref(),
                    request.agent.as_deref(),
                    request.permission_mode.as_deref(),
                    None,
                    &start_context,
                )
                .await
                .map_err(|error| error.to_string())
        })
    }

    fn stop<'a>(&'a self, task_id: &'a str) -> AgentFollowUpFuture<'a, ()> {
        Box::pin(async move {
            let _ = self.pty_manager.kill_pty(task_id).await;
        })
    }
}

pub(crate) struct AgentFollowUpService {
    db: Arc<Mutex<Database>>,
    runtime: Arc<dyn AgentFollowUpRuntime>,
}

impl AgentFollowUpService {
    pub(crate) fn new(
        app: Option<AppHandle>,
        db: Arc<Mutex<Database>>,
        pty_manager: PtyManager,
        app_event_tx: Option<AppEventSender>,
    ) -> Self {
        Self {
            db,
            runtime: Arc::new(PtyAgentFollowUpRuntime {
                app,
                app_event_tx,
                pty_manager,
            }),
        }
    }

    #[cfg(test)]
    fn with_runtime(db: Arc<Mutex<Database>>, runtime: Arc<dyn AgentFollowUpRuntime>) -> Self {
        Self { db, runtime }
    }

    pub(crate) async fn deliver(
        &self,
        task_id: &str,
        message: &str,
    ) -> Result<AgentFollowUpOutcome, AgentFollowUpError> {
        let session = self.load_session(task_id)?;
        let disposition = disposition_for_status(&session.status).ok_or_else(|| {
            AgentFollowUpError::InactiveSession {
                task_id: task_id.to_string(),
            }
        })?;

        match self
            .runtime
            .write(task_id, &terminal_follow_up_input(message))
            .await
        {
            Ok(()) => {}
            Err(AgentFollowUpRuntimeError::Failed(error)) => {
                return Err(AgentFollowUpError::LiveDelivery(error));
            }
            Err(AgentFollowUpRuntimeError::Missing) => {
                self.resume_session_without_live_pty(task_id, Some(message), &session)
                    .await?;
            }
        }

        Ok(AgentFollowUpOutcome {
            task_id: task_id.to_string(),
            session_id: session.id,
            disposition,
        })
    }

    /// Restarts the provider on the Task's existing conversation without sending it a message.
    pub(crate) async fn resume(
        &self,
        task_id: &str,
    ) -> Result<AgentResumeOutcome, AgentFollowUpError> {
        let session = self.load_session(task_id)?;
        if disposition_for_status(&session.status).is_none() {
            return Err(AgentFollowUpError::InactiveSession {
                task_id: task_id.to_string(),
            });
        }
        if self.runtime.is_live(task_id).await {
            return Err(AgentFollowUpError::AlreadyLive {
                task_id: task_id.to_string(),
            });
        }

        let pty_instance_id = self
            .resume_session_without_live_pty(task_id, None, &session)
            .await?;
        Ok(AgentResumeOutcome {
            task_id: task_id.to_string(),
            session_id: session.id,
            pty_instance_id,
        })
    }

    fn load_session(&self, task_id: &str) -> Result<AgentSessionRow, AgentFollowUpError> {
        db::acquire_db(&self.db)
            .get_latest_session_for_ticket(task_id)
            .map_err(|error| AgentFollowUpError::SessionLookup(error.to_string()))?
            .ok_or_else(|| AgentFollowUpError::NoSession {
                task_id: task_id.to_string(),
            })
    }

    async fn resume_session_without_live_pty(
        &self,
        task_id: &str,
        message: Option<&str>,
        session: &AgentSessionRow,
    ) -> Result<u64, AgentFollowUpError> {
        let request = self.resume_request(task_id, message, session)?;
        let result = self
            .runtime
            .resume(request)
            .await
            .map_err(AgentFollowUpError::ProviderResume)?;
        let Some(pty_instance_id) = result.pty_instance_id else {
            self.runtime.stop(task_id).await;
            return Err(AgentFollowUpError::MissingPtyInstance);
        };

        let provider_session_id = result
            .opencode_session_id
            .as_deref()
            .or(result.pi_session_id.as_deref());
        let persisted = {
            db::acquire_db(&self.db).reactivate_agent_session_runtime(
                &session.id,
                pty_instance_id,
                provider_session_id,
            )
        };
        if let Err(error) = persisted {
            self.runtime.stop(task_id).await;
            return Err(AgentFollowUpError::Persistence(error.to_string()));
        }

        Ok(pty_instance_id)
    }

    fn resume_request(
        &self,
        task_id: &str,
        message: Option<&str>,
        session: &AgentSessionRow,
    ) -> Result<AgentFollowUpResumeRequest, AgentFollowUpError> {
        let db = db::acquire_db(&self.db);
        let task = db
            .get_task(task_id)
            .map_err(|error| AgentFollowUpError::TaskLookup(error.to_string()))?
            .ok_or_else(|| AgentFollowUpError::TaskMissing {
                task_id: task_id.to_string(),
            })?;
        let workspace = crate::provider_runtime::get_task_workspace(&db, task_id)
            .map_err(AgentFollowUpError::WorkspaceResolution)?
            .ok_or(AgentFollowUpError::WorkspaceUnavailable)?;

        Ok(AgentFollowUpResumeRequest {
            task_id: task_id.to_string(),
            message: message.map(str::to_string),
            session: session.clone(),
            workspace_path: PathBuf::from(workspace.workspace_path),
            agent: task.agent,
            permission_mode: task.permission_mode,
        })
    }
}

fn disposition_for_status(status: &str) -> Option<AgentFollowUpDisposition> {
    match status {
        "completed" | "interrupted" | "failed" => Some(AgentFollowUpDisposition::Delivered),
        "running" | "paused" => Some(AgentFollowUpDisposition::Queued),
        _ => None,
    }
}

pub(crate) fn terminal_follow_up_input(message: &str) -> Vec<u8> {
    let sanitized: String = message
        .chars()
        .filter(|character| !character.is_control() || matches!(character, '\n' | '\t'))
        .collect();
    let mut input = Vec::with_capacity(sanitized.len() + 13);
    input.extend_from_slice(b"\x1b[200~");
    input.extend_from_slice(sanitized.as_bytes());
    input.extend_from_slice(b"\x1b[201~\r");
    input
}

#[cfg(test)]
mod tests {
    use super::*;

    struct RestartingRuntime {
        live: bool,
        resumed_pty_instance_id: Option<u64>,
        resumed: Mutex<Vec<AgentFollowUpResumeRequest>>,
        stopped: Mutex<Vec<String>>,
    }

    impl RestartingRuntime {
        fn new() -> Self {
            Self {
                live: false,
                resumed_pty_instance_id: Some(99),
                resumed: Mutex::new(Vec::new()),
                stopped: Mutex::new(Vec::new()),
            }
        }
    }

    impl AgentFollowUpRuntime for RestartingRuntime {
        fn write<'a>(
            &'a self,
            _task_id: &'a str,
            _input: &'a [u8],
        ) -> AgentFollowUpFuture<'a, Result<(), AgentFollowUpRuntimeError>> {
            Box::pin(async { Err(AgentFollowUpRuntimeError::Missing) })
        }

        fn is_live<'a>(&'a self, _task_id: &'a str) -> AgentFollowUpFuture<'a, bool> {
            Box::pin(async move { self.live })
        }

        fn resume<'a>(
            &'a self,
            request: AgentFollowUpResumeRequest,
        ) -> AgentFollowUpFuture<'a, Result<ProviderSessionResult, String>> {
            Box::pin(async move {
                self.resumed
                    .lock()
                    .expect("restart runtime lock")
                    .push(request);
                Ok(ProviderSessionResult {
                    port: 0,
                    opencode_session_id: None,
                    pi_session_id: Some("pi-session".to_string()),
                    pty_instance_id: self.resumed_pty_instance_id,
                })
            })
        }

        fn stop<'a>(&'a self, task_id: &'a str) -> AgentFollowUpFuture<'a, ()> {
            Box::pin(async move {
                self.stopped
                    .lock()
                    .expect("restart runtime lock")
                    .push(task_id.to_string());
            })
        }
    }

    const SESSION_ID: &str = "session-follow-up";

    fn seed_session(db: &Database, workspace: &std::path::Path, status: &str) -> String {
        let workspace = workspace.to_str().expect("workspace path");
        let project = db
            .create_project("Follow-up Project", workspace)
            .expect("create project");
        let task = db
            .create_task(
                "Continue completed work",
                "doing",
                Some(&project.id),
                None,
                None,
            )
            .expect("create task");
        db.create_task_workspace_record(
            &task.id,
            &project.id,
            workspace,
            workspace,
            "project_dir",
            None,
            "pi",
        )
        .expect("create workspace");
        db.create_agent_session(SESSION_ID, &task.id, None, "implementing", status, "pi")
            .expect("create Agent Session");
        db.set_agent_session_pi_id(SESSION_ID, "pi-session")
            .expect("set Pi session id");
        task.id
    }

    fn stored_session(state: &crate::http_server::AppState) -> AgentSessionRow {
        db::acquire_db(&state.db)
            .get_agent_session(SESSION_ID)
            .expect("load Agent Session")
            .expect("Agent Session exists")
    }

    #[tokio::test]
    async fn completed_session_without_live_pty_resumes_provider_for_follow_up() {
        let (state, _temp_dir) =
            crate::app_invoke::test_support::test_state("completed_session_without_live_pty");
        let workspace = tempfile::tempdir().expect("workspace tempdir");
        let task_id = seed_session(&db::acquire_db(&state.db), workspace.path(), "completed");
        let runtime = Arc::new(RestartingRuntime::new());
        let service = AgentFollowUpService::with_runtime(Arc::clone(&state.db), runtime.clone());

        let outcome = service
            .deliver(&task_id, "Review this follow-up")
            .await
            .expect("deliver follow-up");

        assert_eq!(outcome.disposition, AgentFollowUpDisposition::Delivered);
        let resumed = runtime.resumed.lock().expect("restart runtime lock");
        assert_eq!(resumed.len(), 1);
        assert_eq!(resumed[0].task_id, task_id);
        assert_eq!(resumed[0].message.as_deref(), Some("Review this follow-up"));
        assert_eq!(
            resumed[0].session.pi_session_id.as_deref(),
            Some("pi-session")
        );
        drop(resumed);
        let session = stored_session(&state);
        assert_eq!(session.status, "running");
        assert_eq!(session.pty_instance_id, Some(99));
    }

    #[tokio::test]
    async fn follow_up_restarts_an_agent_that_crashed() {
        for status in ["interrupted", "failed"] {
            let (state, _temp_dir) = crate::app_invoke::test_support::test_state(&format!(
                "follow_up_restarts_{status}"
            ));
            let workspace = tempfile::tempdir().expect("workspace tempdir");
            let task_id = seed_session(&db::acquire_db(&state.db), workspace.path(), status);
            let runtime = Arc::new(RestartingRuntime::new());
            let service =
                AgentFollowUpService::with_runtime(Arc::clone(&state.db), runtime.clone());

            let outcome = service
                .deliver(&task_id, "Pick this back up")
                .await
                .unwrap_or_else(|error| panic!("{status} session should restart: {error}"));

            assert_eq!(outcome.disposition, AgentFollowUpDisposition::Delivered);
            assert_eq!(stored_session(&state).status, "running", "{status}");
        }
    }

    #[tokio::test]
    async fn resume_restarts_the_agent_without_typing_a_message() {
        for status in ["completed", "interrupted", "failed", "paused", "running"] {
            let (state, _temp_dir) =
                crate::app_invoke::test_support::test_state(&format!("resume_{status}"));
            let workspace = tempfile::tempdir().expect("workspace tempdir");
            let task_id = seed_session(&db::acquire_db(&state.db), workspace.path(), status);
            let runtime = Arc::new(RestartingRuntime::new());
            let service =
                AgentFollowUpService::with_runtime(Arc::clone(&state.db), runtime.clone());

            let outcome = service
                .resume(&task_id)
                .await
                .unwrap_or_else(|error| panic!("{status} session should resume: {error}"));

            assert_eq!(outcome.task_id, task_id);
            assert_eq!(outcome.session_id, SESSION_ID);
            assert_eq!(outcome.pty_instance_id, 99);
            let resumed = runtime.resumed.lock().expect("restart runtime lock");
            assert_eq!(resumed.len(), 1, "{status}");
            assert_eq!(resumed[0].message, None, "{status}");
            drop(resumed);
            let session = stored_session(&state);
            assert_eq!(session.status, "running", "{status}");
            assert_eq!(session.pty_instance_id, Some(99), "{status}");
        }
    }

    #[tokio::test]
    async fn resume_refuses_a_task_whose_agent_is_still_running() {
        let (state, _temp_dir) =
            crate::app_invoke::test_support::test_state("resume_refuses_live_agent");
        let workspace = tempfile::tempdir().expect("workspace tempdir");
        let task_id = seed_session(&db::acquire_db(&state.db), workspace.path(), "completed");
        let runtime = Arc::new(RestartingRuntime {
            live: true,
            ..RestartingRuntime::new()
        });
        let service = AgentFollowUpService::with_runtime(Arc::clone(&state.db), runtime.clone());

        let error = service
            .resume(&task_id)
            .await
            .expect_err("a live agent must not be started twice");

        assert!(matches!(error, AgentFollowUpError::AlreadyLive { .. }));
        assert!(runtime.resumed.lock().expect("lock").is_empty());
    }

    #[tokio::test]
    async fn resume_stops_a_terminal_the_provider_did_not_report_and_keeps_the_session() {
        let (state, _temp_dir) =
            crate::app_invoke::test_support::test_state("resume_without_pty_instance");
        let workspace = tempfile::tempdir().expect("workspace tempdir");
        let task_id = seed_session(&db::acquire_db(&state.db), workspace.path(), "completed");
        let runtime = Arc::new(RestartingRuntime {
            resumed_pty_instance_id: None,
            ..RestartingRuntime::new()
        });
        let service = AgentFollowUpService::with_runtime(Arc::clone(&state.db), runtime.clone());

        let error = service
            .resume(&task_id)
            .await
            .expect_err("a resume without a terminal must fail");

        assert!(matches!(error, AgentFollowUpError::MissingPtyInstance));
        assert_eq!(
            *runtime.stopped.lock().expect("lock"),
            vec![task_id.clone()]
        );
        let session = stored_session(&state);
        assert_eq!(session.status, "completed");
        assert_eq!(session.pty_instance_id, None);
    }

    #[tokio::test]
    async fn resume_reports_a_task_without_an_agent_session() {
        let (state, _temp_dir) =
            crate::app_invoke::test_support::test_state("resume_without_session");
        let runtime = Arc::new(RestartingRuntime::new());
        let service = AgentFollowUpService::with_runtime(Arc::clone(&state.db), runtime.clone());

        let error = service
            .resume("T-missing")
            .await
            .expect_err("a Task without a session cannot resume");

        assert!(matches!(error, AgentFollowUpError::NoSession { .. }));
        assert!(runtime.resumed.lock().expect("lock").is_empty());
    }

    #[test]
    fn wraps_a_follow_up_in_a_paste_envelope_and_drops_control_characters() {
        let input = terminal_follow_up_input("first line\r\n\tsecond\u{1b}[201~line");

        assert_eq!(
            String::from_utf8(input).expect("utf-8 follow-up input"),
            "\u{1b}[200~first line\n\tsecond[201~line\u{1b}[201~\r"
        );
    }
}
