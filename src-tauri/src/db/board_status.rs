use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BoardStatus {
    Backlog,
    Doing,
    Done,
}

impl BoardStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Backlog => "backlog",
            Self::Doing => "doing",
            Self::Done => "done",
        }
    }

    /// Whether a client may assign this status to a task.
    ///
    /// `Done` is a legacy, recognized-but-unreachable status (AVIV-118 removed
    /// the Done lane and its reopen path). Assigning it hides the task from every
    /// board filter, count, and search with no runtime cleanup, leaking the
    /// worktree and any running agent while the task is invisible. It stays
    /// parseable so existing `done` rows remain readable, but every write
    /// boundary must reject it.
    pub fn is_writable(self) -> bool {
        !matches!(self, Self::Done)
    }

    fn normalize(value: &str) -> Option<Self> {
        match value.trim().to_lowercase().as_str() {
            "backlog" | "todo" => Some(Self::Backlog),
            "doing" | "in_progress" | "in_review" | "testing" => Some(Self::Doing),
            "done" => Some(Self::Done),
            _ => None,
        }
    }
}

impl fmt::Display for BoardStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for BoardStatus {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::normalize(value).ok_or_else(|| format!("Invalid board status: {value}"))
    }
}

#[cfg(test)]
mod tests {
    use super::BoardStatus;
    use std::str::FromStr;

    #[test]
    fn test_board_status_parses_canonical_and_legacy_values() {
        assert_eq!(
            BoardStatus::from_str("backlog").unwrap(),
            BoardStatus::Backlog
        );
        assert_eq!(BoardStatus::from_str("todo").unwrap(), BoardStatus::Backlog);
        assert_eq!(BoardStatus::from_str("doing").unwrap(), BoardStatus::Doing);
        assert_eq!(
            BoardStatus::from_str("in_progress").unwrap(),
            BoardStatus::Doing
        );
        assert_eq!(BoardStatus::from_str("done").unwrap(), BoardStatus::Done);
    }

    #[test]
    fn test_board_status_rejects_unknown_values() {
        assert!(BoardStatus::from_str("wat").is_err());
    }

    #[test]
    fn test_board_status_done_is_not_writable() {
        // 'done' still parses so legacy rows remain readable...
        assert!(BoardStatus::Backlog.is_writable());
        assert!(BoardStatus::Doing.is_writable());
        // ...but it can never be assigned as a new status (AVIV-118 black hole).
        assert!(!BoardStatus::Done.is_writable());
    }

    #[test]
    fn test_board_status_serializes_to_canonical_lowercase_strings() {
        assert_eq!(
            serde_json::to_string(&BoardStatus::Backlog).unwrap(),
            "\"backlog\""
        );
        assert_eq!(
            serde_json::to_string(&BoardStatus::Doing).unwrap(),
            "\"doing\""
        );
        assert_eq!(
            serde_json::to_string(&BoardStatus::Done).unwrap(),
            "\"done\""
        );
    }
}
