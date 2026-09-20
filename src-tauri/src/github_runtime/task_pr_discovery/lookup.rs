use super::{detector::Candidate, verification::GitContext};
use crate::github_client::{GitHubClient, GitHubError, PullRequest};

pub(super) enum Lookup {
    Verified(Candidate, Box<PullRequest>),
    NotVisible,
    Rejected,
}

pub(super) async fn lookup(
    github: &GitHubClient,
    token: &str,
    git: &GitContext,
    candidate: Option<&Candidate>,
) -> Result<Lookup, GitHubError> {
    if let Some(candidate) = candidate {
        let pr = github
            .get_pr_details(&candidate.owner, &candidate.repo, candidate.number, token)
            .await?;
        return Ok(if git.verifies(candidate, &pr) {
            Lookup::Verified(candidate.clone(), Box::new(pr))
        } else {
            Lookup::Rejected
        });
    }
    let mut branches = vec![git.branch.as_str()];
    if let Some(tracked) = git.tracked_branch.as_deref() {
        if !branches.contains(&tracked) {
            branches.push(tracked);
        }
    }
    let mut eligible = Vec::new();
    for (owner, repo) in &git.trusted_bases {
        for branch in &branches {
            let head = format!("{}:{branch}", git.head_repo.0);
            for pr in github.open_prs_by_head(owner, repo, &head, token).await? {
                let candidate = Candidate {
                    owner: owner.clone(),
                    repo: repo.clone(),
                    number: pr.number,
                };
                if git.verifies(&candidate, &pr) && !eligible.iter().any(|(c, _)| c == &candidate) {
                    eligible.push((candidate, pr));
                    if eligible.len() > 1 {
                        return Ok(Lookup::Rejected);
                    }
                }
            }
        }
    }
    Ok(match eligible.pop() {
        Some((candidate, pr)) => Lookup::Verified(candidate, Box::new(pr)),
        None => Lookup::NotVisible,
    })
}
