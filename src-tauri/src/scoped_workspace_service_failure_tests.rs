use super::{test_support::*, *};
use crate::{db::test_helpers::make_test_db, pty_manager::SessionScope};
use std::{
    fs,
    sync::{atomic::AtomicUsize, Arc, Mutex},
};

#[tokio::test]
async fn byte_limit_evicts_an_inactive_checkout() {
    let (database, temp_dir) = make_test_db("scoped_workspace_byte_eviction");
    let repo = repository(temp_dir.path());
    let project = database
        .create_project("Repository", &repo.to_string_lossy())
        .expect("create project");
    let database = Arc::new(Mutex::new(database));
    let service = ScopedWorkspaceService::new(
        Arc::clone(&database),
        temp_dir.path().join("scoped-workspaces"),
    );
    let first = service
        .acquire(AcquireScopedWorkspace {
            owner_plugin_id: "com.example.review",
            scope: SessionScope {
                namespace: "github-pr",
                target_key: "owner/repo#1",
                revision: "head",
            },
            project_id: &project.id,
            checkout_revision: "HEAD",
        })
        .await
        .expect("create first checkout");
    let bounded = service.with_limits(MAX_SCOPED_WORKSPACES, first.measured_bytes);
    let second = bounded
        .acquire(AcquireScopedWorkspace {
            owner_plugin_id: "com.example.review",
            scope: SessionScope {
                namespace: "github-pr",
                target_key: "owner/repo#2",
                revision: "head",
            },
            project_id: &project.id,
            checkout_revision: "HEAD",
        })
        .await
        .expect("create second checkout within byte limit");

    assert!(!first.path.exists());
    assert!(second.path.is_dir());
    assert!(second.measured_bytes <= first.measured_bytes);
}

#[tokio::test]
async fn oversized_checkout_is_removed_without_a_record() {
    let (database, temp_dir) = make_test_db("scoped_workspace_oversized");
    let repo = repository(temp_dir.path());
    let project = database
        .create_project("Repository", &repo.to_string_lossy())
        .expect("create project");
    let database = Arc::new(Mutex::new(database));
    let root = temp_dir.path().join("scoped-workspaces");
    let service = ScopedWorkspaceService::new(Arc::clone(&database), root.clone())
        .with_limits(MAX_SCOPED_WORKSPACES, 1);
    let scope = SessionScope {
        namespace: "github-pr",
        target_key: "owner/repo#1",
        revision: "head",
    };

    let error = service
        .acquire(AcquireScopedWorkspace {
            owner_plugin_id: "com.example.review",
            scope,
            project_id: &project.id,
            checkout_revision: "HEAD",
        })
        .await
        .expect_err("checkout must exceed one byte");

    assert!(matches!(
        error,
        ScopedWorkspaceError::WorkspaceTooLarge { .. }
    ));
    assert!(db::acquire_db(&database)
        .scoped_workspace(scope.namespace, scope.target_key, scope.revision)
        .expect("read rejected scope")
        .is_none());
    assert_directory_empty_or_missing(&root.join("staging"));
    assert_directory_empty_or_missing(&root.join("ready"));
}

#[tokio::test]
async fn failed_fetch_leaves_no_workspace_or_record() {
    let (database, temp_dir) = make_test_db("scoped_workspace_fetch_failure");
    let repo = repository(temp_dir.path());
    let project = database
        .create_project("Repository", &repo.to_string_lossy())
        .expect("create project");
    let database = Arc::new(Mutex::new(database));
    let root = temp_dir.path().join("scoped-workspaces");
    let service = ScopedWorkspaceService::new(Arc::clone(&database), root.clone());

    let error = service
        .acquire(AcquireScopedWorkspace {
            owner_plugin_id: "com.example.review",
            scope: SessionScope {
                namespace: "github-pr",
                target_key: "owner/repo#404",
                revision: "missing",
            },
            project_id: &project.id,
            checkout_revision: "refs/heads/does-not-exist",
        })
        .await
        .expect_err("missing revision must fail");

    assert!(matches!(error, ScopedWorkspaceError::FetchFailed { .. }));
    assert!(db::acquire_db(&database)
        .scoped_workspaces_in_states(&["reserved", "ready", "cleanup_pending"])
        .expect("read retained workspaces")
        .is_empty());
    assert!(!root.exists());
}

