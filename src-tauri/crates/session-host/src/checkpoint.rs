//! Control-ledger checkpoint only. The owner must separately quiesce and retain resources.
#[path = "checkpoint_validate.rs"]
mod validate;
use super::*;
use std::io::{self, Write};

pub const MAX_HOST_CHECKPOINT_BYTES: usize = 16 * 1024 * 1024;
const FORMAT: u32 = 1;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Checkpoint {
    format: u32,
    installation: Option<InstallationId>,
    lifetime: DaemonLifetimeId,
    generation: u64,
    sessions: Vec<HostedSession>,
    input_sequences: Vec<(PtyInstanceId, u64)>,
    operations: Vec<(OperationId, Mutation, Result<Receipt, Failure>)>,
    retained_bytes: usize,
    limits: HostLimits,
}

// Preserve retry outcomes, not their Display strings. Admission-only errors with
// borrowed static messages are deliberately not checkpointable; never downgrade a
// known outcome to success or silently replay it after restoration.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum Failure {
    ForeignInstallation,
    StaleController,
    StalePty,
    StaleOutput,
    OperationConflict,
    OutcomeUnknown,
    Capacity,
    OutOfOrder,
    UnsupportedReplacement,
    RecoveryUnavailable,
    Backend(String),
}
impl TryFrom<&HostError> for Failure {
    type Error = HostError;
    fn try_from(error: &HostError) -> Result<Self, HostError> {
        Ok(match error {
            HostError::ForeignInstallation => Self::ForeignInstallation,
            HostError::StaleController => Self::StaleController,
            HostError::StalePty => Self::StalePty,
            HostError::StaleOutput => Self::StaleOutput,
            HostError::OperationConflict => Self::OperationConflict,
            HostError::OutcomeUnknown => Self::OutcomeUnknown,
            HostError::Capacity => Self::Capacity,
            HostError::OutOfOrder => Self::OutOfOrder,
            HostError::UnsupportedReplacement => Self::UnsupportedReplacement,
            HostError::RecoveryUnavailable => Self::RecoveryUnavailable,
            HostError::Backend(message) => Self::Backend(message.clone()),
            HostError::InvalidRequest(_) | HostError::InvalidIdentity(_) => {
                return Err(HostError::UnsupportedReplacement);
            }
        })
    }
}
impl From<Failure> for HostError {
    fn from(error: Failure) -> Self {
        match error {
            Failure::ForeignInstallation => Self::ForeignInstallation,
            Failure::StaleController => Self::StaleController,
            Failure::StalePty => Self::StalePty,
            Failure::StaleOutput => Self::StaleOutput,
            Failure::OperationConflict => Self::OperationConflict,
            Failure::OutcomeUnknown => Self::OutcomeUnknown,
            Failure::Capacity => Self::Capacity,
            Failure::OutOfOrder => Self::OutOfOrder,
            Failure::UnsupportedReplacement => Self::UnsupportedReplacement,
            Failure::RecoveryUnavailable => Self::RecoveryUnavailable,
            Failure::Backend(message) => Self::Backend(message),
        }
    }
}

impl HostState {
    /// Captures receipts, input order and identities at the caller-held mutation gate.
    /// Contains sensitive command/input material: retain only in protected owner storage.
    /// This neither pauses PTYs nor authorizes executable replacement.
    ///
    /// # Errors
    /// Refuses oversized or unrepresentable state without changing the serving ledger.
    pub fn checkpoint(&self) -> Result<Vec<u8>, HostError> {
        let operations = self.operations.iter().map(|(operation, recorded)| {
            let result = match &recorded.result {
                Ok(receipt) => Ok(receipt.clone()),
                Err(error) => Err(Failure::try_from(error)?),
            };
            Ok((operation.clone(), recorded.request.clone(), result))
        }).collect::<Result<Vec<_>, HostError>>()?;
        let checkpoint = Checkpoint {
            format: FORMAT,
            installation: self.installation.clone(),
            lifetime: self.lifetime.clone(),
            generation: self.generation,
            sessions: self.sessions.values().cloned().collect(),
            input_sequences: self.input_sequences.iter().map(|(id, sequence)| (*id, *sequence)).collect(),
            operations,
            retained_bytes: self.retained_bytes,
            limits: self.limits,
        };
        checkpoint.validate()?;
        let mut output = BoundedBytes(Vec::new());
        serde_json::to_writer(&mut output, &checkpoint).map_err(|_| HostError::Capacity)?;
        Ok(output.0)
    }

    /// Restores the same lifetime and retry outcomes, fencing all pre-checkpoint controllers.
    /// The caller must validate and restore the matching resource inventory before serving.
    ///
    /// # Errors
    /// Refuses incompatible/corrupt checkpoints and exhausted controller generations.
    pub fn restore_checkpoint(bytes: &[u8]) -> Result<Self, HostError> {
        if bytes.len() > MAX_HOST_CHECKPOINT_BYTES {
            return Err(HostError::Capacity);
        }
        let checkpoint: Checkpoint = serde_json::from_slice(bytes)
            .map_err(|_| HostError::UnsupportedReplacement)?;
        checkpoint.validate()?;
        Ok(Self {
            installation: checkpoint.installation,
            lifetime: checkpoint.lifetime,
            generation: checkpoint.generation.checked_add(1).ok_or(HostError::Capacity)?,
            sessions: checkpoint.sessions.into_iter().map(|session| (session.pty.instance, session)).collect(),
            input_sequences: checkpoint.input_sequences.into_iter().collect(),
            operations: checkpoint.operations.into_iter().map(|(id, request, result)| {
                (id, RecordedOperation { request, result: result.map_err(HostError::from) })
            }).collect(),
            retained_bytes: checkpoint.retained_bytes,
            limits: checkpoint.limits,
        })
    }
}

struct BoundedBytes(Vec<u8>);
impl Write for BoundedBytes {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if self.0.len().saturating_add(bytes.len()) > MAX_HOST_CHECKPOINT_BYTES {
            return Err(io::Error::other("host checkpoint capacity"));
        }
        self.0.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}
