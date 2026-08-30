use crate::db::{Database, NewTaskOptions};
use serde::{Deserialize, Serialize};
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};

const FIXTURE_COMMAND: &str = "desktop-test-fixture";
const PROJECT_NAME: &str = "Desktop Test Project";
const TASK_PROMPT: &str = "Exercise the full-app terminal test environment";
const TASK_TITLE: &str = "Terminal performance fixture";
const FIXTURE_PROVIDER: &str = "desktop-test";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct FixtureOptions {
    pub app_data_dir: PathBuf,
    pub repo_path: PathBuf,
    pub manifest_path: PathBuf,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FixtureManifest {
    pub schema_version: u32,
    pub project_id: String,
    pub task_id: String,
    pub project_name: String,
    pub task_title: String,
    pub repo_path: PathBuf,
    pub workspace_path: PathBuf,
    pub app_data_dir: PathBuf,
    pub database_path: PathBuf,
}

fn take_path_value(args: &[OsString], index: &mut usize, flag: &str) -> Result<PathBuf, String> {
    *index += 1;
    let value = args
        .get(*index)
        .ok_or_else(|| format!("{flag} requires a value"))?;
    if value.is_empty() {
        return Err(format!("{flag} requires a non-empty value"));
    }
    Ok(PathBuf::from(value))
}

pub(crate) fn parse_fixture_command(args: &[OsString]) -> Result<Option<FixtureOptions>, String> {
    let Some(command) = args.first() else {
        return Ok(None);
    };
    if command != FIXTURE_COMMAND {
        return Ok(None);
    }

    let mut app_data_dir = None;
    let mut repo_path = None;
    let mut manifest_path = None;
    let mut index = 1;
    while index < args.len() {
        let flag = args[index]
            .to_str()
            .ok_or_else(|| "fixture argument names must be valid UTF-8".to_string())?;
        match flag {
            "--app-data-dir" if app_data_dir.is_none() => {
                app_data_dir = Some(take_path_value(args, &mut index, flag)?);
            }
            "--repo-path" if repo_path.is_none() => {
                repo_path = Some(take_path_value(args, &mut index, flag)?);
            }
            "--manifest" if manifest_path.is_none() => {
                manifest_path = Some(take_path_value(args, &mut index, flag)?);
            }
            "--app-data-dir" | "--repo-path" | "--manifest" => {
                return Err(format!("duplicate argument: {flag}"));
            }
            _ => return Err(format!("unknown argument: {flag}")),
        }
        index += 1;
    }

    Ok(Some(FixtureOptions {
        app_data_dir: app_data_dir
            .ok_or_else(|| "desktop-test-fixture requires --app-data-dir".to_string())?,
        repo_path: repo_path
            .ok_or_else(|| "desktop-test-fixture requires --repo-path".to_string())?,
        manifest_path: manifest_path
            .ok_or_else(|| "desktop-test-fixture requires --manifest".to_string())?,
    }))
}

fn normalized_absolute_path(path: &Path) -> Result<PathBuf, String> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|error| format!("failed to resolve current directory: {error}"))?
            .join(path)
    };
    Ok(absolute.components().collect())
}

fn validate_repo_path(repo_path: &Path) -> Result<PathBuf, String> {
    let canonical = repo_path.canonicalize().map_err(|error| {
        format!(
            "fixture repository {} is not accessible: {error}",
            repo_path.display()
        )
    })?;
    if !canonical.is_dir() || !canonical.join(".git").exists() {
        return Err(format!(
            "fixture repository {} is not a Git repository",
            repo_path.display()
        ));
    }
    Ok(canonical)
}

fn prepare_app_data_dir(
    app_data_dir: &Path,
    default_app_data_dir: Option<&Path>,
) -> Result<PathBuf, String> {
    let absolute = normalized_absolute_path(app_data_dir)?;
    if let Some(default_dir) = default_app_data_dir {
        let default_absolute = normalized_absolute_path(default_dir)?;
        if absolute == default_absolute {
            return Err(format!(
                "refusing to seed the normal OpenForge app data directory {}",
                absolute.display()
            ));
        }
    }

    if absolute.exists() {
        if !absolute.is_dir() {
            return Err(format!(
                "fixture app data path {} is not a directory",
                absolute.display()
            ));
        }
        let mut entries = fs::read_dir(&absolute).map_err(|error| {
            format!(
                "failed to inspect fixture app data directory {}: {error}",
                absolute.display()
            )
        })?;
        if entries.next().is_some() {
            return Err(format!(
                "fixture app data directory {} must be empty",
                absolute.display()
            ));
        }
    } else {
        fs::create_dir_all(&absolute).map_err(|error| {
            format!(
                "failed to create fixture app data directory {}: {error}",
                absolute.display()
            )
        })?;
    }

    absolute.canonicalize().map_err(|error| {
        format!(
            "failed to resolve fixture app data directory {}: {error}",
            absolute.display()
        )
    })
}

