//! In-memory ownership of a fixture child that has not reached session tracking.

use super::super::managed_process::{
    terminate_managed_process_tree_with_root_reaper, ManagedProcessIdentity, RootReapMode,
};
use super::super::pids::{
    terminate_and_remove_managed_process, write_managed_process_identity,
    MANAGED_PROCESS_TERM_TIMEOUT,
};
use super::PtySession;
use portable_pty::{Child, ChildKiller, ExitStatus};
use std::{
    io,
    path::PathBuf,
    sync::{Arc, Mutex},
};

pub(super) struct UnpublishedProcess {
    identity: ManagedProcessIdentity,
    path: PathBuf,
    child: FixtureChild,
}

impl UnpublishedProcess {
    pub(super) fn retain(mut session: PtySession, path: PathBuf) -> (PtySession, Self) {
        let child = FixtureChild(Arc::new(Mutex::new(session.child)));
        session.child = Box::new(child.clone());
        let process = Self {
            identity: session.managed_process.clone(),
            path,
            child,
        };
        (session, process)
    }

    pub(super) fn publish(&self) -> Result<(), String> {
        std::fs::create_dir_all(self.path.parent().expect("private recovery directory"))
            .map_err(|error| error.to_string())?;
        write_managed_process_identity(&self.path, &self.identity)
            .map_err(|error| error.to_string())
    }

    pub(super) async fn cleanup(&self) -> Result<(), String> {
        // Signal only the identity retained from SpawnedPty. The actual child
        // handle remains available for reaping after a cancelled registration.
        let mut child = self.child.clone();
        let termination = terminate_managed_process_tree_with_root_reaper(
            &self.identity,
            MANAGED_PROCESS_TERM_TIMEOUT,
            |mode| match mode {
                RootReapMode::Poll => {
                    let _ = child.try_wait();
                }
                RootReapMode::Wait => {
                    let _ = child.wait();
                }
            },
        )
        .await;
        let result = match termination {
            Ok(()) => terminate_and_remove_managed_process(
                &self.identity,
                &self.path,
                "unpublished fixture PTY cleanup",
            )
            .await
            .map_err(|error| error.to_string()),
            Err(error) => Err(error),
        };
        if let Err(error) = result {
            // Retry evidence publication if the initial write failed, but never
            // overwrite an existing record or adopt an identity from disk.
            if !self.path.exists() {
                self.publish()
                    .map_err(|publication| format!("{error}; {publication}"))?;
            }
            return Err(error);
        }
        Ok(())
    }
}

// Share only the OS child handle, not the whole session. Cleanup signalling is
// identity-checked; the delegated killer exists only to preserve Child's API.
#[derive(Clone, Debug)]
struct FixtureChild(Arc<Mutex<Box<dyn Child + Send + Sync>>>);

impl ChildKiller for FixtureChild {
    fn kill(&mut self) -> io::Result<()> {
        self.0.lock().unwrap().kill()
    }

    fn clone_killer(&self) -> Box<dyn ChildKiller + Send + Sync> {
        self.0.lock().unwrap().clone_killer()
    }
}

impl Child for FixtureChild {
    fn try_wait(&mut self) -> io::Result<Option<ExitStatus>> {
        self.0.lock().unwrap().try_wait()
    }

    fn wait(&mut self) -> io::Result<ExitStatus> {
        self.0.lock().unwrap().wait()
    }

    fn process_id(&self) -> Option<u32> {
        self.0.lock().unwrap().process_id()
    }

    #[cfg(windows)]
    fn as_raw_handle(&self) -> Option<std::os::windows::io::RawHandle> {
        self.0.lock().unwrap().as_raw_handle()
    }
}
