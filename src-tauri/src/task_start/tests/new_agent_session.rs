use super::super::*;
use std::sync::atomic::{AtomicBool, Ordering};

struct NewSessionLauncher {
    live: bool,
    pty_instance_id: Option<u64>,
    launched: Mutex<Vec<(PathBuf, String)>>,
    aborted: AtomicBool,
}

impl NewSessionLauncher {
    fn new() -> Self {
        Self {
            live: false,
            pty_instance_id: Some(31),
            launched: Mutex::new(Vec::new()),
            aborted: AtomicBool::new(false),
        }
    }
}

impl ProviderLauncher for NewSessionLauncher {
    fn launch<'a>(
        &'a self,
        request: ProviderLaunchRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = Result<ProviderSessionResult, TaskStartError>> + Send + 'a>>
    {
        Box::pin(async move {
            self.launched.lock().expect("launch lock").push((
                request.workspace_path.to_path_buf(),
                request.prompt.to_string(),
            ));
            Ok(ProviderSessionResult {
                port: 0,
                opencode_session_id: None,
                pi_session_id: Some("pi-fresh".to_string()),
                pty_instance_id: self.pty_instance_id,
            })
        })
    }

    fn abort<'a>(
        &'a self,
        _task_id: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'a>> {
        Box::pin(async move {
            self.aborted.store(true, Ordering::SeqCst);
            Ok(())
        })
    }

    fn is_live<'a>(&'a self, _task_id: &'a str) -> Pin<Box<dyn Future<Output = bool> + Send + 'a>> {
        Box::pin(async move { self.live })
    }
}

const PREVIOUS_SESSION_ID: &str = "session-previous";

fn task_in_progress(state: &crate::http_server::AppState, workspace: &Path) -> String {
    let db = db::acquire_db(&state.db);
    let workspace = workspace.to_str().expect("workspace path");
    let project = db
        .create_project("New Session Project", workspace)
        .expect("create Project");
    let task = db
        .create_task(
            "Rebuild the importer",
            "doing",
            Some(&project.id),
            None,
            None,
        )
        .expect("create Task");
    db.create_task_workspace_record(
        &task.id,
        &project.id,
        workspace,
        workspace,
        "project_dir",
        None,
        "pi",
    )
    .expect("create Task workspace");
    db.create_agent_session(
        PREVIOUS_SESSION_ID,
        &task.id,
        None,
        "implementing",
        "running",
        "pi",
    )
    .expect("create previous Agent Session");
    task.id
}

#[tokio::test]
async fn new_session_runs_the_task_prompt_in_its_existing_workspace() {
    let (state, _temp_dir) =
        crate::app_invoke::test_support::test_state("new_agent_session_success");
    let workspace = tempfile::tempdir().expect("workspace tempdir");
    let task_id = task_in_progress(&state, workspace.path());
    let launcher = Arc::new(NewSessionLauncher::new());

    let receipt = service_for(&state)
        .with_provider_launcher(launcher.clone())
        .start_new_session(&task_id)
        .await
        .expect("a Task in progress can start a new session");

    let launched = launcher.launched.lock().expect("launch lock");
    assert_eq!(launched.len(), 1);
    assert_eq!(launched[0].0, workspace.path());
    assert!(launched[0].1.contains("Rebuild the importer"));
    drop(launched);
    assert_eq!(receipt.task_id, task_id);
    assert_eq!(receipt.pty_instance_id, 31);
    assert_ne!(receipt.session_id, PREVIOUS_SESSION_ID);
    let db = db::acquire_db(&state.db);
    let latest = db
        .get_latest_session_for_ticket(&task_id)
        .expect("get Agent Session")
        .expect("Agent Session exists");
    assert_eq!(latest.id, receipt.session_id);
    assert_eq!(latest.status, "running");
    assert_eq!(latest.pty_instance_id, Some(31));
    assert_eq!(latest.pi_session_id.as_deref(), Some("pi-fresh"));
    assert_eq!(
        db.get_task(&task_id)
            .expect("get Task")
            .expect("Task exists")
            .status,
        "doing"
    );
    assert!(db
        .get_agent_session(PREVIOUS_SESSION_ID)
        .expect("get previous Agent Session")
        .is_some());
}

#[tokio::test]
async fn new_session_refuses_a_task_whose_agent_is_still_running() {
    let (state, _temp_dir) = crate::app_invoke::test_support::test_state("new_agent_session_live");
    let workspace = tempfile::tempdir().expect("workspace tempdir");
    let task_id = task_in_progress(&state, workspace.path());
    let launcher = Arc::new(NewSessionLauncher {
        live: true,
        ..NewSessionLauncher::new()
    });

    let error = service_for(&state)
        .with_provider_launcher(launcher.clone())
        .start_new_session(&task_id)
        .await
        .expect_err("a live agent must not be replaced");

    assert_eq!(error, TaskStartError::ActiveSession);
    assert!(launcher.launched.lock().expect("launch lock").is_empty());
}

#[tokio::test]
async fn new_session_refuses_a_task_that_was_never_started() {
    let (state, _temp_dir) =
        crate::app_invoke::test_support::test_state("new_agent_session_not_started");
    let task_id = {
        let db = db::acquire_db(&state.db);
        let project = db.create_project("P", "/tmp/p").expect("create Project");
        db.create_task("p", "backlog", Some(&project.id), None, None)
            .expect("create Task")
            .id
    };
    let launcher = Arc::new(NewSessionLauncher::new());

    let error = service_for(&state)
        .with_provider_launcher(launcher.clone())
        .start_new_session(&task_id)
        .await
        .expect_err("a backlog Task has no workspace to start in");

    assert_eq!(error, TaskStartError::NotStarted);
    assert!(launcher.launched.lock().expect("launch lock").is_empty());
}

#[tokio::test]
async fn new_session_stops_a_terminal_the_provider_did_not_report() {
    let (state, _temp_dir) =
        crate::app_invoke::test_support::test_state("new_agent_session_without_pty");
    let workspace = tempfile::tempdir().expect("workspace tempdir");
    let task_id = task_in_progress(&state, workspace.path());
    let launcher = Arc::new(NewSessionLauncher {
        pty_instance_id: None,
        ..NewSessionLauncher::new()
    });

    let error = service_for(&state)
        .with_provider_launcher(launcher.clone())
        .start_new_session(&task_id)
        .await
        .expect_err("a session without a terminal must fail");

    assert!(matches!(error, TaskStartError::ProviderLaunch(_)));
    assert!(launcher.aborted.load(Ordering::SeqCst));
    assert_eq!(
        db::acquire_db(&state.db)
            .get_latest_session_for_ticket(&task_id)
            .expect("get Agent Session")
            .expect("previous Agent Session exists")
            .id,
        PREVIOUS_SESSION_ID
    );
}

fn service_for(state: &crate::http_server::AppState) -> TaskStartService {
    super::support::service_for_state(state)
}
