use super::{test_support::*, *};
use crate::{
    db::test_helpers::make_test_db,
    plugin_platform::{PluginLifecycleLocks, PluginPlatform},
    pty_manager::SessionScope,
};
use std::{
    fs,
    sync::{Arc, Mutex},
};

#[tokio::test]
async fn later_turn_reuses_the_same_checkout() {
    let (database, temp_dir) = make_test_db("scoped_workspace_reuse");
    let repo = repository(temp_dir.path());
    let project = database
        .create_project("Repository", &repo.to_string_lossy())
        .expect("create project");
    let database = Arc::new(Mutex::new(database));
    let service = ScopedWorkspaceService::new(
        Arc::clone(&database),
        temp_dir.path().join("scoped-workspaces"),
    );
    let scope = SessionScope {
        namespace: "github-pr",
        target_key: "owner/repo#42",
        revision: "head-a",
    };
    let request = AcquireScopedWorkspace {
        owner_plugin_id: "com.example.review",
        scope,
        project_id: &project.id,
        checkout_revision: "HEAD",
    };

    let first = service.acquire(request).await.expect("create checkout");
    fs::write(first.path.join("turn-marker"), "kept").expect("write marker");
    let second = service.acquire(request).await.expect("reuse checkout");

    assert!(!first.reused);
    assert!(second.reused);
    assert_eq!(second.path, first.path);
    assert_eq!(second.resolved_commit, first.resolved_commit);
    assert_eq!(
        fs::read_to_string(second.path.join("turn-marker")).expect("marker survives"),
        "kept"
    );
}

#[tokio::test]
async fn concurrent_requests_publish_one_checkout() {
    let (database, temp_dir) = make_test_db("scoped_workspace_concurrent_reuse");
    let repo = repository(temp_dir.path());
    let project = database
        .create_project("Repository", &repo.to_string_lossy())
        .expect("create project");
    let database = Arc::new(Mutex::new(database));
    let service = ScopedWorkspaceService::new(
        Arc::clone(&database),
        temp_dir.path().join("scoped-workspaces"),
    );
    let request = AcquireScopedWorkspace {
        owner_plugin_id: "com.example.review",
        scope: SessionScope {
            namespace: "github-pr",
            target_key: "owner/repo#42",
            revision: "head-a",
        },
        project_id: &project.id,
        checkout_revision: "HEAD",
    };

    let (first, second) = tokio::join!(service.acquire(request), service.acquire(request));
    let first = first.expect("first concurrent request");
    let second = second.expect("second concurrent request");

    assert_eq!(first.path, second.path);
    assert_ne!(first.reused, second.reused);
    assert_eq!(
        db::acquire_db(&database)
            .scoped_workspaces_for_logical_scope("github-pr", "owner/repo#42")
            .expect("read concurrent scope")
            .len(),
        1
    );
}

#[tokio::test]
async fn another_plugin_cannot_claim_an_existing_scope() {
    let (database, temp_dir) = make_test_db("scoped_workspace_owner_conflict");
    let repo = repository(temp_dir.path());
    let project = database
        .create_project("Repository", &repo.to_string_lossy())
        .expect("create project");
    let database = Arc::new(Mutex::new(database));
    let service = ScopedWorkspaceService::new(
        Arc::clone(&database),
        temp_dir.path().join("scoped-workspaces"),
    );
    let scope = SessionScope {
        namespace: "github-pr",
        target_key: "owner/repo#42",
        revision: "head-a",
    };
    let original = service
        .acquire(AcquireScopedWorkspace {
            owner_plugin_id: "com.example.review",
            scope,
            project_id: &project.id,
            checkout_revision: "HEAD",
        })
        .await
        .expect("create owned checkout");

    let error = service
        .acquire(AcquireScopedWorkspace {
            owner_plugin_id: "com.example.other",
            scope,
            project_id: &project.id,
            checkout_revision: "HEAD",
        })
        .await
        .expect_err("another plugin cannot claim the scope");

    assert!(matches!(
        error,
        ScopedWorkspaceError::OwnershipConflict { .. }
    ));
    assert!(original.path.exists());
}

