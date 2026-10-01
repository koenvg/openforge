use crate::scoped_agent_session_service::{
    RuntimeFuture, ScopedCompletionObserver, ScopedLaunchRequest, ScopedLaunchResult,
    ScopedSessionRuntime,
};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex, MutexGuard, PoisonError},
};

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

#[derive(Clone)]
pub(crate) struct ScopedProviderRuntime {
    app: crate::backend_runtime::AppHandle,
    pty_manager: crate::pty_manager::PtyManager,
    event_publisher: crate::app_events::RuntimeEventPublisher,
    completion_observer: Arc<Mutex<Option<ScopedCompletionObserver>>>,
    credentials: Arc<Mutex<HashMap<String, ScopedGenerationCredential>>>,
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

impl ScopedProviderRuntime {
    pub(crate) fn new(
        app: crate::backend_runtime::AppHandle,
        pty_manager: crate::pty_manager::PtyManager,
        event_publisher: crate::app_events::RuntimeEventPublisher,
    ) -> Self {
        Self {
            app,
            pty_manager,
            event_publisher,
            completion_observer: Arc::new(Mutex::new(None)),
            credentials: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub(crate) fn set_completion_observer(&self, observer: ScopedCompletionObserver) {
        *lock(&self.completion_observer) = Some(observer);
    }
}

impl ScopedSessionRuntime for ScopedProviderRuntime {
    fn launch<'a>(&'a self, request: ScopedLaunchRequest) -> RuntimeFuture<'a, ScopedLaunchResult> {
        Box::pin(async move {
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

            let provider =
                crate::providers::Provider::from_name(&request.provider, self.pty_manager.clone())?;
            let launch = provider
                .start_scoped(crate::providers::ScopedProviderStartContext {
                    session_key: &request.terminal_key,
                    scoped_session_id: &request.session_id,
                    workspace_path: &request.workspace_path,
                    prompt: &request.input,
                    provider_session_id: request.provider_session_id.as_deref(),
                    resume: request.resume,
                    credential_path,
                    cols: 120,
                    rows: 36,
                    event_publisher: self.event_publisher.clone(),
                    exit_observer: observer,
                })
                .await;

            match launch {
                Ok(launched) => Ok(ScopedLaunchResult {
                    pty_instance_id: launched.pty_instance_id,
                    provider_session_id: launched.provider_session_id,
                }),
                Err(error) => {
                    remove_generation_if_matches(
                        &mut lock(&self.credentials),
                        &request.terminal_key,
                        &request.session_id,
                    );
                    Err(error.to_string())
                }
            }
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

    fn dispose<'a>(&'a self, key: &'a str) -> RuntimeFuture<'a, ()> {
        Box::pin(async move {
            lock(&self.credentials).remove(key);
            match self.pty_manager.kill_pty(key).await {
                Ok(()) | Err(crate::pty_manager::PtyError::ProcessNotFound(_)) => Ok(()),
                Err(error) => Err(error.to_string()),
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
}
