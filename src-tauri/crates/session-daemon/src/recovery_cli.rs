//! Local recovery deliberately bypasses the domain Sidecar and its database.
use openforge_session_client::{runtime::RuntimeDirectory, Client};
use openforge_session_protocol::Error;
use std::path::Path;
use std::time::Duration;

pub(crate) fn run(
    root: &Path,
    expected: Option<(&str, &str)>,
    terminate: bool,
) -> Result<(), Error> {
    let runtime = RuntimeDirectory::open_existing(root)?;
    if expected.is_some_and(|(installation, _)| {
        runtime.credentials().installation.as_str() != installation
    }) {
        return Err(Error::ForeignInstallation);
    }
    let client = match Client::connect(root) {
        Ok(client) => client,
        Err(Error::Transport(_)) => {
            let _launch = runtime.claim_launch()?;
            let _owner = runtime.claim()?;
            // Free launch and lifetime authority prove that the original owner is gone.
            // A readiness failure while either lock is held cannot make this claim.
            println!("{{\"state\":\"cold-process-loss\"}}");
            return Ok(());
        }
        Err(error) => return Err(error),
    };
    if expected.is_some_and(|(_, lifetime)| client.controller().lifetime.as_str() != lifetime) {
        if terminate {
            return Err(Error::Host("original session process was lost; refusing cleanup of a different daemon lifetime".into()));
        }
        println!("{{\"state\":\"cold-process-loss\"}}");
        return Ok(());
    }
    if terminate {
        client.terminate_owned_sessions(Duration::from_secs(3))?;
        println!("{{\"state\":\"terminated\"}}");
    } else {
        println!("{{\"state\":\"available\"}}");
    }
    Ok(())
}