#[tokio::test]
async fn a_new_scope_revision_replaces_the_old_checkout() {
    let (database, temp_dir) = make_test_db("scoped_workspace_rotation");
    let repo = repository(temp_dir.path());
    let project = database
        .create_project("Repository", &repo.to_string_lossy())
        .expect("create project");
    let database = Arc::new(Mutex::new(database));
    let service = ScopedWorkspaceService::new(
        Arc::clone(&database),
        temp_dir.path().join("scoped-workspaces"),
    );
    let first_scope = SessionScope {
        namespace: "github-pr",
        target_key: "owner/repo#42",
        revision: "head-a",
    };
    let first = service
        .acquire(AcquireScopedWorkspace {
            owner_plugin_id: "com.example.review",
            scope: first_scope,
            project_id: &project.id,
            checkout_revision: "HEAD",
        })
        .await
        .expect("create first checkout");

    fs::write(repo.join("README.md"), "second revision\n").expect("write next revision");
    run_git(&repo, &["add", "README.md"]);
    run_git(&repo, &["commit", "-m", "second"]);
    let second_commit = run_git(&repo, &["rev-parse", "HEAD"]);
    let second = service
        .acquire(AcquireScopedWorkspace {
            owner_plugin_id: "com.example.review",
            scope: SessionScope {
                namespace: "github-pr",
                target_key: "owner/repo#42",
                revision: "head-b",
            },
            project_id: &project.id,
            checkout_revision: &second_commit,
        })
        .await
        .expect("rotate checkout");

    assert!(!first.path.exists());
    assert!(second.path.is_dir());
    assert_ne!(second.path, first.path);
    assert_eq!(second.resolved_commit, second_commit);
    let logical_rows = db::acquire_db(&database)
        .scoped_workspaces_for_logical_scope("github-pr", "owner/repo#42")
        .expect("read logical scope after rotation");
    assert_eq!(logical_rows.len(), 1);
    assert_eq!(logical_rows[0].revision, "head-b");
}

