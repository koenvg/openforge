mod persistence;
mod policy;
mod queries;
mod rows;
#[cfg(test)]
mod tests;

pub(crate) use persistence::{AutomaticAssociation, AutomaticPr};
pub use rows::{PrCommentRow, PrRow};

pub(super) const UNADDRESSED_COMMENT_COUNT_SQL: &str = "(
    SELECT COUNT(*)
    FROM pr_comments comment
    WHERE comment.pr_id = pr.id
      AND comment.addressed = 0
      AND comment.in_reply_to_id IS NULL
      AND NOT EXISTS (
          SELECT 1
          FROM config
          WHERE key = 'github_username'
            AND TRIM(value) <> ''
            AND comment.author = TRIM(value) COLLATE NOCASE
      )
)";
