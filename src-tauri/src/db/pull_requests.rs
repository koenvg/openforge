mod persistence;
mod policy;
mod queries;
mod rows;
#[cfg(test)]
mod tests;

pub use rows::{PrCommentRow, PrRow};

pub(super) const UNADDRESSED_COMMENT_COUNT_SQL: &str =
    "(SELECT COUNT(*) FROM pr_comments WHERE pr_id = pr.id AND addressed = 0)";