#[tokio::test]
async fn releasing_a_scope_removes_its_checkout_and_record() {
    let (database, temp_dir) = make_test_db("scoped_workspace_release");
    let repo = repository(temp_dir.path());
    let project = database
        .create_project("Repository", &repo.to_string_lossy())
        .expect("create project");
    let database = Arc::new(Mutex::new(database));
    let service = ScopedWorkspaceService::new(
        Arc::clone(&database),
        temp_dir.path().join("scoped-workspaces"),
    );
    let scope = SessionScope {
        namespace: "github-pr",
        target_key: "owner/repo#42",
        revision: "head-a",
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

    service
        .release("com.example.review", scope)
        .await
        .expect("release checkout");

    assert!(!workspace.path.exists());
    assert!(!run_git(&repo, &["worktree", "list", "--porcelain"])
        .contains(workspace.path.to_str().expect("UTF-8 test path")));
    assert!(db::acquire_db(&database)
        .scoped_workspace(scope.namespace, scope.target_key, scope.revision)
        .expect("read released scope")
        .is_none());
}

#[tokio::test]
async fn count_limit_evicts_the_least_recently_used_inactive_checkout() {
    let (database, temp_dir) = make_test_db("scoped_workspace_count_eviction");
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
    let first_scope = SessionScope {
        namespace: "github-pr",
        target_key: "owner/repo#1",
        revision: "head",
    };
    let first = service
        .acquire(AcquireScopedWorkspace {
            owner_plugin_id: "com.example.review",
            scope: first_scope,
            project_id: &project.id,
            checkout_revision: "HEAD",
        })
        .await
        .expect("create first checkout");
    let second = service
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
        .expect("create second checkout");

    assert!(!first.path.exists());
    assert!(second.path.is_dir());
    assert!(db::acquire_db(&database)
        .scoped_workspace(
            first_scope.namespace,
            first_scope.target_key,
            first_scope.revision
        )
        .expect("read evicted scope")
        .is_none());
}

#[tokio::test]
async fn evicting_a_checkout_publishes_a_change_for_its_session_scope() {
    let (database, temp_dir) = make_test_db("scoped_workspace_eviction_change");
    let repo = repository(temp_dir.path());
    let project = database
        .create_project("Repository", &repo.to_string_lossy())
        .expect("create project");
    let (events, mut received) = tokio::sync::broadcast::channel(16);
    let service = ScopedWorkspaceService::new(
        Arc::new(Mutex::new(database)),
        temp_dir.path().join("scoped-workspaces"),
    )
    .with_limits(1, MAX_SCOPED_WORKSPACE_BYTES)
    .with_events(RuntimeEventPublisher::new(None, Some(events)));
    for target_key in ["owner/repo#1", "owner/repo#2"] {
        service
            .acquire(AcquireScopedWorkspace {
                owner_plugin_id: "com.example.review",
                scope: SessionScope {
                    namespace: "github-pr",
                    target_key,
                    revision: "head",
                },
                project_id: &project.id,
                checkout_revision: "HEAD",
            })
            .await
            .expect("create checkout");
    }

    let change = received.try_recv().expect("eviction change");
    assert_eq!(change.event_name, "scoped-agent-session-changed");
    assert_eq!(
        change.payload,
        serde_json::json!({
            "pluginId": "com.example.review",
            "namespace": "github-pr",
            "targetKey": "owner/repo#1",
            "revision": "head",
        })
    );
    assert!(received.try_recv().is_err());
}

#[tokio::test]
async fn reuse_refreshes_lru_recency_before_eviction() {
    let (database, temp_dir) = make_test_db("scoped_workspace_lru_touch");
    let repo = repository(temp_dir.path());
    let project = database
        .create_project("Repository", &repo.to_string_lossy())
        .expect("create project");
    let database = Arc::new(Mutex::new(database));
    let service = ScopedWorkspaceService::new(
        Arc::clone(&database),
        temp_dir.path().join("scoped-workspaces"),
    )
    .with_limits(2, MAX_SCOPED_WORKSPACE_BYTES);
    let request = |target_key| AcquireScopedWorkspace {
        owner_plugin_id: "com.example.review",
        scope: SessionScope {
            namespace: "github-pr",
            target_key,
            revision: "head",
        },
        project_id: &project.id,
        checkout_revision: "HEAD",
    };
    let first = service
        .acquire(request("owner/repo#1"))
        .await
        .expect("first");
    let second = service
        .acquire(request("owner/repo#2"))
        .await
        .expect("second");
    service
        .acquire(request("owner/repo#1"))
        .await
        .expect("touch first");
    let third = service
        .acquire(request("owner/repo#3"))
        .await
        .expect("third");

    assert!(first.path.exists());
    assert!(!second.path.exists());
    assert!(third.path.exists());
}

#[tokio::test]
async fn protected_workspace_blocks_eviction_and_rejects_the_candidate() {
    let (database, temp_dir) = make_test_db("scoped_workspace_protected_capacity");
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
    let protected_scope = SessionScope {
        namespace: "github-pr",
        target_key: "owner/repo#1",
        revision: "head",
    };
    let protected = service
        .acquire(AcquireScopedWorkspace {
            owner_plugin_id: "com.example.review",
            scope: protected_scope,
            project_id: &project.id,
            checkout_revision: "HEAD",
        })
        .await
        .expect("create protected checkout");
    let _lease = service
        .protect(protected_scope)
        .await
        .expect("protect checkout");

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
        .expect_err("protected capacity must reject a new checkout");

    assert!(matches!(
        error,
        ScopedWorkspaceError::CapacityExhausted { .. }
    ));
    assert!(protected.path.is_dir());
    assert_eq!(
        db::acquire_db(&database)
            .scoped_workspaces_in_states(&["ready", "cleanup_pending"])
            .expect("read retained workspaces")
            .len(),
        1
    );
}

#[tokio::test]
async fn protection_and_eviction_are_serialized() {
    let (database, temp_dir) = make_test_db("scoped_workspace_protection_serialization");
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
    let original_scope = SessionScope {
        namespace: "github-pr",
        target_key: "owner/repo#1",
        revision: "head",
    };
    service
        .acquire(AcquireScopedWorkspace {
            owner_plugin_id: "com.example.review",
            scope: original_scope,
            project_id: &project.id,
            checkout_revision: "HEAD",
        })
        .await
        .expect("create original checkout");
    let remover = Arc::new(BlockingRemover {
        entered: tokio::sync::Notify::new(),
        proceed: tokio::sync::Notify::new(),
    });
    let service = service.with_remover(remover.clone());
    let eviction_service = service.clone();
    let project_id = project.id.clone();
    let eviction = tokio::spawn(async move {
        eviction_service
            .acquire(AcquireScopedWorkspace {
                owner_plugin_id: "com.example.review",
                scope: SessionScope {
                    namespace: "github-pr",
                    target_key: "owner/repo#2",
                    revision: "head",
                },
                project_id: &project_id,
                checkout_revision: "HEAD",
            })
            .await
    });
    remover.entered.notified().await;
    let protection_service = service.clone();
    let mut protection =
        tokio::spawn(async move { protection_service.protect(original_scope).await });

    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(50), &mut protection)
            .await
            .is_err()
    );
    remover.proceed.notify_one();
    eviction
        .await
        .expect("join eviction")
        .expect("complete eviction");
    let _lease = protection
        .await
        .expect("join protection")
        .expect("protect after eviction completes");
}