#[tokio::test]
async fn unresolved_revision_after_successful_fetch_leaves_nothing_behind() {
    let (database, temp_dir) = make_test_db("scoped_workspace_resolution_failure");
    let repo = repository(temp_dir.path());
    add_origin(&repo, temp_dir.path());
    let project = database
        .create_project("Repository", &repo.to_string_lossy())
        .expect("create project");
    let database = Arc::new(Mutex::new(database));
    let root = temp_dir.path().join("scoped-workspaces");
    let service = ScopedWorkspaceService::new(Arc::clone(&database), root.clone());

    let error = service
        .acquire(AcquireScopedWorkspace {
            owner_plugin_id: "com.example.review",
            scope: SessionScope {
                namespace: "github-pr",
                target_key: "owner/repo#missing",
                revision: "missing",
            },
            project_id: &project.id,
            checkout_revision: "refs/heads/does-not-exist",
        })
        .await
        .expect_err("revision must remain unresolved after fetch");

    assert!(matches!(
        error,
        ScopedWorkspaceError::RevisionNotFound { .. }
    ));
    assert!(!root.exists());
}

#[tokio::test]
async fn non_git_project_reports_the_repository_problem_without_artifacts() {
    let (database, temp_dir) = make_test_db("scoped_workspace_non_git_project");
    let non_repo = temp_dir.path().join("ordinary-directory");
    fs::create_dir(&non_repo).expect("create ordinary directory");
    let project = database
        .create_project("Not Git", &non_repo.to_string_lossy())
        .expect("create project");
    let database = Arc::new(Mutex::new(database));
    let root = temp_dir.path().join("scoped-workspaces");
    let service = ScopedWorkspaceService::new(Arc::clone(&database), root.clone());

    let error = service
        .acquire(AcquireScopedWorkspace {
            owner_plugin_id: "com.example.review",
            scope: SessionScope {
                namespace: "github-pr",
                target_key: "owner/repo#1",
                revision: "head",
            },
            project_id: &project.id,
            checkout_revision: "HEAD",
        })
        .await
        .expect_err("ordinary directory must be rejected");

    assert!(error.to_string().contains("not a Git repository"));
    assert!(!root.exists());
}

#[tokio::test]
async fn failed_checkout_rolls_back_its_reservation() {
    let (database, temp_dir) = make_test_db("scoped_workspace_checkout_failure");
    let repo = repository(temp_dir.path());
    let project = database
        .create_project("Repository", &repo.to_string_lossy())
        .expect("create project");
    let database = Arc::new(Mutex::new(database));
    let blocked_root = temp_dir.path().join("not-a-directory");
    fs::write(&blocked_root, "file blocks workspace root").expect("write blocking file");
    let service = ScopedWorkspaceService::new(Arc::clone(&database), blocked_root);

    let error = service
        .acquire(AcquireScopedWorkspace {
            owner_plugin_id: "com.example.review",
            scope: SessionScope {
                namespace: "github-pr",
                target_key: "owner/repo#1",
                revision: "head",
            },
            project_id: &project.id,
            checkout_revision: "HEAD",
        })
        .await
        .expect_err("checkout path creation must fail");

    assert!(matches!(error, ScopedWorkspaceError::Git(_)));
    assert!(db::acquire_db(&database)
        .scoped_workspaces_in_states(&["reserved", "ready", "cleanup_pending"])
        .expect("read retained workspaces")
        .is_empty());
}

