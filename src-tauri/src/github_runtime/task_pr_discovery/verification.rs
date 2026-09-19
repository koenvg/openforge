use super::detector::Candidate;
use crate::github_client::PullRequest;
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct GitContext {
    pub branch: String,
    pub head_repo: (String, String),
    pub tracked_branch: Option<String>,
    pub trusted_bases: Vec<(String, String)>,
}

impl GitContext {
    pub(super) fn resolve(path: &Path) -> Option<Self> {
        let repo = git2::Repository::open(path).ok()?;
        let head = repo.head().ok()?;
        if !head.is_branch() {
            return None;
        }
        let branch = head.shorthand().ok()?.to_owned();
        let config = repo.config().ok()?;
        let tracking_remote = config.get_string(&format!("branch.{branch}.remote")).ok();
        let remote_name = config
            .get_string(&format!("branch.{branch}.pushRemote"))
            .ok()
            .or_else(|| config.get_string("remote.pushDefault").ok())
            .or_else(|| tracking_remote.clone())
            .unwrap_or_else(|| "origin".into());
        let head_repo = remote_identity(&config, &remote_name, true)?;
        let tracked_branch = if tracking_remote
            .as_deref()
            .and_then(|r| remote_identity(&config, r, false))
            .as_ref()
            == Some(&head_repo)
        {
            config
                .get_string(&format!("branch.{branch}.merge"))
                .ok()
                .and_then(|r| r.strip_prefix("refs/heads/").map(str::to_owned))
        } else {
            None
        };
        let mut trusted_bases = vec![head_repo.clone()];
        for remote in ["origin", "upstream"] {
            if let Some(identity) = remote_identity(&config, remote, false) {
                if !trusted_bases.contains(&identity) {
                    trusted_bases.push(identity);
                }
            }
        }
        trusted_bases.sort();
        Some(Self {
            branch,
            head_repo,
            tracked_branch,
            trusted_bases,
        })
    }

    pub(super) fn verifies(&self, candidate: &Candidate, pr: &PullRequest) -> bool {
        let base = (
            candidate.owner.to_ascii_lowercase(),
            candidate.repo.to_ascii_lowercase(),
        );
        pr.state == "open"
            && pr.number == candidate.number
            && pr
                .extra
                .get("id")
                .and_then(|id| id.as_i64())
                .is_some_and(|id| id > 0)
            && pr.extra.get("merged").and_then(|v| v.as_bool()) != Some(true)
            && self.trusted_bases.contains(&base)
            && response_repo(&pr.head.extra["repo"]).as_ref() == Some(&self.head_repo)
            && response_repo(&pr.extra["base"]["repo"]).as_ref() == Some(&base)
            && (pr.head.ref_name == self.branch
                || self.tracked_branch.as_ref() == Some(&pr.head.ref_name))
    }
}

fn response_repo(value: &serde_json::Value) -> Option<(String, String)> {
    let name = value.get("full_name")?.as_str()?;
    super::super::repo_resolution::parse_git_remote_repo(&format!("https://github.com/{name}"))
        .map(|(owner, repo)| (owner.to_ascii_lowercase(), repo.to_ascii_lowercase()))
}

fn remote_identity(config: &git2::Config, remote: &str, push: bool) -> Option<(String, String)> {
    let push_key = format!("remote.{remote}.pushurl");
    let key = if push && config.get_string(&push_key).is_ok() {
        push_key
    } else {
        format!("remote.{remote}.url")
    };
    let mut entries = config.multivar(&key, None).ok()?;
    let url = entries.next()?.ok()?.value().ok()?.to_owned();
    if entries.next().is_some() {
        return None;
    }
    super::super::repo_resolution::parse_git_remote_repo(&url)
        .map(|(owner, repo)| (owner.to_ascii_lowercase(), repo.to_ascii_lowercase()))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn worktree() -> (tempfile::TempDir, git2::Repository) {
        let dir = tempfile::tempdir().unwrap();
        let repo = git2::Repository::init(dir.path()).unwrap();
        let tree = repo.index().unwrap().write_tree().unwrap();
        let sig = git2::Signature::now("test", "test@example.com").unwrap();
        repo.commit(
            Some("refs/heads/local"),
            &sig,
            &sig,
            "initial",
            &repo.find_tree(tree).unwrap(),
            &[],
        )
        .unwrap();
        repo.set_head("refs/heads/local").unwrap();
        (dir, repo)
    }
    fn details(head: &str, branch: &str, base: &str, state: &str) -> PullRequest {
        serde_json::from_value(serde_json::json!({
            "id": 500, "number": 42, "title": "new PR", "state": state, "draft": true,
            "html_url": "https://github.com/upstream/widgets/pull/42", "user": {"login": "other-author"},
            "head": {"ref": branch, "sha": "abc", "repo": {"full_name": head}},
            "base": {"ref": "main", "repo": {"full_name": base}}
        })).unwrap()
    }
    #[test]
    fn verifies_fork_and_differently_named_tracked_branch_without_trusting_output() {
        let (dir, repo) = worktree();
        repo.remote("origin", "git@github.com:fork/widgets.git")
            .unwrap();
        repo.remote("upstream", "https://github.com/upstream/widgets.git")
            .unwrap();
        let mut config = repo.config().unwrap();
        config.set_str("branch.local.remote", "origin").unwrap();
        config
            .set_str("branch.local.merge", "refs/heads/published")
            .unwrap();
        let context = GitContext::resolve(dir.path()).expect("resolve fork worktree");
        let candidate = Candidate {
            owner: "upstream".into(),
            repo: "widgets".into(),
            number: 42,
        };
        assert!(context.verifies(
            &candidate,
            &details("fork/widgets", "published", "upstream/widgets", "open")
        ));
        assert!(context.verifies(
            &candidate,
            &details("fork/widgets", "local", "upstream/widgets", "open")
        ));
        for pr in [
            details("other/widgets", "published", "upstream/widgets", "open"),
            details("fork/widgets", "other", "upstream/widgets", "open"),
            details("fork/widgets", "published", "evil/widgets", "open"),
            details("fork/widgets", "published", "upstream/widgets", "closed"),
        ] {
            assert!(!context.verifies(&candidate, &pr));
        }
    }
    #[test]
    fn unresolvable_head_and_untrusted_remote_fail_closed() {
        let (dir, repo) = worktree();
        assert!(GitContext::resolve(dir.path()).is_none());
        repo.remote("origin", "https://evil.example/acme/widgets")
            .unwrap();
        assert!(GitContext::resolve(dir.path()).is_none());
        repo.remote_set_url("origin", "https://github.com/acme/widgets/extra")
            .unwrap();
        assert!(GitContext::resolve(dir.path()).is_none());
    }
}
