use rusqlite::Result;

use crate::db::Database;

pub(super) struct PullRequestFixture {
    id: i64,
    ticket_id: String,
    repo_owner: String,
    title: String,
    url: String,
    state: String,
    created_at: i64,
    updated_at: i64,
}

impl PullRequestFixture {
    pub(super) fn new(id: i64) -> Self {
        Self {
            id,
            ticket_id: "T-100".to_string(),
            repo_owner: "acme".to_string(),
            title: "PR".to_string(),
            url: "https://example.com".to_string(),
            state: "open".to_string(),
            created_at: 1000,
            updated_at: 1000,
        }
    }

    pub(super) fn ticket_id(mut self, ticket_id: &str) -> Self {
        self.ticket_id = ticket_id.to_string();
        self
    }

    pub(super) fn repo_owner(mut self, repo_owner: &str) -> Self {
        self.repo_owner = repo_owner.to_string();
        self
    }

    pub(super) fn title(mut self, title: &str) -> Self {
        self.title = title.to_string();
        self
    }

    pub(super) fn url(mut self, url: &str) -> Self {
        self.url = url.to_string();
        self
    }

    pub(super) fn state(mut self, state: &str) -> Self {
        self.state = state.to_string();
        self
    }

    pub(super) fn created_at(mut self, created_at: i64) -> Self {
        self.created_at = created_at;
        self
    }

    pub(super) fn updated_at(mut self, updated_at: i64) -> Self {
        self.updated_at = updated_at;
        self
    }

    pub(super) fn insert(self, db: &Database) -> Result<()> {
        db.insert_pull_request(
            self.id,
            &self.ticket_id,
            &self.repo_owner,
            "repo",
            &self.title,
            &self.url,
            &self.state,
            self.created_at,
            self.updated_at,
            false,
        )
    }
}

pub(super) struct PrCommentFixture {
    id: i64,
    pr_id: i64,
    author: String,
    body: String,
    comment_type: String,
    file_path: Option<String>,
    line_number: Option<i32>,
    addressed: bool,
    created_at: i64,
}

impl PrCommentFixture {
    pub(super) fn new(id: i64, pr_id: i64, body: &str) -> Self {
        Self {
            id,
            pr_id,
            author: "reviewer".to_string(),
            body: body.to_string(),
            comment_type: "review_comment".to_string(),
            file_path: None,
            line_number: None,
            addressed: false,
            created_at: 1000,
        }
    }

    pub(super) fn author(mut self, author: &str) -> Self {
        self.author = author.to_string();
        self
    }

    pub(super) fn comment_type(mut self, comment_type: &str) -> Self {
        self.comment_type = comment_type.to_string();
        self
    }

    pub(super) fn file_path(mut self, file_path: &str) -> Self {
        self.file_path = Some(file_path.to_string());
        self
    }

    pub(super) fn line_number(mut self, line_number: i32) -> Self {
        self.line_number = Some(line_number);
        self
    }

    pub(super) fn addressed(mut self, addressed: bool) -> Self {
        self.addressed = addressed;
        self
    }

    pub(super) fn created_at(mut self, created_at: i64) -> Self {
        self.created_at = created_at;
        self
    }

    pub(super) fn insert(self, db: &Database) -> Result<()> {
        db.insert_pr_comment(
            self.id,
            self.pr_id,
            &self.author,
            &self.body,
            &self.comment_type,
            self.file_path.as_deref(),
            self.line_number,
            self.addressed,
            self.created_at,
        )
    }
}