#[tokio::test]
async fn capacity_returns_database_failure_without_retrying_the_same_candidate() {
    let (database, temp_dir) = make_test_db("scoped_workspace_capacity_database_failure");
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
    let original = service
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
        .expect("create original checkout");
    {
        let database = db::acquire_db(&database);
        let connection = database.connection();
        connection
            .lock()
            .expect("lock database")
            .execute_batch(
                "CREATE TRIGGER reject_scoped_cleanup
                 BEFORE UPDATE OF cleanup_state ON scoped_workspaces
                 WHEN NEW.cleanup_state = 'cleanup_pending'
                 BEGIN SELECT RAISE(FAIL, 'simulated cleanup state failure'); END;",
            )
            .expect("create failure trigger");
    }

    let result = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        service.acquire(AcquireScopedWorkspace {
            owner_plugin_id: "com.example.review",
            scope: SessionScope {
                namespace: "github-pr",
                target_key: "owner/repo#2",
                revision: "head",
            },
            project_id: &project.id,
            checkout_revision: "HEAD",
        }),
    )
    .await
    .expect("capacity enforcement must return instead of looping")
    .expect_err("cleanup state failure must reject acquisition");

    assert!(matches!(result, ScopedWorkspaceError::Database(_)));
    assert!(original.path.exists());
}

#[tokio::test]
async fn evicted_workspace_is_recreated_at_its_stored_commit() {
    let (database, temp_dir) = make_test_db("scoped_workspace_pinned_recreation");
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
    let original_scope = SessionScope {
        namespace: "github-pr",
        target_key: "owner/repo#1",
        revision: "head",
    };
    let original_request = AcquireScopedWorkspace {
        owner_plugin_id: "com.example.review",
        scope: original_scope,
        project_id: &project.id,
        checkout_revision: "HEAD",
    };
    let original = service
        .acquire(original_request)
        .await
        .expect("create original checkout");
    fs::write(repo.join("README.md"), "second revision\n").expect("write next revision");
    run_git(&repo, &["add", "README.md"]);
    run_git(&repo, &["commit", "-m", "second"]);
    service
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
        .expect("evict original checkout");
    assert!(!original.path.exists());

    let recreated = service
        .recreate_at_commit(original_request, &original.resolved_commit)
        .await
        .expect("recreate original checkout at pinned commit");

    assert_eq!(recreated.resolved_commit, original.resolved_commit);
    assert_eq!(
        fs::read_to_string(recreated.path.join("README.md")).expect("read recreated content"),
        "first revision\n"
    );
}

