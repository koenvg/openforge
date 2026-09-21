use super::*;

impl HostState {
    pub(super) fn capacity_error(&self, kind: CapacityKind) -> HostError {
        if self.operation_window.is_some() {
            HostError::CapacityExceeded(kind)
        } else {
            HostError::Capacity
        }
    }

    pub(crate) fn open_operation_stream(&mut self, stream: u64) -> OperationWindow {
        if let Some(window) = self
            .operation_window
            .filter(|window| window.stream == stream)
        {
            return window;
        }
        // The authenticated controller generation fences prior stream identities. The caller
        // must reconcile old outcomes, never reissue uncertain work under this new stream.
        let window = OperationWindow {
            stream,
            retired_through: 0,
            admitted_through: 0,
        };
        self.operations.clear();
        self.retained_bytes = 0;
        self.operation_window = Some(window);
        self.input_sequences
            .retain(|instance, _| self.sessions.contains_key(instance));
        window
    }

    pub(super) fn validate_operation(
        &self,
        operation: &OperationId,
    ) -> Result<Option<u64>, HostError> {
        let Some(window) = self.operation_window else {
            return if operation.as_str().starts_with("ordered.") {
                Err(HostError::OperationExpired)
            } else {
                Ok(None)
            };
        };
        let (stream, ordinal) = operation.position().ok_or(HostError::OperationExpired)?;
        if stream != window.stream || ordinal <= window.retired_through {
            return Err(HostError::OperationExpired);
        }
        Ok(Some(ordinal))
    }

    pub(crate) fn acknowledge_operations(
        &mut self,
        stream: u64,
        through: u64,
    ) -> Result<(), HostError> {
        let window = self.operation_window.ok_or(HostError::OperationExpired)?;
        if stream != window.stream {
            return Err(HostError::OperationExpired);
        }
        if through <= window.retired_through {
            return Ok(());
        }
        if through > window.admitted_through {
            return Err(HostError::OutOfOrder);
        }
        let mut bytes = 0usize;
        for ordinal in (window.retired_through + 1)..=through {
            let id = OperationId::ordered(stream, ordinal)?;
            let record = self.operations.get(&id).ok_or(HostError::OutOfOrder)?;
            if matches!(record.result, Err(HostError::OutcomeUnknown)) {
                return Err(HostError::OutcomeUnknown);
            }
            bytes += match &record.request {
                Mutation::Spawn(request) => request.validate()?,
                Mutation::Terminate(_) => 512,
                Mutation::Io(request) => match &request.action {
                    IoAction::Write(data) => data.len() + 512,
                    IoAction::Resize { .. } => 512,
                },
                Mutation::SetTerminalColorProfile(_) => std::mem::size_of::<TerminalColorProfile>(),
            };
        }
        let retained_bytes =
            self.retained_bytes
                .checked_sub(bytes)
                .ok_or(HostError::InvalidRequest(
                    "invalid retained byte accounting",
                ))?;
        for ordinal in (window.retired_through + 1)..=through {
            self.operations
                .remove(&OperationId::ordered(stream, ordinal)?);
        }
        self.retained_bytes = retained_bytes;
        self.operation_window = Some(OperationWindow {
            retired_through: through,
            ..window
        });
        self.input_sequences.retain(|instance, _| {
            self.sessions.contains_key(instance) || self.operations.values().any(|record| {
                matches!(&record.request, Mutation::Io(request) if request.pty.instance == *instance)
            })
        });
        Ok(())
    }
}
