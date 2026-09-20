use serde::Serialize;
use std::path::{Component, Path, PathBuf};

mod file_preview;
pub(crate) use file_preview::read_file_preview;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ProjectFsErrorKind {
    BadRequest,
    Forbidden,
    Internal,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ProjectFsError {
    kind: ProjectFsErrorKind,
    message: String,
}

impl ProjectFsError {
    fn bad_request(message: impl Into<String>) -> Self {
        Self {
            kind: ProjectFsErrorKind::BadRequest,
            message: message.into(),
        }
    }

    fn forbidden(message: impl Into<String>) -> Self {
        Self {
            kind: ProjectFsErrorKind::Forbidden,
            message: message.into(),
        }
    }

    fn internal(message: impl Into<String>) -> Self {
        Self {
            kind: ProjectFsErrorKind::Internal,
            message: message.into(),
        }
    }

    pub(crate) const fn kind(&self) -> ProjectFsErrorKind {
        self.kind
    }

    pub(crate) fn message(self) -> String {
        self.message
    }
}

impl std::fmt::Display for ProjectFsError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for ProjectFsError {}

pub(crate) type ProjectFsResult<T> = Result<T, ProjectFsError>;

impl From<crate::authorized_fs::AuthorizedOpenError> for ProjectFsError {
    fn from(error: crate::authorized_fs::AuthorizedOpenError) -> Self {
        let kind = match error.kind() {
            crate::authorized_fs::AuthorizedOpenErrorKind::BadRequest => {
                ProjectFsErrorKind::BadRequest
            }
            crate::authorized_fs::AuthorizedOpenErrorKind::Forbidden => {
                ProjectFsErrorKind::Forbidden
            }
            crate::authorized_fs::AuthorizedOpenErrorKind::Internal => ProjectFsErrorKind::Internal,
        };
        Self {
            kind,
            message: error.message(),
        }
    }
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectFileEntry {
    pub(crate) name: String,
    pub(crate) path: String,
    pub(crate) is_dir: bool,
    pub(crate) size: Option<u64>,
    pub(crate) modified_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectFileContent {
    pub(crate) r#type: String,
    pub(crate) content: String,
    pub(crate) mime_type: Option<String>,
    pub(crate) size: u64,
}

fn canonical_project_root(project_root: &Path) -> ProjectFsResult<PathBuf> {
    std::fs::canonicalize(project_root).map_err(|error| {
        ProjectFsError::bad_request(format!("Failed to canonicalize project root: {error}"))
    })
}

pub(crate) fn resolve_existing_path(
    project_root: &Path,
    sub_path: Option<&str>,
) -> ProjectFsResult<PathBuf> {
    let resolved = match sub_path {
        None | Some("") => project_root.to_path_buf(),
        Some(path) => {
            let requested_path = Path::new(path);
            if requested_path.is_absolute() {
                return Err(ProjectFsError::bad_request("file path must be relative"));
            }
            project_root.join(requested_path)
        }
    };
    let canonical_root = canonical_project_root(project_root)?;
    let canonical_resolved = std::fs::canonicalize(&resolved).map_err(|error| {
        ProjectFsError::bad_request(format!("Failed to canonicalize path: {error}"))
    })?;
    if !canonical_resolved.starts_with(&canonical_root) {
        return Err(ProjectFsError::forbidden(
            "Path traversal detected: access denied",
        ));
    }
    Ok(canonical_resolved)
}

pub(crate) fn resolve_write_path(project_root: &Path, sub_path: &str) -> ProjectFsResult<PathBuf> {
    if sub_path.trim().is_empty() {
        return Err(ProjectFsError::bad_request(
            "project file path must be relative",
        ));
    }
    let requested_path = Path::new(sub_path);
    if requested_path.is_absolute() {
        return Err(ProjectFsError::bad_request(
            "project file path must be relative",
        ));
    }
    if requested_path
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(ProjectFsError::forbidden(
            "Path traversal detected: access denied",
        ));
    }
    let canonical_root = canonical_project_root(project_root)?;
    let target = canonical_root.join(requested_path);
    if !target.starts_with(&canonical_root) {
        return Err(ProjectFsError::forbidden(
            "Path traversal detected: access denied",
        ));
    }
    if std::fs::symlink_metadata(&target).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
        return Err(ProjectFsError::forbidden(
            "Path traversal detected: access denied",
        ));
    }
    validate_write_parent_under_root(&canonical_root, &target)?;
    Ok(target)
}

fn validate_write_parent_under_root(canonical_root: &Path, target: &Path) -> ProjectFsResult<()> {
    let mut ancestor = target.parent().ok_or_else(|| {
        ProjectFsError::bad_request("project file path must include a parent directory")
    })?;

    while !ancestor.exists() {
        ancestor = ancestor.parent().ok_or_else(|| {
            ProjectFsError::bad_request("project file path parent could not be resolved")
        })?;
    }

    let canonical_parent = std::fs::canonicalize(ancestor).map_err(|error| {
        ProjectFsError::bad_request(format!("Failed to canonicalize parent path: {error}"))
    })?;
    if !canonical_parent.starts_with(canonical_root) {
        return Err(ProjectFsError::forbidden(
            "Path traversal detected: access denied",
        ));
    }

    Ok(())
}

pub(crate) async fn read_dir(
    project_root: &Path,
    sub_path: Option<&str>,
) -> ProjectFsResult<Vec<ProjectFileEntry>> {
    let canonical_root = canonical_project_root(project_root)?;
    let dir_to_read = resolve_existing_path(project_root, sub_path)?;
    let mut read_dir = tokio::fs::read_dir(&dir_to_read)
        .await
        .map_err(|error| ProjectFsError::internal(format!("Failed to read directory: {error}")))?;
    let mut dirs = Vec::new();
    let mut files = Vec::new();
    while let Some(entry) = read_dir.next_entry().await.map_err(|error| {
        ProjectFsError::internal(format!("Error reading directory entry: {error}"))
    })? {
        let metadata = match entry.metadata().await {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        let name = entry.file_name().to_string_lossy().to_string();
        let full_path = entry.path();
        let path = full_path
            .strip_prefix(&canonical_root)
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_else(|_| name.clone());
        let is_dir = metadata.is_dir();
        let modified_at = metadata
            .modified()
            .ok()
            .and_then(|time| crate::unix_timestamp::milliseconds(time).ok());
        let entry = ProjectFileEntry {
            name,
            path,
            is_dir,
            size: if is_dir { None } else { Some(metadata.len()) },
            modified_at,
        };
        if is_dir {
            dirs.push(entry);
        } else {
            files.push(entry);
        }
    }
    dirs.sort_by(|left, right| left.name.cmp(&right.name));
    files.sort_by(|left, right| left.name.cmp(&right.name));
    dirs.extend(files);
    Ok(dirs)
}

pub(crate) fn search_files(project_root: &Path, query: &str, limit: usize) -> Vec<String> {
    crate::command_discovery::search_project_files(&project_root.to_string_lossy(), query, limit)
}

pub(crate) fn search_files_checked(
    project_root: &Path,
    query: &str,
    limit: usize,
) -> ProjectFsResult<Vec<String>> {
    let canonical_root = canonical_project_root(project_root)?;
    crate::command_discovery::try_search_project_files(
        &canonical_root.to_string_lossy(),
        query,
        limit,
    )
    .map_err(|error| {
        ProjectFsError::internal(format!(
            "Failed to search Task workspace repository: {error}"
        ))
    })
}

pub(crate) async fn write_file(
    project_root: &Path,
    sub_path: &str,
    content: &str,
) -> ProjectFsResult<()> {
    let target = resolve_write_path(project_root, sub_path)?;
    if let Some(parent) = target.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|error| {
            ProjectFsError::internal(format!("failed to create parent directory: {error}"))
        })?;
    }
    tokio::fs::write(target, content).await.map_err(|error| {
        ProjectFsError::internal(format!("failed to write project file: {error}"))
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_write_path_rejects_traversal_without_requiring_target_to_exist() {
        let temp_dir = tempfile::tempdir().expect("project root");
        let nested = resolve_write_path(temp_dir.path(), "generated/output.txt")
            .expect("write path under root");
        assert_eq!(
            nested,
            std::fs::canonicalize(temp_dir.path())
                .expect("canonical root")
                .join("generated/output.txt")
        );

        let traversal =
            resolve_write_path(temp_dir.path(), "../outside.txt").expect_err("traversal rejected");
        assert_eq!(traversal.kind(), ProjectFsErrorKind::Forbidden);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn write_file_rejects_symlinked_parent_escape() {
        let temp_dir = tempfile::tempdir().expect("project root");
        let outside_dir = tempfile::tempdir().expect("outside dir");
        let symlink_path = temp_dir.path().join("link");
        std::os::unix::fs::symlink(outside_dir.path(), &symlink_path).expect("symlink parent");

        let escape_target = outside_dir.path().join("out.txt");
        let error = write_file(temp_dir.path(), "link/out.txt", "escaped")
            .await
            .expect_err("symlinked parent write rejected");

        assert_eq!(error.kind(), ProjectFsErrorKind::Forbidden);
        assert!(
            !escape_target.exists(),
            "write through symlinked parent must not create files outside the project root"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn write_file_rejects_symlinked_target_escape() {
        let temp_dir = tempfile::tempdir().expect("project root");
        let outside_dir = tempfile::tempdir().expect("outside dir");
        let outside_file = outside_dir.path().join("outside.txt");
        std::fs::write(&outside_file, "original").expect("outside file");
        std::os::unix::fs::symlink(&outside_file, temp_dir.path().join("linked.txt"))
            .expect("symlink target");

        let error = write_file(temp_dir.path(), "linked.txt", "escaped")
            .await
            .expect_err("symlinked target write rejected");
        let outside_contents = std::fs::read_to_string(outside_file).expect("outside file remains");

        assert_eq!(error.kind(), ProjectFsErrorKind::Forbidden);
        assert_eq!(outside_contents, "original");
    }

    #[test]
    fn resolve_existing_path_rejects_traversal() {
        let temp_dir = tempfile::tempdir().expect("project root");
        let outside_name = format!(
            "{}-outside.txt",
            temp_dir
                .path()
                .file_name()
                .expect("temp dir name")
                .to_string_lossy()
        );
        let parent_file = temp_dir.path().with_file_name(&outside_name);
        std::fs::write(&parent_file, "outside").expect("outside file");

        let traversal = resolve_existing_path(temp_dir.path(), Some(&format!("../{outside_name}")))
            .expect_err("traversal rejected");
        assert_eq!(traversal.kind(), ProjectFsErrorKind::Forbidden);

        let inside_file = temp_dir.path().join("inside.txt");
        std::fs::write(&inside_file, "inside").expect("inside file");
        let absolute = resolve_existing_path(
            temp_dir.path(),
            Some(inside_file.to_str().expect("UTF-8 fixture path")),
        )
        .expect_err("absolute path rejected");
        assert_eq!(absolute.kind(), ProjectFsErrorKind::BadRequest);

        std::fs::remove_file(parent_file).ok();
    }
}