#[tokio::test]
async fn owner_release_can_be_scoped_to_one_project() {
    let (database, temp_dir) = make_test_db("scoped_workspace_owner_release");
    let repo = repository(temp_dir.path());
    let second_repo_root = temp_dir.path().join("second");
    fs::create_dir_all(&second_repo_root).expect("create second repository root");
    let second_repo = repository(&second_repo_root);
    let first_project = database
        .create_project("First", &repo.to_string_lossy())
        .expect("create first project");
    let second_project = database
        .create_project("Second", &second_repo.to_string_lossy())
        .expect("create second project");
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
                target_key: "owner/first#1",
                revision: "head",
            },
            project_id: &first_project.id,
            checkout_revision: "HEAD",
        })
        .await
        .expect("create first checkout");
    let second = service
        .acquire(AcquireScopedWorkspace {
            owner_plugin_id: "com.example.review",
            scope: SessionScope {
                namespace: "github-pr",
                target_key: "owner/second#1",
                revision: "head",
            },
            project_id: &second_project.id,
            checkout_revision: "HEAD",
        })
        .await
        .expect("create second checkout");

    let project_report = service
        .release_owner("com.example.review", Some(&first_project.id))
        .await
        .expect("release owner in one project");
    assert_eq!(project_report.removed, 1);
    assert!(!first.path.exists());
    assert!(second.path.exists());

    let plugin_report = service
        .release_owner("com.example.review", None)
        .await
        .expect("release owner across projects");
    assert_eq!(plugin_report.removed, 1);
    assert!(!second.path.exists());
}

