use super::*;
use std::collections::{HashMap, HashSet};

impl Checkpoint {
    pub(super) fn validate(&self) -> Result<(), HostError> {
        let invalid = || HostError::UnsupportedReplacement;
        let installation = self.installation.as_ref().ok_or_else(invalid)?;
        if self.format != FORMAT || self.generation == 0 {
            return Err(invalid());
        }
        // Reserve one fence generation and one fresh controller connection.
        self.generation.checked_add(2).ok_or(HostError::Capacity)?;
        let limits = self.limits;
        if limits.operations > MAX_OPERATIONS
            || limits.cleanup_reserve > MAX_SESSIONS
            || limits.live_sessions > MAX_SESSIONS
            || limits.exit_history > MAX_EXIT_HISTORY
            || limits.retained_request_bytes > MAX_RETAINED_REQUEST_BYTES
            || self.operations.len() > limits.operations + limits.cleanup_reserve
            || self.sessions.len() > limits.retained_sessions.min(MAX_SESSIONS)
            || self.input_sequences.len() > self.operations.len()
        {
            return Err(HostError::Capacity);
        }
        let identity = |pty: &PtyIdentity| {
            if &pty.installation != installation || pty.lifetime != self.lifetime {
                Err(invalid())
            } else {
                Ok(())
            }
        };
        let mut ids = HashSet::new();
        let mut ordered = HashSet::new();
        let mut expected_sequences = HashMap::<PtyInstanceId, u64>::new();
        let mut sequence_counts = HashMap::<PtyInstanceId, u64>::new();
        let mut ordinary_operations = 0;
        let mut ordinary_bytes = 0usize;
        let mut retained_bytes = 0usize;
        for (operation, request, result) in &self.operations {
            if !ids.insert(operation) {
                return Err(invalid());
            }
            let bytes = match request {
                Mutation::Spawn(request) => request.validate().map_err(|_| invalid())?,
                Mutation::Terminate(pty) => {
                    identity(pty)?;
                    512
                }
                Mutation::Io(request) => {
                    identity(&request.pty)?;
                    if request.sequence == 0
                        || !ordered.insert((request.pty.instance, request.sequence))
                    {
                        return Err(invalid());
                    }
                    let last = expected_sequences.entry(request.pty.instance).or_default();
                    *last = (*last).max(request.sequence);
                    *sequence_counts.entry(request.pty.instance).or_default() += 1;
                    match &request.action {
                        IoAction::Write(bytes) if bytes.len() <= MAX_REQUEST_BYTES => {
                            bytes.len() + 512
                        }
                        IoAction::Resize { columns, rows } => {
                            validate_geometry(*columns, *rows).map_err(|_| invalid())?;
                            512
                        }
                        _ => return Err(invalid()),
                    }
                }
            };
            match (request, result) {
                (Mutation::Spawn(_), Ok(Receipt::Spawn(pty))) => identity(pty)?,
                (Mutation::Terminate(_) | Mutation::Io(_), Ok(Receipt::Done)) | (_, Err(_)) => {}
                _ => return Err(invalid()),
            }
            retained_bytes = retained_bytes
                .checked_add(bytes)
                .ok_or(HostError::Capacity)?;
            if !matches!(request, Mutation::Terminate(_)) {
                ordinary_operations += 1;
                ordinary_bytes = ordinary_bytes
                    .checked_add(bytes)
                    .ok_or(HostError::Capacity)?;
            }
        }
        if expected_sequences != sequence_counts
            || retained_bytes != self.retained_bytes
            || ordinary_operations > limits.operations
            || ordinary_bytes > limits.retained_request_bytes
            || retained_bytes > limits.retained_request_bytes + limits.cleanup_reserve * 512
        {
            return Err(invalid());
        }
        let mut input_sequences = HashMap::new();
        for (instance, sequence) in &self.input_sequences {
            if input_sequences.insert(*instance, *sequence).is_some() {
                return Err(invalid());
            }
        }
        if input_sequences != expected_sequences {
            return Err(invalid());
        }
        let mut sessions = HashSet::new();
        let mut exited = 0;
        for session in &self.sessions {
            identity(&session.pty)?;
            if !sessions.insert(session.pty.instance)
                || session.session_key.is_empty()
                || session.session_key.len() > 256
                || session.next_io_sequence
                    != input_sequences
                        .get(&session.pty.instance)
                        .copied()
                        .unwrap_or(0)
                        .checked_add(1)
            {
                return Err(invalid());
            }
            if session.state == HostedSessionState::Exited {
                exited += 1;
            }
        }
        if exited > limits.exit_history || self.sessions.len() - exited > limits.live_sessions {
            return Err(HostError::Capacity);
        }
        Ok(())
    }
}
