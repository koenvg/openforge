use super::super::*;
use std::{
    path::Path,
    process::Command,
    sync::atomic::{AtomicBool, Ordering},
};

pub(super) struct SuccessfulProviderLauncher;

impl ProviderLauncher for SuccessfulProviderLauncher {
    fn launch<'a>(
        &'a self,
        _request: ProviderLaunchRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = Result<ProviderSessionResult, TaskStartError>> + Send + 'a>>
    {
        Box::pin(async {
            Ok(ProviderSessionResult {
                port: 17_424,
                opencode_session_id: Some("provider-session".to_string()),
                pi_session_id: None,
                pty_instance_id: Some(7),
            })
        })
    }

    fn abort<'a>(
        &'a self,
        _task_id: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'a>> {
        Box::pin(async { Ok(()) })
    }
}

#[derive(Clone)]
pub(super) struct RecordingProviderLauncher {
    pub(super) launch: Arc<Mutex<Option<(String, String)>>>,
}

impl ProviderLauncher for RecordingProviderLauncher {
    fn launch<'a>(
        &'a self,
        request: ProviderLaunchRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = Result<ProviderSessionResult, TaskStartError>> + Send + 'a>>
    {
        Box::pin(async move {
            *self.launch.lock().expect("recording lock") = Some((
                request.provider_name.to_string(),
                request.prompt.to_string(),
            ));
            Ok(ProviderSessionResult {
                port: 0,
                opencode_session_id: None,
                pi_session_id: Some("pi-session".to_string()),
                pty_instance_id: Some(8),
            })
        })
    }

    fn abort<'a>(
        &'a self,
        _task_id: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'a>> {
        Box::pin(async { Ok(()) })
    }
}

pub(super) struct FailingProviderLauncher;

impl ProviderLauncher for FailingProviderLauncher {
    fn launch<'a>(
        &'a self,
        _request: ProviderLaunchRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = Result<ProviderSessionResult, TaskStartError>> + Send + 'a>>
    {
        Box::pin(async {
            Err(TaskStartError::ProviderLaunch(
                "controllable provider launch failure".to_string(),
            ))
        })
    }

    fn abort<'a>(
        &'a self,
        _task_id: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'a>> {
        Box::pin(async { Ok(()) })
    }
}

pub(super) struct StaleAfterLaunchProvider {
    pub(super) db: Arc<Mutex<Database>>,
    pub(super) aborted: Arc<AtomicBool>,
}

impl ProviderLauncher for StaleAfterLaunchProvider {
    fn launch<'a>(
        &'a self,
        request: ProviderLaunchRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = Result<ProviderSessionResult, TaskStartError>> + Send + 'a>>
    {
        Box::pin(async move {
            db::acquire_db(&self.db)
                .update_task_status(request.task_id, "doing")
                .map_err(|error| TaskStartError::Persistence(error.to_string()))?;
            Ok(ProviderSessionResult {
                port: 0,
                opencode_session_id: None,
                pi_session_id: None,
                pty_instance_id: Some(42),
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
}

pub(super) fn service_for_state(state: &crate::http_server::AppState) -> TaskStartService {
    TaskStartService::new(
        state.app.clone(),
        Arc::clone(&state.db),
        state.pty_manager.clone(),
        state.app_event_tx.clone(),
        state.task_claims.clone(),
    )
}

pub(super) fn task_with_provider_options(
    agent: Option<&str>,
    permission_mode: Option<&str>,
) -> TaskRow {
    TaskRow {
        id: "T-provider-options".to_string(),
        initial_prompt: "Implement provider options".to_string(),
        status: "backlog".to_string(),
        project_id: Some("P-provider-options".to_string()),
        created_at: 1,
        updated_at: 1,
        prompt: None,
        agent: agent.map(str::to_string),
        permission_mode: permission_mode.map(str::to_string),
        worktree_source: None,
        worktree_branch: None,
        title: None,
        title_source: None,
        title_generated_at: None,
        source_ticket_url: None,
        depends_on: Vec::new(),
        labels: Vec::new(),
    }
}

pub(super) fn git(repo: &Path, args: &[&str]) {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        .output()
        .expect("git command should run");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn init_repository(repo: &Path) {
    std::fs::create_dir_all(repo).expect("repository should create");
    git(repo, &["init", "-b", "main"]);
    git(repo, &["config", "user.email", "test@example.com"]);
    git(repo, &["config", "user.name", "Test User"]);
    std::fs::write(repo.join("README.md"), "base\n").expect("base file should write");
    git(repo, &["add", "README.md"]);
    git(repo, &["commit", "-m", "base"]);
}

pub(super) fn init_remote_backed_main(repo: &Path) {
    init_repository(repo);
    git(repo, &["update-ref", "refs/remotes/origin/main", "HEAD"]);
}

pub(super) fn init_diverged_existing_branch(repo: &Path) {
    init_repository(repo);
    git(repo, &["checkout", "-b", "feature/diverged"]);
    std::fs::write(repo.join("local.txt"), "local\n").expect("local file should write");
    git(repo, &["add", "local.txt"]);
    git(repo, &["commit", "-m", "local"]);
    git(repo, &["checkout", "main"]);
    std::fs::write(repo.join("remote.txt"), "remote\n").expect("remote file should write");
    git(repo, &["add", "remote.txt"]);
    git(repo, &["commit", "-m", "remote"]);
    git(
        repo,
        &["update-ref", "refs/remotes/origin/feature/diverged", "HEAD"],
    );
}

pub(super) fn test_plugin(plugin_id: &str) -> db::PluginRow {
    db::PluginRow {
        id: plugin_id.to_string(),
        name: "Start prompt plugin".to_string(),
        version: "1.0.0".to_string(),
        api_version: 1,
        description: "Contributes Task start instructions".to_string(),
        permissions: "[]".to_string(),
        contributes: "{}".to_string(),
        frontend_entry: "dist/frontend.js".to_string(),
        backend_entry: None,
        install_path: "/tmp/start-prompt-plugin".to_string(),
        source_kind: "local".to_string(),
        source_spec: "/tmp/start-prompt-plugin".to_string(),
        package_metadata: "{}".to_string(),
        installed_at: 1,
        is_builtin: false,
    }
}

pub(super) fn task_with_owned_start_prompt_contribution(
    state: &crate::http_server::AppState,
    plugin_id: &str,
) -> String {
    let db = db::acquire_db(&state.db);
    let project = db.create_project("P", "/tmp/p").expect("create Project");
    db.install_plugin(&test_plugin(plugin_id))
        .expect("install plugin");
    db.set_plugin_enabled(&project.id, plugin_id, true)
        .expect("enable plugin");
    db.set_project_config(
        &project.id,
        agent_lifecycle::START_PROMPT_CONTRIBUTIONS_CONFIG_KEY,
        &serde_json::json!([{
            "id": "plugin-workflow",
            "enabled": true,
            "content": "Plugin workflow",
            "order": 0,
            "ownerPluginId": plugin_id,
        }])
        .to_string(),
    )
    .expect("store owned contribution");
    db.create_task("p", "backlog", Some(&project.id), None, None)
        .expect("create Task")
        .id
}

pub(super) fn backlog_task_with_project(state: &crate::http_server::AppState) -> (String, String) {
    let db = db::acquire_db(&state.db);
    let project = db.create_project("P", "/tmp/p").expect("create Project");
    let task = db
        .create_task("p", "backlog", Some(&project.id), None, None)
        .expect("create Task");
    (project.id, task.id)
}