fn write_manifest(path: &Path, manifest: &FixtureManifest) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create fixture manifest directory {}: {error}",
                parent.display()
            )
        })?;
    }
    let json = serde_json::to_string_pretty(manifest)
        .map_err(|error| format!("failed to serialize fixture manifest: {error}"))?;
    fs::write(path, format!("{json}\n")).map_err(|error| {
        format!(
            "failed to write fixture manifest {}: {error}",
            path.display()
        )
    })
}

pub(crate) fn run_fixture(
    options: &FixtureOptions,
    default_app_data_dir: Option<&Path>,
) -> Result<FixtureManifest, String> {
    let repo_path = validate_repo_path(&options.repo_path)?;
    let app_data_dir = prepare_app_data_dir(&options.app_data_dir, default_app_data_dir)?;
    let database_path = app_data_dir.join(crate::database_filename());
    let database = Database::new(database_path.clone())
        .map_err(|error| format!("failed to initialize fixture database: {error}"))?;

    let repo = repo_path
        .to_str()
        .ok_or_else(|| format!("repository path {} is not valid UTF-8", repo_path.display()))?;
    let project = database
        .create_project(PROJECT_NAME, repo)
        .map_err(|error| format!("failed to create fixture project: {error}"))?;
    let task = database
        .create_task_with_options(NewTaskOptions {
            initial_prompt: TASK_PROMPT,
            status: "backlog",
            project_id: Some(&project.id),
            prompt: None,
            permission_mode: None,
            worktree_source: Some("disabled"),
            worktree_branch: None,
            title: Some(TASK_TITLE),
            source_ticket_url: None,
            task_display_title_updates_enabled: None,
            ai_provider: None,
        })
        .map_err(|error| format!("failed to create fixture task: {error}"))?;
    database
        .create_task_workspace_record(
            &task.id,
            &project.id,
            repo,
            repo,
            "project_root",
            None,
            FIXTURE_PROVIDER,
        )
        .map_err(|error| format!("failed to create fixture task workspace: {error}"))?;

    let manifest = FixtureManifest {
        schema_version: 1,
        project_id: project.id,
        task_id: task.id,
        project_name: PROJECT_NAME.to_string(),
        task_title: TASK_TITLE.to_string(),
        repo_path: repo_path.clone(),
        workspace_path: repo_path,
        app_data_dir,
        database_path,
    };
    write_manifest(&options.manifest_path, &manifest)?;
    Ok(manifest)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;
    use std::fs;

    fn valid_args(app_data_dir: &Path, repo_path: &Path, manifest_path: &Path) -> Vec<OsString> {
        [
            OsString::from("desktop-test-fixture"),
            OsString::from("--app-data-dir"),
            app_data_dir.as_os_str().to_os_string(),
            OsString::from("--repo-path"),
            repo_path.as_os_str().to_os_string(),
            OsString::from("--manifest"),
            manifest_path.as_os_str().to_os_string(),
        ]
        .into_iter()
        .collect()
    }

    #[test]
    fn parses_fixture_command_and_rejects_invalid_arguments() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let app_data_dir = temp_dir.path().join("app-data");
        let repo_path = temp_dir.path().join("repo");
        let manifest_path = temp_dir.path().join("fixture.json");

        let parsed = parse_fixture_command(&valid_args(&app_data_dir, &repo_path, &manifest_path))
            .expect("valid fixture arguments")
            .expect("fixture command");
        assert_eq!(parsed.app_data_dir, app_data_dir);
        assert_eq!(parsed.repo_path, repo_path);
        assert_eq!(parsed.manifest_path, manifest_path);

        assert!(parse_fixture_command(&[OsString::from("serve")])
            .expect("non-fixture command")
            .is_none());
        assert!(parse_fixture_command(&[
            OsString::from("desktop-test-fixture"),
            OsString::from("--unknown"),
            OsString::from("value"),
        ])
        .expect_err("unknown argument")
        .contains("unknown argument"));
        assert!(parse_fixture_command(&[
            OsString::from("desktop-test-fixture"),
            OsString::from("--repo-path"),
        ])
        .expect_err("missing argument value")
        .contains("requires a value"));
    }

    #[test]
    fn refuses_default_or_non_empty_app_data_directories() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let repo_path = temp_dir.path().join("repo");
        fs::create_dir_all(repo_path.join(".git")).expect("fixture git directory");
        let default_app_data_dir = temp_dir.path().join("personal-data");
        let options = FixtureOptions {
            app_data_dir: default_app_data_dir.clone(),
            repo_path: repo_path.clone(),
            manifest_path: temp_dir.path().join("default.json"),
        };

        let default_error = run_fixture(&options, Some(&default_app_data_dir))
            .expect_err("default app data must be refused");
        assert!(default_error.contains("normal OpenForge app data"));

        let non_empty_app_data_dir = temp_dir.path().join("non-empty");
        fs::create_dir_all(&non_empty_app_data_dir).expect("non-empty app data directory");
        fs::write(non_empty_app_data_dir.join("keep.txt"), "personal").expect("existing file");
        let options = FixtureOptions {
            app_data_dir: non_empty_app_data_dir,
            repo_path,
            manifest_path: temp_dir.path().join("non-empty.json"),
        };
        let non_empty_error = run_fixture(&options, None).expect_err("non-empty dir refused");
        assert!(non_empty_error.contains("must be empty"));
    }

    #[test]
    fn seeds_migrated_project_task_workspace_and_json_manifest() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let repo_path = temp_dir.path().join("repo");
        fs::create_dir_all(repo_path.join(".git")).expect("fixture git directory");
        let app_data_dir = temp_dir.path().join("app-data");
        let manifest_path = temp_dir.path().join("fixture.json");
        let options = FixtureOptions {
            app_data_dir: app_data_dir.clone(),
            repo_path: repo_path.clone(),
            manifest_path: manifest_path.clone(),
        };

        let manifest = run_fixture(&options, None).expect("seed fixture");
        assert_eq!(manifest.schema_version, 1);
        let canonical_repo = repo_path.canonicalize().expect("canonical repository");
        let canonical_app_data = app_data_dir.canonicalize().expect("canonical app data");
        assert_eq!(manifest.repo_path, canonical_repo);
        assert_eq!(manifest.workspace_path, canonical_repo);
        assert_eq!(manifest.app_data_dir, canonical_app_data);

        let persisted: FixtureManifest = serde_json::from_str(
            &fs::read_to_string(&manifest_path).expect("read fixture manifest"),
        )
        .expect("parse fixture manifest");
        assert_eq!(persisted, manifest);

        let database = crate::db::Database::new(manifest.database_path.clone())
            .expect("reopen migrated fixture database");
        let project = database
            .get_project(&manifest.project_id)
            .expect("read project")
            .expect("seeded project");
        assert_eq!(project.path, canonical_repo.to_string_lossy());
        let task = database
            .get_task(&manifest.task_id)
            .expect("read task")
            .expect("seeded task");
        assert_eq!(
            task.project_id.as_deref(),
            Some(manifest.project_id.as_str())
        );
        let workspace = database
            .get_task_workspace_for_task(&manifest.task_id)
            .expect("read task workspace")
            .expect("seeded task workspace");
        assert_eq!(workspace.workspace_path, canonical_repo.to_string_lossy());
        assert_eq!(workspace.repo_path, canonical_repo.to_string_lossy());
        assert_eq!(workspace.kind, "project_root");
        assert_eq!(workspace.provider_name, "desktop-test");

        let connection = database.connection();
        let connection = connection.lock().expect("database connection");
        let user_version: i64 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("read migration version");
        assert!(user_version > 0);
    }

    #[test]
    fn rejects_a_path_that_is_not_a_git_repository() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let repo_path = temp_dir.path().join("repo");
        fs::create_dir_all(&repo_path).expect("repository directory");
        let options = FixtureOptions {
            app_data_dir: temp_dir.path().join("app-data"),
            repo_path: repo_path.clone(),
            manifest_path: temp_dir.path().join("fixture.json"),
        };

        let error = run_fixture(&options, None).expect_err("invalid repository");
        assert!(error.contains(&repo_path.display().to_string()));
        assert!(error.contains("Git repository"));
    }
}
