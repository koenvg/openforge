//! Claude Code runtime adapter for scope-owned Agent Sessions.

use crate::scoped_agent_session_service::{
    RuntimeFuture, ScopedCompletionObserver, ScopedLaunchRequest, ScopedSessionRuntime,
    AUTHENTICATION_UNAVAILABLE_CODE,
};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex, MutexGuard, PoisonError},
};

const CLAUDE_AUTHENTICATION_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

fn remove_scoped_runtime_state(path: &std::path::Path) -> std::io::Result<()> {
    std::fs::remove_dir_all(path).or_else(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            Ok(())
        } else {
            Err(error)
        }
    })
}

#[derive(Clone)]
pub(crate) struct ScopedClaudeRuntime {
    app: crate::backend_runtime::AppHandle,
    pty_manager: crate::pty_manager::PtyManager,
    event_publisher: crate::app_events::RuntimeEventPublisher,
    policy_root: PathBuf,
    completion_observer: Arc<Mutex<Option<ScopedCompletionObserver>>>,
    credentials: Arc<Mutex<HashMap<String, ScopedGenerationCredential>>>,
    session_directories: Arc<Mutex<HashMap<String, PathBuf>>>,
}

struct ScopedGeneration<T> {
    session_id: String,
    _value: T,
}

type ScopedGenerationCredential =
    ScopedGeneration<crate::agent_generation_identity::GenerationCredential>;

fn remove_generation_if_matches<T>(
    generations: &mut HashMap<String, ScopedGeneration<T>>,
    terminal_key: &str,
    session_id: &str,
) {
    if generations
        .get(terminal_key)
        .is_some_and(|generation| generation.session_id == session_id)
    {
        generations.remove(terminal_key);
    }
}

impl ScopedClaudeRuntime {
    pub(crate) fn new(
        app: crate::backend_runtime::AppHandle,
        pty_manager: crate::pty_manager::PtyManager,
        event_publisher: crate::app_events::RuntimeEventPublisher,
        policy_root: PathBuf,
    ) -> Self {
        if let Err(error) = remove_scoped_runtime_state(&policy_root) {
            log::warn!("[scoped-agent-session] failed to remove stale runtime state: {error}")
        }
        if let Err(error) = std::fs::create_dir_all(&policy_root) {
            log::warn!("[scoped-agent-session] failed to create runtime state root: {error}");
        }
        Self {
            app,
            pty_manager,
            event_publisher,
            policy_root,
            completion_observer: Arc::new(Mutex::new(None)),
            credentials: Arc::new(Mutex::new(HashMap::new())),
            session_directories: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub(crate) fn set_completion_observer(&self, observer: ScopedCompletionObserver) {
        *lock(&self.completion_observer) = Some(observer);
    }
}

impl ScopedSessionRuntime for ScopedClaudeRuntime {
    fn verify_authentication<'a>(&'a self) -> RuntimeFuture<'a, ()> {
        Box::pin(async move {
            let context =
                crate::claude_launch_context::resolve_current_scoped_claude_launch_context()
                    .map_err(|_| AUTHENTICATION_UNAVAILABLE_CODE.to_string())?;
            crate::claude_launch_context::verify_claude_authentication(
                &context,
                CLAUDE_AUTHENTICATION_TIMEOUT,
            )
            .await
            .map_err(|_| AUTHENTICATION_UNAVAILABLE_CODE.to_string())
        })
    }

