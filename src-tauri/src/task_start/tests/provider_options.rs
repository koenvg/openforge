use super::super::*;
use super::support::*;

#[test]
fn provider_run_options_borrow_saved_task_agent_and_permission_mode() {
    let task = task_with_provider_options(Some("rust-specialist"), Some("trusted"));

    let options = ProviderRunOptions::for_task(&task);

    assert_eq!(options.agent, Some("rust-specialist"));
    assert_eq!(options.permission_mode, Some("trusted"));
    assert!(options.model.is_none());
}

#[test]
fn start_context_resolves_saved_provider_override() {
    let (state, _temp_dir) =
        crate::app_invoke::test_support::test_state("task_start_context_saved_overrides");
    let task_id = {
        let db = db::acquire_db(&state.db);
        let project = db.create_project("P", "/tmp/p").expect("create Project");
        let task = db
            .create_task_with_options(crate::db::NewTaskOptions {
                initial_prompt: "p",
                status: "backlog",
                project_id: Some(&project.id),
                prompt: None,
                permission_mode: None,
                worktree_source: Some("disabled"),
                worktree_branch: None,
                title: None,
                source_ticket_url: None,
                task_display_title_updates_enabled: None,
                ai_provider: None,
            })
            .expect("create Task");
        db.set_task_config(&task.id, "ai_provider", "opencode")
            .expect("set Task provider override");
        task.id
    };

    let context = service_for_state(&state)
        .load_context(&task_id)
        .expect("load Start context");

    assert_eq!(context.provider_name, "opencode");
    assert_eq!(context.repo_path, Path::new("/tmp/p"));

    drop(state);
}

#[tokio::test]
async fn pi_start_preserves_disable_model_invocation_skill_command_with_generated_instructions() {
    let (state, _temp_dir) =
        crate::app_invoke::test_support::test_state("task_start_pi_skill_prompt");
    let task_id = {
        let db = db::acquire_db(&state.db);
        let project = db
            .create_project("Pi Skill Project", "/tmp/pi-skill-project")
            .expect("create Project");
        db.set_config("code_cleanup_tasks_enabled", "true")
            .expect("store obsolete cleanup setting");
        db.set_project_config(&project.id, "additional_instructions", "Project rules")
            .expect("store additional instructions");
        db.set_project_config(
            &project.id,
            agent_lifecycle::START_PROMPT_CONTRIBUTIONS_CONFIG_KEY,
            &serde_json::json!([{
                "id": "pi-workflow",
                "enabled": true,
                "content": "Plugin workflow",
                "order": 0,
            }])
            .to_string(),
        )
        .expect("store Start contribution");
        db.create_task_with_options(crate::db::NewTaskOptions {
            initial_prompt: "/skill:manual-skill Complete the release notes",
            status: "backlog",
            project_id: Some(&project.id),
            prompt: None,
            permission_mode: None,
            worktree_source: Some("disabled"),
            worktree_branch: None,
            title: None,
            source_ticket_url: None,
            task_display_title_updates_enabled: None,
            ai_provider: Some("pi"),
        })
        .expect("create Task")
        .id
    };
    let launch = Arc::new(Mutex::new(None));
    let provider = RecordingProviderLauncher {
        launch: Arc::clone(&launch),
    };

    service_for_state(&state)
        .with_provider_launcher(Arc::new(provider))
        .start(TaskStartRequest::desktop(
            &task_id,
            DivergenceResolution::Auto,
            None,
            Some("Start prefix"),
        ))
        .await
        .expect("Pi Start succeeds");

    let (provider_name, prompt) = launch
        .lock()
        .expect("recording lock")
        .take()
        .expect("provider launch recorded");
    assert_eq!(provider_name, "pi");
    assert!(
        prompt.starts_with("/skill:manual-skill "),
        "Pi must receive the explicit skill command at byte zero"
    );
    let contribution_at = prompt.find("Plugin workflow").unwrap();
    let instructions_at = prompt.find("Project rules").unwrap();
    let prefix_at = prompt.find("Start prefix").unwrap();
    let task_at = prompt.find("Complete the release notes").unwrap();
    assert!(contribution_at < instructions_at);
    assert!(!prompt.contains("<openforge_code_cleanup>"));
    assert!(instructions_at < prefix_at);
    assert!(prefix_at < task_at);

    drop(state);
}