#[tokio::test]
async fn captured_cleanup_does_not_remove_a_workspace_protected_by_a_new_session() {
    let (database, temp_dir) = make_test_db("scoped_workspace_captured_generation");
    let repo = repository(temp_dir.path());
    let project = database
        .create_project("Repository", &repo.to_string_lossy())
        .expect("create project");
    let database = Arc::new(Mutex::new(database));
    let service = ScopedWorkspaceService::new(
        Arc::clone(&database),
        temp_dir.path().join("scoped-workspaces"),
    );
    let scope = SessionScope {
        namespace: "github-pr",
        target_key: "owner/repo#protected",
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
    let captured = database
        .lock()
        .unwrap()
        .scoped_workspaces_for_owner("com.example.review", None)
        .expect("capture owned workspaces");
    let _replacement_lease = service.protect(scope).await.expect("protect replacement");

    let report = service
        .release_captured("com.example.review", captured)
        .await
        .expect("run captured cleanup");

    assert_eq!(report.removed, 0);
    assert!(workspace.path.exists());
}

#[tokio::test]
async fn plugin_uninstall_schedules_owner_cleanup() {
    let (database, temp_dir) = make_test_db("scoped_workspace_plugin_uninstall");
    let repo = repository(temp_dir.path());
    let project = database
        .create_project("Repository", &repo.to_string_lossy())
        .expect("create project");
    let database = Arc::new(Mutex::new(database));
    let service = ScopedWorkspaceService::new(
        Arc::clone(&database),
        temp_dir.path().join("scoped-workspaces"),
    );
    let workspace = service
        .acquire(AcquireScopedWorkspace {
            owner_plugin_id: "com.example.uninstalled",
            scope: SessionScope {
                namespace: "github-pr",
                target_key: "owner/repo#1",
                revision: "head",
            },
            project_id: &project.id,
            checkout_revision: "HEAD",
        })
        .await
        .expect("create plugin-owned checkout");
    let lifecycle_locks = PluginLifecycleLocks::new();
    let platform = PluginPlatform::new(
        database.as_ref(),
        None,
        None,
        &lifecycle_locks,
        Some(service),
    );

    platform
        .uninstall_plugin("com.example.uninstalled")
        .expect("uninstall missing plugin idempotently");

    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        while workspace.path.exists() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("scheduled owner cleanup completes");
}

#[tokio::test]
async fn project_plugin_disable_schedules_project_owner_cleanup() {
    let (database, temp_dir) = make_test_db("scoped_workspace_plugin_disable");
    let repo = repository(temp_dir.path());
    let project = database
        .create_project("Repository", &repo.to_string_lossy())
        .expect("create project");
    database
        .install_plugin(&project_plugin("com.example.review"))
        .expect("install project plugin");
    let database = Arc::new(Mutex::new(database));
    let service = ScopedWorkspaceService::new(
        Arc::clone(&database),
        temp_dir.path().join("scoped-workspaces"),
    );
    let workspace = service
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
        .expect("create plugin-owned checkout");
    let lifecycle_locks = PluginLifecycleLocks::new();
    let platform = PluginPlatform::new(
        database.as_ref(),
        None,
        None,
        &lifecycle_locks,
        Some(service),
    );

    platform
        .set_plugin_enabled(&project.id, "com.example.review", false)
        .expect("disable project plugin");

    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        while workspace.path.exists() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("scheduled project cleanup completes");
}

#[tokio::test]
async fn startup_reconciliation_removes_orphaned_and_untracked_paths() {
    let (database, temp_dir) = make_test_db("scoped_workspace_startup_reconciliation");
    let repo = repository(temp_dir.path());
    let project = database
        .create_project("Repository", &repo.to_string_lossy())
        .expect("create project");
    let database = Arc::new(Mutex::new(database));
    let root = temp_dir.path().join("scoped-workspaces");
    let service = ScopedWorkspaceService::new(Arc::clone(&database), root.clone());
    let orphan = service
        .acquire(AcquireScopedWorkspace {
            owner_plugin_id: "com.example.uninstalled",
            scope: SessionScope {
                namespace: "github-pr",
                target_key: "owner/repo#1",
                revision: "head",
            },
            project_id: &project.id,
            checkout_revision: "HEAD",
        })
        .await
        .expect("create orphaned checkout");
    let untracked = root.join("staging").join("interrupted-checkout");
    fs::create_dir_all(&untracked).expect("create untracked staging path");
    fs::write(untracked.join("partial"), "partial").expect("write partial checkout");
    let untracked_registered = root.join("ready").join("published-before-database-write");
    fs::create_dir_all(untracked_registered.parent().expect("ready parent"))
        .expect("create ready directory");
    run_git(
        &repo,
        &[
            "worktree",
            "add",
            "--detach",
            untracked_registered.to_str().expect("UTF-8 test path"),
            "HEAD",
        ],
    );

    let report = service
        .reconcile_startup()
        .await
        .expect("reconcile startup");

    assert_eq!(report.removed, 1);
    assert_eq!(report.deferred, 0);
    assert!(!orphan.path.exists());
    assert!(!untracked.exists());
    assert!(!untracked_registered.exists());
    assert!(!run_git(&repo, &["worktree", "list", "--porcelain"])
        .contains(untracked_registered.to_str().expect("UTF-8 test path")));
    assert!(db::acquire_db(&database)
        .scoped_workspaces_in_states(&["reserved", "ready", "cleanup_pending"])
        .expect("read reconciled workspaces")
        .is_empty());
}

#[tokio::test]
async fn startup_reconciliation_removes_a_disabled_plugins_checkout() {
    let (database, temp_dir) = make_test_db("scoped_workspace_disabled_startup_cleanup");
    let repo = repository(temp_dir.path());
    let project = database
        .create_project("Repository", &repo.to_string_lossy())
        .expect("create project");
    database
        .install_plugin(&project_plugin("com.example.review"))
        .expect("install project plugin");
    database
        .set_plugin_enabled(&project.id, "com.example.review", true)
        .expect("enable project plugin");
    let database = Arc::new(Mutex::new(database));
    let root = temp_dir.path().join("scoped-workspaces");
    let service = ScopedWorkspaceService::new(Arc::clone(&database), root);
    let workspace = service
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
        .expect("create enabled plugin checkout");
    db::acquire_db(&database)
        .set_plugin_enabled(&project.id, "com.example.review", false)
        .expect("disable plugin without scheduling cleanup");

    let report = service
        .reconcile_startup()
        .await
        .expect("reconcile disabled plugin checkout");

    assert_eq!(report.removed, 1);
    assert!(!workspace.path.exists());
}
