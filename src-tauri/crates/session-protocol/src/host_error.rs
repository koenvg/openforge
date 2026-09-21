use crate::Error;
use openforge_session_host::HostError;
impl From<HostError> for Error {
    fn from(error: HostError) -> Self {
        match error {
            HostError::InvalidRequest(_) | HostError::InvalidIdentity(_) => Self::InvalidRequest,
            HostError::ForeignInstallation => Self::ForeignInstallation,
            HostError::StaleController => Self::StaleController,
            HostError::StalePty => Self::StalePty,
            HostError::StaleOutput => Self::StaleOutput,
            HostError::OperationConflict => Self::OperationConflict,
            HostError::OperationExpired => Self::OperationExpired,
            HostError::OutcomeUnknown => Self::OutcomeUnknown,
            HostError::Capacity => Self::Capacity,
            HostError::CapacityExceeded(kind) => Self::CapacityExceeded(kind),
            HostError::OutOfOrder => Self::OutOfOrder,
            HostError::UnsupportedReplacement => Self::UnsupportedReplacement,
            HostError::RecoveryUnavailable => Self::RecoveryUnavailable,
            HostError::Backend(message) => Self::Host(message),
        }
    }
}
impl From<Error> for HostError {
    fn from(error: Error) -> Self {
        match error {
            Error::InvalidRequest => Self::InvalidRequest("invalid wire request"),
            Error::ForeignInstallation => Self::ForeignInstallation,
            Error::StaleController => Self::StaleController,
            Error::StalePty => Self::StalePty,
            Error::StaleOutput => Self::StaleOutput,
            Error::OperationConflict => Self::OperationConflict,
            Error::OperationExpired => Self::OperationExpired,
            Error::OutcomeUnknown | Error::Transport(_) => Self::OutcomeUnknown,
            Error::Capacity => Self::Capacity,
            Error::CapacityExceeded(kind) => Self::CapacityExceeded(kind),
            Error::OutOfOrder => Self::OutOfOrder,
            Error::UnsupportedReplacement => Self::UnsupportedReplacement,
            Error::RecoveryUnavailable => Self::RecoveryUnavailable,
            other => Self::Backend(other.to_string()),
        }
    }
}
