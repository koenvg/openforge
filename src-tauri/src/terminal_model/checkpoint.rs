use super::super::{
    GhosttyTerminalModel, TerminalModel, TerminalModelError, MAX_SNAPSHOT_CONTINUATION_BYTES,
};
use openforge_session_host::TerminalColorProfile;
use serde::{Deserialize, Serialize};

const FORMAT: u32 = 1;
const MAX_RETAINED_CHANGES: usize = 1024;
pub(crate) const MAX_TERMINAL_CHECKPOINT_BYTES: usize = 16 * 1024 * 1024;

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", deny_unknown_fields)]
pub(super) enum RetainedChange {
    Feed { bytes: Vec<u8> },
    Resize { cols: u16, rows: u16 },
    ColorProfile { profile: TerminalColorProfile },
}
impl RetainedChange {
    fn size(&self) -> usize {
        match self {
            Self::Feed { bytes } => bytes.len(),
            Self::Resize { .. } => 4,
            Self::ColorProfile { .. } => std::mem::size_of::<TerminalColorProfile>(),
        }
    }
}

/// Owner-only checkpoint. Presentation replay is never fed back into the authority.
///
/// The native codec restores parser state but not continuation tracking. Until tracking
/// recovers, keep the last native image plus a bounded ordered delta. Reconstruction
/// consumes that delta privately and discards its already-delivered protocol replies.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct TerminalModelCheckpoint {
    format: u32,
    pub(super) instance_id: u64,
    pub(super) watermark: u64,
    model: Vec<u8>,
    #[serde(default)]
    color_profile: TerminalColorProfile,
    changes: Vec<RetainedChange>,
    pub(super) compatibility_replay: Vec<u8>,
    pub(super) continuation: Vec<u8>,
}
impl TerminalModelCheckpoint {
    #[allow(dead_code, reason = "Used by the daemon's shared-source build")]
    pub(crate) fn instance_id(&self) -> u64 {
        self.instance_id
    }
    #[allow(dead_code, reason = "Used by the daemon's shared-source build")]
    pub(crate) fn retained_bytes(&self) -> usize {
        self.model
            .len()
            .saturating_add(self.compatibility_replay.len())
            .saturating_add(self.continuation.len())
            .saturating_add(
                self.changes
                    .iter()
                    .map(RetainedChange::size)
                    .fold(0, usize::saturating_add),
            )
    }

    /// Decode and exercise presentation privately, without starting an owner worker
    /// or emitting any of the saved model's already-delivered protocol replies.
    #[allow(dead_code, reason = "Used by the daemon's shared-source build")]
    pub(crate) fn validate_for_image(&self) -> Result<(), String> {
        self.decode()?
            .format_portable_vt()
            .map(|_| ())
            .map_err(|error| error.to_string())
    }

    pub(super) fn capture(
        instance_id: u64,
        watermark: u64,
        model: &GhosttyTerminalModel,
        compatibility_replay: Vec<u8>,
        retained: Option<&Self>,
    ) -> Result<Self, String> {
        let mut checkpoint = match model.encode_snapshot() {
            Ok(model_bytes) => Self {
                format: FORMAT,
                instance_id,
                watermark,
                model: model_bytes,
                color_profile: model.color_profile(),
                changes: Vec::new(),
                compatibility_replay: Vec::new(),
                continuation: model
                    .parser_continuation()
                    .map_err(|error| error.to_string())?,
            },
            Err(error @ TerminalModelError::ContinuationUnavailable) => {
                retained.ok_or_else(|| error.to_string())?.clone()
            }
            Err(error) => return Err(error.to_string()),
        };
        checkpoint.instance_id = instance_id;
        checkpoint.watermark = watermark;
        checkpoint.color_profile = model.color_profile();
        checkpoint.compatibility_replay = compatibility_replay;
        checkpoint.validate()?;
        Ok(checkpoint)
    }

    pub(super) fn record_change(
        retained: &mut Option<Self>,
        model: &GhosttyTerminalModel,
        change: impl FnOnce() -> RetainedChange,
    ) {
        let Some(checkpoint) = retained.as_mut() else {
            return;
        };
        if !matches!(
            model.ensure_snapshot_continuation_available(),
            Err(TerminalModelError::ContinuationUnavailable)
        ) {
            *retained = None;
            return;
        }
        let change = change();
        let total: usize = checkpoint.changes.iter().map(RetainedChange::size).sum();
        let continuation_size = checkpoint.continuation.len()
            + match &change {
                RetainedChange::Feed { bytes } => bytes.len(),
                RetainedChange::Resize { .. } => 0,
                RetainedChange::ColorProfile { .. } => 0,
            };
        if checkpoint.changes.len() >= MAX_RETAINED_CHANGES
            || total.saturating_add(change.size()) > MAX_SNAPSHOT_CONTINUATION_BYTES
            || continuation_size > MAX_SNAPSHOT_CONTINUATION_BYTES
        {
            // Serving continues. Replacement/recovery must refuse until native tracking recovers.
            *retained = None;
            return;
        }
        if let RetainedChange::Feed { bytes } = &change {
            checkpoint.continuation.extend_from_slice(bytes);
        }
        checkpoint.changes.push(change);
    }

    pub(super) fn decode(&self) -> Result<GhosttyTerminalModel, String> {
        self.validate()?;
        let mut model = GhosttyTerminalModel::decode_snapshot(&self.model)
            .map_err(|error| error.to_string())?;
        model
            .update_color_profile(self.color_profile)
            .map_err(|error| error.to_string())?;
        for change in &self.changes {
            match change {
                RetainedChange::Feed { bytes } => model.feed(bytes),
                RetainedChange::Resize { cols, rows } => model.resize(*cols, *rows),
                RetainedChange::ColorProfile { profile } => model.update_color_profile(*profile),
            }
            .map_err(|error| error.to_string())?;
            model.take_protocol_replies();
        }
        Ok(model)
    }

    pub(super) fn validate(&self) -> Result<(), String> {
        if self.format != FORMAT || self.instance_id == 0 || self.model.is_empty() {
            return Err("incompatible terminal checkpoint".into());
        }
        if self.watermark == u64::MAX {
            return Err("terminal output sequence exhausted".into());
        }
        if self.model.len() > MAX_TERMINAL_CHECKPOINT_BYTES
            || self.compatibility_replay.len() > MAX_SNAPSHOT_CONTINUATION_BYTES
            || self.continuation.len() > MAX_SNAPSHOT_CONTINUATION_BYTES
            || self.changes.len() > MAX_RETAINED_CHANGES
            || self
                .changes
                .iter()
                .map(RetainedChange::size)
                .try_fold(0usize, usize::checked_add)
                .is_none_or(|bytes| bytes > MAX_SNAPSHOT_CONTINUATION_BYTES)
        {
            return Err("terminal checkpoint budget exceeded".into());
        }
        Ok(())
    }
}
