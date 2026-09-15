//! Maintenance operations use their own bounded job identities across prepare/commit/abort.
pub use openforge_session_host::ReplacementPhase;
use crate::OperationId;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Capabilities {
    pub supports_replacement: bool,
    pub image_version: String,
    pub pid: u32,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReplacementStage { Preflight, Checkpoint, Exec, Initialization }
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum ReplacementState {
    Preparing,
    Prepared,
    Executing,
    Activated,
    Aborted,
    Failed { stage: ReplacementStage },
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReplacementStatus {
    pub operation: OperationId,
    pub state: ReplacementState,
    pub from_version: String,
    pub target_version: Option<String>,
    pub actual_version: String,
}