#[tokio::test]
async fn failed_measurement_removes_the_checkout_and_reservation() {
    let (database, temp_dir) = make_test_db("scoped_workspace_measurement_failure");
    let repo = repository(temp_dir.path());
    let project = database
        .create_project("Repository", &repo.to_string_lossy())
        .expect("create project");
    let database = Arc::new(Mutex::new(database));
    let root = temp_dir.path().join("scoped-workspaces");
    let service = ScopedWorkspaceService::new(Arc::clone(&database), root.clone())
        .with_measurer(Arc::new(FailingMeasurer));

    let error = service
        .acquire(AcquireScopedWorkspace {
            owner_plugin_id: "com.example.review",
            scope: SessionScope {
                namespace: "github-pr",
                target_key: "owner/repo#1",
                revision: "head",
            },
            project_id: &project.id,
            checkout_revision: "HEAD",
        })
        .await
        .expect_err("measurement must fail");

    assert!(matches!(error, ScopedWorkspaceError::Measurement { .. }));
    assert_directory_empty_or_missing(&root.join("staging"));
    assert!(db::acquire_db(&database)
        .scoped_workspaces_in_states(&["reserved", "ready", "cleanup_pending"])
        .expect("read retained workspaces")
        .is_empty());
}

#[tokio::test]
async fn failed_publication_removes_the_checkout_and_reservation() {
    let (database, temp_dir) = make_test_db("scoped_workspace_publication_failure");
    let repo = repository(temp_dir.path());
    let project = database
        .create_project("Repository", &repo.to_string_lossy())
        .expect("create project");
    let database = Arc::new(Mutex::new(database));
    let root = temp_dir.path().join("scoped-workspaces");
    let service = ScopedWorkspaceService::new(Arc::clone(&database), root.clone())
        .with_publisher(Arc::new(FailingPublisher));

    let error = service
        .acquire(AcquireScopedWorkspace {
            owner_plugin_id: "com.example.review",
            scope: SessionScope {
                namespace: "github-pr",
                target_key: "owner/repo#1",
                revision: "head",
            },
            project_id: &project.id,
            checkout_revision: "HEAD",
        })
        .await
        .expect_err("publication must fail");

    assert!(matches!(error, ScopedWorkspaceError::Git(_)));
    assert_directory_empty_or_missing(&root.join("staging"));
    assert_directory_empty_or_missing(&root.join("ready"));
    assert!(db::acquire_db(&database)
        .scoped_workspaces_in_states(&["reserved", "ready", "cleanup_pending"])
        .expect("read retained workspaces")
        .is_empty());
}

#[tokio::test]
async fn rollback_failure_is_reported_and_remains_retryable() {
    let (database, temp_dir) = make_test_db("scoped_workspace_rollback_failure");
    let repo = repository(temp_dir.path());
    let project = database
        .create_project("Repository", &repo.to_string_lossy())
        .expect("create project");
    let database = Arc::new(Mutex::new(database));
    let service = ScopedWorkspaceService::new(
        Arc::clone(&database),
        temp_dir.path().join("scoped-workspaces"),
    )
    .with_measurer(Arc::new(FailingMeasurer))
    .with_remover(Arc::new(FailOnceRemover(AtomicUsize::new(0))));

    let error = service
        .acquire(AcquireScopedWorkspace {
            owner_plugin_id: "com.example.review",
            scope: SessionScope {
                namespace: "github-pr",
                target_key: "owner/repo#1",
                revision: "head",
            },
            project_id: &project.id,
            checkout_revision: "HEAD",
        })
        .await
        .expect_err("measurement and rollback must fail");

    assert!(matches!(error, ScopedWorkspaceError::CleanupDeferred(_)));
    let pending = db::acquire_db(&database)
        .scoped_workspaces_in_states(&["cleanup_pending"])
        .expect("read pending rollback");
    assert_eq!(pending.len(), 1);
    assert!(Path::new(&pending[0].workspace_path).exists());
    let report = service
        .retry_pending_cleanup()
        .await
        .expect("retry pending rollback");
    assert_eq!(report.removed, 1);
}

