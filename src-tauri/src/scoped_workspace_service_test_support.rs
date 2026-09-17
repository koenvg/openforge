use super::*;
use std::{
    fs,
    process::Command,
    sync::atomic::{AtomicUsize, Ordering},
};

pub(super) struct FailOnceRemover(pub(super) AtomicUsize);
pub(super) struct FailingMeasurer;
pub(super) struct FailingPublisher;
pub(super) struct BlockingRemover {
    pub(super) entered: tokio::sync::Notify,
    pub(super) proceed: tokio::sync::Notify,
}

impl WorkspaceRemover for FailOnceRemover {
    fn remove<'a>(
        &'a self,
        repo_path: &'a Path,
        workspace_path: &'a Path,
    ) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'a>> {
        Box::pin(async move {
            if self.0.fetch_add(1, Ordering::SeqCst) == 0 {
                return Err("simulated busy checkout".to_string());
            }
            git_worktree::remove_worktree(repo_path, workspace_path)
                .await
                .map_err(|error| error.to_string())
        })
    }
}

impl WorkspaceMeasurer for FailingMeasurer {
    fn measure(&self, _root: &Path) -> io::Result<u64> {
        Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "simulated measurement denial",
        ))
    }
}

impl WorkspacePublisher for FailingPublisher {
    fn publish<'a>(
        &'a self,
        _repo_path: &'a Path,
        _staged_path: &'a Path,
        _published_path: &'a Path,
    ) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'a>> {
        Box::pin(async { Err("simulated publication failure".to_string()) })
    }
}

impl WorkspaceRemover for BlockingRemover {
    fn remove<'a>(
        &'a self,
        repo_path: &'a Path,
        workspace_path: &'a Path,
    ) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'a>> {
        Box::pin(async move {
            self.entered.notify_one();
            self.proceed.notified().await;
            git_worktree::remove_worktree(repo_path, workspace_path)
                .await
                .map_err(|error| error.to_string())
        })
    }
}

pub(super) fn run_git(repo: &std::path::Path, arguments: &[&str]) -> String {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(arguments)
        .output()
        .expect("run git");
    assert!(
        output.status.success(),
        "git {:?} failed: {}",
        arguments,
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout)
        .expect("git stdout is UTF-8")
        .trim()
        .to_string()
}

pub(super) fn repository(root: &std::path::Path) -> std::path::PathBuf {
    let repo = root.join("repository");
    fs::create_dir_all(&repo).expect("create repository directory");
    run_git(&repo, &["init", "-b", "main"]);
    run_git(&repo, &["config", "user.name", "OpenForge Test"]);
    run_git(&repo, &["config", "user.email", "openforge@example.com"]);
    run_git(&repo, &["config", "commit.gpgsign", "false"]);
    fs::write(repo.join("README.md"), "first revision\n").expect("write fixture");
    run_git(&repo, &["add", "README.md"]);
    run_git(&repo, &["commit", "-m", "initial"]);
    repo
}

pub(super) fn add_origin(repo: &Path, root: &Path) {
    let origin = root.join("origin.git");
    fs::create_dir_all(&origin).expect("create origin directory");
    run_git(&origin, &["init", "--bare"]);
    run_git(
        repo,
        &[
            "remote",
            "add",
            "origin",
            origin.to_str().expect("UTF-8 origin"),
        ],
    );
    run_git(repo, &["push", "-u", "origin", "main"]);
}

pub(super) fn project_plugin(id: &str) -> crate::db::PluginRow {
    crate::db::PluginRow {
        id: id.to_string(),
        name: "Review".to_string(),
        version: "1.0.0".to_string(),
        api_version: 1,
        description: String::new(),
        permissions: "[]".to_string(),
        contributes: "{}".to_string(),
        frontend_entry: "index.js".to_string(),
        backend_entry: None,
        install_path: "/tmp/plugin".to_string(),
        source_kind: "legacy".to_string(),
        source_spec: String::new(),
        package_metadata: "{}".to_string(),
        installed_at: 0,
        is_builtin: false,
    }
}
