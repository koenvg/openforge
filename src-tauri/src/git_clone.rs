//! Clone a GitHub repository and create a project from it.
//!
//! Composes the existing `git`-binary clone pattern, the stored GitHub PAT, and
//! the project registry into a single "add project from GitHub" flow.

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedRepo {
    pub owner: String,
    pub repo: String,
    pub clone_url: String,
    pub is_ssh: bool,
}

/// Parses a GitHub repository reference in HTTPS, SSH, or `owner/repo`
/// shorthand form into its owner, repo, canonical clone URL, and transport.
pub fn parse_repo_url(input: &str) -> Result<ParsedRepo, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("Repository URL cannot be empty".to_string());
    }

    // SSH: git@github.com:owner/repo(.git)
    if let Some(rest) = trimmed.strip_prefix("git@github.com:") {
        let (owner, repo) = split_owner_repo(rest)?;
        return Ok(ParsedRepo {
            clone_url: format!("git@github.com:{owner}/{repo}.git"),
            owner,
            repo,
            is_ssh: true,
        });
    }

    // HTTPS/HTTP: https://github.com/owner/repo(.git)(/...)
    for prefix in ["https://github.com/", "http://github.com/"] {
        if let Some(rest) = trimmed.strip_prefix(prefix) {
            let (owner, repo) = split_owner_repo(rest)?;
            return Ok(ParsedRepo {
                clone_url: format!("https://github.com/{owner}/{repo}.git"),
                owner,
                repo,
                is_ssh: false,
            });
        }
    }

    // Any other explicit scheme or SSH host is unsupported.
    if trimmed.contains("://") || trimmed.starts_with("git@") {
        return Err(format!("Only GitHub repositories are supported: {trimmed}"));
    }

    // Shorthand: owner/repo
    let (owner, repo) = split_owner_repo(trimmed)?;
    Ok(ParsedRepo {
        clone_url: format!("https://github.com/{owner}/{repo}.git"),
        owner,
        repo,
        is_ssh: false,
    })
}

/// Extracts the first two path segments (`owner`, `repo`) from the remainder of
/// a GitHub reference, stripping a trailing `.git`, query, and fragment.
fn split_owner_repo(rest: &str) -> Result<(String, String), String> {
    let cleaned = rest.trim_end_matches('/');
    let mut segments = cleaned.split('/');
    let owner = segments.next().unwrap_or("").trim().to_string();
    let repo_seg = segments.next().unwrap_or("").trim();
    if owner.is_empty() || repo_seg.is_empty() {
        return Err(format!("Could not parse owner/repo from: {rest}"));
    }
    let repo = repo_seg
        .split(|c| c == '?' || c == '#')
        .next()
        .unwrap_or(repo_seg);
    let repo = repo.strip_suffix(".git").unwrap_or(repo).to_string();
    if repo.is_empty() {
        return Err(format!("Could not parse repository name from: {rest}"));
    }
    Ok((owner, repo))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_full_https_url() {
        let parsed = parse_repo_url("https://github.com/acme/widgets").unwrap();
        assert_eq!(parsed.owner, "acme");
        assert_eq!(parsed.repo, "widgets");
        assert_eq!(parsed.clone_url, "https://github.com/acme/widgets.git");
        assert!(!parsed.is_ssh);
    }

    #[test]
    fn parses_https_url_with_dot_git_and_trailing_path() {
        let parsed = parse_repo_url("https://github.com/acme/widgets.git/tree/main").unwrap();
        assert_eq!(parsed.owner, "acme");
        assert_eq!(parsed.repo, "widgets");
        assert_eq!(parsed.clone_url, "https://github.com/acme/widgets.git");
    }

    #[test]
    fn parses_ssh_url() {
        let parsed = parse_repo_url("git@github.com:acme/widgets.git").unwrap();
        assert_eq!(parsed.owner, "acme");
        assert_eq!(parsed.repo, "widgets");
        assert_eq!(parsed.clone_url, "git@github.com:acme/widgets.git");
        assert!(parsed.is_ssh);
    }

    #[test]
    fn parses_shorthand() {
        let parsed = parse_repo_url("acme/widgets").unwrap();
        assert_eq!(parsed.owner, "acme");
        assert_eq!(parsed.repo, "widgets");
        assert_eq!(parsed.clone_url, "https://github.com/acme/widgets.git");
        assert!(!parsed.is_ssh);
    }

    #[test]
    fn rejects_empty_input() {
        assert!(parse_repo_url("   ").is_err());
    }

    #[test]
    fn rejects_non_github_url() {
        assert!(parse_repo_url("https://gitlab.com/acme/widgets").is_err());
    }

    #[test]
    fn rejects_missing_repo_segment() {
        assert!(parse_repo_url("acme").is_err());
    }
}