#[tokio::test]
async fn failed_cleanup_remains_pending_and_is_retried() {
    let (database, temp_dir) = make_test_db("scoped_workspace_cleanup_retry");
    let repo = repository(temp_dir.path());
    let project = database
        .create_project("Repository", &repo.to_string_lossy())
        .expect("create project");
    let database = Arc::new(Mutex::new(database));
    let service = ScopedWorkspaceService::new(
        Arc::clone(&database),
        temp_dir.path().join("scoped-workspaces"),
    )
    .with_remover(Arc::new(FailOnceRemover(AtomicUsize::new(0))));
    let scope = SessionScope {
        namespace: "github-pr",
        target_key: "owner/repo#1",
        revision: "head",
    };
    let workspace = service
        .acquire(AcquireScopedWorkspace {
            owner_plugin_id: "com.example.review",
            scope,
            project_id: &project.id,
            checkout_revision: "HEAD",
        })
        .await
        .expect("create checkout");

    let error = service
        .release("com.example.review", scope)
        .await
        .expect_err("first cleanup is simulated to fail");
    assert!(matches!(error, ScopedWorkspaceError::CleanupDeferred(_)));
    let pending = db::acquire_db(&database)
        .scoped_workspace(scope.namespace, scope.target_key, scope.revision)
        .expect("read pending scope")
        .expect("pending row remains");
    assert_eq!(pending.cleanup_state, "cleanup_pending");
    assert!(workspace.path.exists());

    let report = service
        .retry_pending_cleanup()
        .await
        .expect("retry pending cleanup");
    assert_eq!(report.removed, 1);
    assert_eq!(report.deferred, 0);
    assert!(!workspace.path.exists());
}

#[tokio::test]
async fn pending_cleanup_counts_toward_capacity() {
    let (database, temp_dir) = make_test_db("scoped_workspace_pending_capacity");
    let repo = repository(temp_dir.path());
    let project = database
        .create_project("Repository", &repo.to_string_lossy())
        .expect("create project");
    let database = Arc::new(Mutex::new(database));
    let service = ScopedWorkspaceService::new(
        Arc::clone(&database),
        temp_dir.path().join("scoped-workspaces"),
    )
    .with_limits(1, MAX_SCOPED_WORKSPACE_BYTES);
    let first = service
        .acquire(AcquireScopedWorkspace {
            owner_plugin_id: "com.example.review",
            scope: SessionScope {
                namespace: "github-pr",
                target_key: "owner/repo#1",
                revision: "head",
            },
            project_id: &project.id,
            checkout_revision: "HEAD",
        })
        .await
        .expect("create first checkout");
    db::acquire_db(&database)
        .mark_scoped_workspace_cleanup_pending(&first.id)
        .expect("mark retained checkout pending");

    let error = service
        .acquire(AcquireScopedWorkspace {
            owner_plugin_id: "com.example.review",
            scope: SessionScope {
                namespace: "github-pr",
                target_key: "owner/repo#2",
                revision: "head",
            },
            project_id: &project.id,
            checkout_revision: "HEAD",
        })
        .await
        .expect_err("pending cleanup must retain its capacity");

    assert!(matches!(
        error,
        ScopedWorkspaceError::CapacityExhausted { .. }
    ));
    assert!(first.path.exists());
}

fn assert_directory_empty_or_missing(path: &Path) {
    if !path.exists() {
        return;
    }
    assert_eq!(
        fs::read_dir(path)
            .expect("read workspace directory")
            .count(),
        0,
        "{} must be empty",
        path.display()
    );
}

#[cfg(unix)]
#[test]
fn logical_measurement_does_not_follow_symlinks() {
    let temp_dir = tempfile::tempdir().expect("create measurement directory");
    let workspace = temp_dir.path().join("workspace");
    fs::create_dir(&workspace).expect("create workspace");
    fs::write(workspace.join("small"), "1234").expect("write regular file");
    let external = temp_dir.path().join("external");
    fs::write(&external, vec![0_u8; 1024 * 1024]).expect("write external file");
    std::os::unix::fs::symlink(&external, workspace.join("external-link")).expect("create symlink");

    assert_eq!(measure_workspace(&workspace).expect("measure workspace"), 4);
}
