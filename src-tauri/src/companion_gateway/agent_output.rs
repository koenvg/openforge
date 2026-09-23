//! Opaque, revision-scoped presentation identities for the paired Companion.
use base64::Engine;
use sha2::{Digest, Sha256};

use crate::db::AgentSessionRow;

#[derive(Debug, Clone)]
pub(crate) struct AgentOutputOccurrence {
    pub(crate) receipt: String,
    pub(crate) session_binding: String,
}

fn identity(domain: &[u8], task_id: &str, session_id: &str, revision: Option<i64>) -> String {
    let mut hash = Sha256::new();
    for bytes in [domain, task_id.as_bytes(), session_id.as_bytes()] {
        hash.update((bytes.len() as u64).to_be_bytes());
        hash.update(bytes);
    }
    if let Some(revision) = revision {
        hash.update(revision.to_be_bytes());
    }
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(hash.finalize())
}

pub(crate) fn session_binding(task_id: &str, session_id: &str) -> String {
    identity(b"companion-agent-session-v1", task_id, session_id, None)
}

pub(crate) fn occurrence(
    task_id: &str,
    session: &AgentSessionRow,
) -> Option<AgentOutputOccurrence> {
    if session.ticket_id != task_id
        || session.pty_instance_id.is_none()
        || !matches!(
            session.status.as_str(),
            "completed" | "paused" | "failed" | "interrupted"
        )
        || session.output_revision <= session.viewed_output_revision
    {
        return None;
    }
    Some(AgentOutputOccurrence {
        receipt: identity(
            b"companion-agent-output-v1",
            task_id,
            &session.id,
            Some(session.output_revision),
        ),
        session_binding: session_binding(task_id, &session.id),
    })
}
