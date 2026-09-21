use crate::{
    db::{Database, ScopedAgentSessionRow},
    scoped_agent_session_service::{
        AcquiredSessionWorkspace, RuntimeFuture, ScopedAgentSessionService, ScopedLaunchRequest,
        ScopedLaunchResult, ScopedSessionRuntime, ScopedSessionWorkspace,
    },
};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
};

#[derive(Default)]
pub(crate) struct TestScopedSessionRuntime {
    pub(crate) inputs: Mutex<Vec<String>>,
    pub(crate) aborts: Mutex<Vec<String>>,
    output_revisions: Mutex<HashMap<String, u64>>,
}

impl ScopedSessionRuntime for TestScopedSessionRuntime {
    fn launch<'a>(&'a self, request: ScopedLaunchRequest) -> RuntimeFuture<'a, ScopedLaunchResult> {
        Box::pin(async move {
            self.output_revisions
                .lock()
                .expect("lock output revisions")
                .insert(request.terminal_key, 0);
            Ok(ScopedLaunchResult {
                pty_instance_id: 41,
                provider_session_id: request.provider_session_id,
            })
        })
    }

    fn input<'a>(&'a self, _terminal_key: &'a str, input: &'a str) -> RuntimeFuture<'a, ()> {
        Box::pin(async move {
            self.inputs.lock().expect("lock inputs").push(input.into());
            Ok(())
        })
    }

    fn abort<'a>(&'a self, terminal_key: &'a str) -> RuntimeFuture<'a, ()> {
        Box::pin(async move {
            self.aborts
                .lock()
                .expect("lock aborts")
                .push(terminal_key.into());
            Ok(())
        })
    }

    fn output<'a>(&'a self, _terminal_key: &'a str) -> RuntimeFuture<'a, String> {
        Box::pin(async { Ok(String::new()) })
    }

    fn output_revision<'a>(&'a self, terminal_key: &'a str) -> RuntimeFuture<'a, u64> {
        Box::pin(async move {
            Ok(*self
                .output_revisions
                .lock()
                .expect("lock output revisions")
                .get(terminal_key)
                .unwrap_or(&0))
        })
    }

    fn dispose<'a>(&'a self, terminal_key: &'a str) -> RuntimeFuture<'a, ()> {
        Box::pin(async move {
            self.output_revisions
                .lock()
                .expect("lock output revisions")
                .remove(terminal_key);
            Ok(())
        })
    }
}

#[derive(Default)]
struct TestScopedSessionWorkspace;

impl ScopedSessionWorkspace for TestScopedSessionWorkspace {
    fn acquire<'a>(
        &'a self,
        _session: &'a ScopedAgentSessionRow,
    ) -> RuntimeFuture<'a, AcquiredSessionWorkspace> {
        Box::pin(async {
            Ok(AcquiredSessionWorkspace::for_test(
                PathBuf::from("/test/scoped-workspace"),
                "resolved-test-commit".into(),
            ))
        })
    }

    fn protect<'a>(
        &'a self,
        _session: &'a ScopedAgentSessionRow,
    ) -> RuntimeFuture<'a, Box<dyn Send + Sync>> {
        Box::pin(async { Ok(Box::new(()) as Box<dyn Send + Sync>) })
    }

    fn is_available(&self, _session: &ScopedAgentSessionRow) -> Result<bool, String> {
        Ok(true)
    }

    fn release<'a>(&'a self, _session: &'a ScopedAgentSessionRow) -> RuntimeFuture<'a, ()> {
        Box::pin(async { Ok(()) })
    }
}

pub(crate) fn test_scoped_agent_session_service(
    database: Arc<Mutex<Database>>,
) -> (ScopedAgentSessionService, Arc<TestScopedSessionRuntime>) {
    let runtime = Arc::new(TestScopedSessionRuntime::default());
    let service = ScopedAgentSessionService::new(
        database,
        Arc::new(TestScopedSessionWorkspace),
        runtime.clone(),
    );
    (service, runtime)
}