    fn launch<'a>(&'a self, request: ScopedLaunchRequest) -> RuntimeFuture<'a, u64> {
        Box::pin(async move {
            let settings_dir = self.policy_root.join(&request.session_id);
            let launch = async {
                let launch_context =
                    crate::claude_launch_context::resolve_current_scoped_claude_launch_context()
                        .map_err(|_| AUTHENTICATION_UNAVAILABLE_CODE.to_string())?;
                crate::claude_launch_context::verify_claude_authentication(
                    &launch_context,
                    CLAUDE_AUTHENTICATION_TIMEOUT,
                )
                .await
                .map_err(|_| AUTHENTICATION_UNAVAILABLE_CODE.to_string())?;
                let environment =
                    crate::session_tool_policy::generate_review_read_only_settings(&settings_dir)
                        .map_err(|error| error.to_string())?;
                let provider_state_paths = launch_context
                    .provider_state_paths()
                    .map_err(|error| error.to_string())?;
                let home = launch_context
                    .home_dir()
                    .map_err(|error| error.to_string())?;
                let sandbox = crate::session_tool_policy::macos_sandbox_profile(
                    &request.workspace_path,
                    &environment.scoped_state_dir,
                    &provider_state_paths,
                    &home,
                )
                .map_err(|error| error.to_string())?;
                let identities = self
                    .app
                    .try_state::<crate::agent_generation_identity::GenerationIdentities>()
                    .map(|state| state.inner().clone())
                    .ok_or_else(|| "Scoped agent credentials are unavailable".to_string())?;
                let completion = lock(&self.completion_observer)
                    .clone()
                    .ok_or_else(|| "Scoped session exit observer is unavailable".to_string())?;
                let credential = identities.issue_scoped(
                    crate::agent_generation_identity::ScopedAgentPrincipal {
                        session_id: request.session_id.clone(),
                        owner_plugin_id: request.owner_plugin_id.clone(),
                        project_id: request.project_id.clone(),
                        namespace: request.scope.namespace.clone(),
                        target_key: request.scope.target_key.clone(),
                        revision: request.scope.revision.clone(),
                        tool_policy: request.tool_policy.clone(),
                    },
                )?;
                let credential_path = credential.config_path().to_path_buf();
                lock(&self.credentials).insert(
                    request.terminal_key.clone(),
                    ScopedGeneration {
                        session_id: request.session_id.clone(),
                        _value: credential,
                    },
                );
                lock(&self.session_directories)
                    .insert(request.terminal_key.clone(), settings_dir.clone());
                let session_id = request.session_id.clone();
                let terminal_key = request.terminal_key.clone();
                let credentials = Arc::clone(&self.credentials);
                let observer: crate::pty_manager::PtyExitObserver =
                    Arc::new(move |instance, succeeded| {
                        let mut credentials = lock(&credentials);
                        remove_generation_if_matches(&mut credentials, &terminal_key, &session_id);
                        drop(credentials);
                        completion(session_id.clone(), instance, succeeded);
                    });
                self.pty_manager
                    .spawn_scoped_claude_pty(
                        &request.terminal_key,
                        &request.session_id,
                        &request.workspace_path,
                        &request.input,
                        &request.provider_session_id,
                        request.resume,
                        &environment.settings_path,
                        sandbox,
                        Some(credential_path),
                        environment.scoped_state_dir,
                        launch_context,
                        120,
                        36,
                        self.event_publisher.clone(),
                        observer,
                    )
                    .await
                    .map_err(|error| error.to_string())
            }
            .await;
            if launch.is_err() {
                let mut credentials = lock(&self.credentials);
                remove_generation_if_matches(
                    &mut credentials,
                    &request.terminal_key,
                    &request.session_id,
                );
                drop(credentials);
                let directory = lock(&self.session_directories)
                    .remove(&request.terminal_key)
                    .unwrap_or(settings_dir);
                let _ = remove_scoped_runtime_state(&directory);
            }
            launch
        })
    }

    fn input<'a>(&'a self, key: &'a str, input: &'a str) -> RuntimeFuture<'a, ()> {
        Box::pin(async move {
            self.pty_manager
                .write_pty(
                    key,
                    &crate::agent_follow_up::terminal_follow_up_input(input),
                )
                .await
                .map_err(|error| error.to_string())
        })
    }
    fn abort<'a>(&'a self, key: &'a str) -> RuntimeFuture<'a, ()> {
        Box::pin(async move {
            lock(&self.credentials).remove(key);
            match self.pty_manager.kill_pty_retaining_output(key).await {
                Ok(()) | Err(crate::pty_manager::PtyError::ProcessNotFound(_)) => Ok(()),
                Err(error) => Err(error.to_string()),
            }
        })
    }
    fn output<'a>(&'a self, key: &'a str) -> RuntimeFuture<'a, String> {
        Box::pin(async move {
            Ok(self
                .pty_manager
                .get_pty_buffer(key)
                .await
                .unwrap_or_default())
        })
    }
    fn output_revision<'a>(&'a self, key: &'a str) -> RuntimeFuture<'a, u64> {
        Box::pin(async move { Ok(self.pty_manager.pty_output_revision(key).await) })
    }
    fn dispose<'a>(&'a self, key: &'a str) -> RuntimeFuture<'a, ()> {
        Box::pin(async move {
            lock(&self.credentials).remove(key);
            let process_result = match self.pty_manager.kill_pty(key).await {
                Ok(()) | Err(crate::pty_manager::PtyError::ProcessNotFound(_)) => Ok(()),
                Err(error) => Err(error.to_string()),
            };
            let directory = lock(&self.session_directories).remove(key);
            let directory_result =
                directory.map_or(Ok(()), |directory| remove_scoped_runtime_state(&directory));
            match (process_result, directory_result) {
                (Ok(()), Ok(())) => Ok(()),
                (Err(error), Ok(())) => Err(error),
                (Ok(()), Err(error)) => Err(format!("remove scoped runtime state: {error}")),
                (Err(process), Err(directory)) => Err(format!(
                    "{process}; remove scoped runtime state: {directory}"
                )),
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn delayed_old_exit_cannot_remove_the_replacement_generation() {
        let terminal_key = "shared-terminal".to_string();
        let mut generations = HashMap::from([(
            terminal_key.clone(),
            ScopedGeneration {
                session_id: "replacement".to_string(),
                _value: (),
            },
        )]);

        remove_generation_if_matches(&mut generations, &terminal_key, "released");

        assert_eq!(
            generations
                .get(&terminal_key)
                .map(|generation| generation.session_id.as_str()),
            Some("replacement")
        );
    }

    #[test]
    fn startup_removes_stale_scoped_runtime_state_without_touching_claude_state() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let policy_root = temp.path().join("scoped-agent-policy");
        let stale = policy_root.join("old-session/state.json");
        let claude_state = temp.path().join(".claude/projects/scoped-session.jsonl");
        std::fs::create_dir_all(stale.parent().unwrap()).expect("create stale state");
        std::fs::write(&stale, "stale").expect("write stale state");
        std::fs::create_dir_all(claude_state.parent().unwrap()).expect("create Claude state");
        std::fs::write(&claude_state, "conversation").expect("write Claude state");

        let _runtime = ScopedClaudeRuntime::new(
            crate::backend_runtime::AppHandle::new(),
            crate::pty_manager::PtyManager::new(),
            crate::app_events::RuntimeEventPublisher::new(None, None),
            policy_root.clone(),
        );

        assert!(policy_root.is_dir());
        assert!(!stale.exists());
        assert_eq!(
            std::fs::read_to_string(claude_state).expect("Claude state remains"),
            "conversation"
        );
    }

    #[test]
    fn failed_launch_and_release_cleanup_target_only_scoped_runtime_state() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let scoped_state = temp.path().join("scoped-agent-policy/session");
        let claude_login = temp.path().join(".claude.json");
        let unrelated_conversation = temp.path().join(".claude/projects/normal.jsonl");
        std::fs::create_dir_all(&scoped_state).expect("create scoped state");
        std::fs::write(scoped_state.join("settings.json"), "policy").expect("write policy");
        std::fs::write(&claude_login, "login").expect("write login");
        std::fs::create_dir_all(unrelated_conversation.parent().unwrap())
            .expect("create conversation state");
        std::fs::write(&unrelated_conversation, "normal conversation").expect("write conversation");

        remove_scoped_runtime_state(&scoped_state).expect("cleanup scoped runtime state");

        assert!(!scoped_state.exists());
        assert_eq!(std::fs::read_to_string(claude_login).unwrap(), "login");
        assert_eq!(
            std::fs::read_to_string(unrelated_conversation).unwrap(),
            "normal conversation"
        );
    }
}
