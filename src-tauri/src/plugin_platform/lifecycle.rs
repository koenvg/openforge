use super::PluginPlatform;
use crate::db;
use std::{
    collections::HashMap,
    path::Path,
    sync::{Arc, Mutex, MutexGuard, Weak},
};

#[derive(Debug, Default)]
struct PluginLifecycleLock {
    mutex: Mutex<()>,
    #[cfg(test)]
    waiters: Mutex<usize>,
    #[cfg(test)]
    waiter_registered: std::sync::Condvar,
}

impl PluginLifecycleLock {
    fn acquire(&self) -> MutexGuard<'_, ()> {
        #[cfg(test)]
        {
            let mut waiters = acquire_mutex(&self.waiters);
            *waiters += 1;
            self.waiter_registered.notify_all();
        }

        let guard = acquire_mutex(&self.mutex);

        #[cfg(test)]
        {
            let mut waiters = acquire_mutex(&self.waiters);
            *waiters -= 1;
        }

        guard
    }

    #[cfg(test)]
    fn wait_for_waiter(&self, timeout: std::time::Duration) -> bool {
        let waiters = acquire_mutex(&self.waiters);
        let (waiters, _) = self
            .waiter_registered
            .wait_timeout_while(waiters, timeout, |waiters| *waiters == 0)
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *waiters > 0
    }

    #[cfg(test)]
    fn is_locked(&self) -> bool {
        matches!(
            self.mutex.try_lock(),
            Err(std::sync::TryLockError::WouldBlock)
        )
    }
}

#[derive(Debug, Clone, Default)]
pub(crate) struct PluginLifecycleLocks {
    locks: Arc<Mutex<HashMap<String, Weak<PluginLifecycleLock>>>>,
}

impl PluginLifecycleLocks {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    fn lock_for(&self, plugin_id: &str) -> Arc<PluginLifecycleLock> {
        let mut locks = acquire_mutex(&self.locks);
        locks.retain(|_, lock| lock.strong_count() > 0);

        if let Some(lock) = locks.get(plugin_id).and_then(Weak::upgrade) {
            return lock;
        }

        let lock = Arc::new(PluginLifecycleLock::default());
        locks.insert(plugin_id.to_string(), Arc::downgrade(&lock));
        lock
    }
}

fn acquire_mutex<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl PluginPlatform<'_> {
    pub(crate) fn register_builtin_plugin(&self, plugin: &db::PluginRow) -> Result<(), String> {
        if !plugin.is_builtin
            || plugin.source_kind != "builtin"
            || !crate::builtin_plugins::has_sentinel_install_path(&plugin.id, &plugin.install_path)
        {
            return Err(
                "trusted built-in plugin registration requires a known built-in plugin row"
                    .to_string(),
            );
        }

        let db = db::acquire_db(self.db);
        db.install_plugin(plugin)
            .map_err(|error| format!("Failed to register built-in plugin: {error}"))
    }

    pub(crate) fn install_local_plugin_bundle(
        &self,
        source_path: &Path,
    ) -> Result<db::PluginRow, String> {
        let prepared = crate::plugin_installation::prepare_local_plugin_bundle(
            source_path,
            self.app_data_dir()?,
        )?;
        self.finalize_plugin_installation(prepared, "Failed to install local plugin")
    }

    pub(crate) async fn install_npm_plugin_bundle(
        &self,
        package_name: &str,
    ) -> Result<db::PluginRow, String> {
        let app_data_dir = self.app_data_dir()?.to_path_buf();
        let prepared =
            crate::plugin_installation::prepare_npm_plugin_bundle(package_name, &app_data_dir)
                .await?;
        self.finalize_plugin_installation(prepared, "Failed to install npm plugin")
    }

    pub(crate) async fn install_git_plugin_bundle(
        &self,
        git_spec: &str,
    ) -> Result<db::PluginRow, String> {
        let app_data_dir = self.app_data_dir()?.to_path_buf();
        let prepared =
            crate::plugin_installation::prepare_git_plugin_bundle(git_spec, &app_data_dir).await?;
        self.finalize_plugin_installation(prepared, "Failed to install git plugin")
    }

    pub(crate) async fn install_plugin_package_source(
        &self,
        source_spec: &str,
    ) -> Result<db::PluginRow, String> {
        let app_data_dir = self.app_data_dir()?.to_path_buf();
        let prepared = crate::plugin_installation::prepare_plugin_package_from_source_spec_async(
            source_spec,
            &app_data_dir,
        )
        .await?;
        self.finalize_plugin_installation(prepared, "Failed to install plugin package source")
    }

    fn finalize_plugin_installation(
        &self,
        prepared: crate::plugin_installation::PreparedPluginInstallation,
        registration_error_context: &str,
    ) -> Result<db::PluginRow, String> {
        self.finalize_plugin_installation_with(prepared, registration_error_context, || {})
    }

    fn finalize_plugin_installation_with<F>(
        &self,
        prepared: crate::plugin_installation::PreparedPluginInstallation,
        registration_error_context: &str,
        after_package_publish: F,
    ) -> Result<db::PluginRow, String>
    where
        F: FnOnce(),
    {
        let lifecycle_lock = self.lifecycle_locks.lock_for(prepared.plugin_id());
        let _lifecycle_guard = lifecycle_lock.acquire();
        let plugin = prepared.finalize()?;
        after_package_publish();
        let db = db::acquire_db(self.db);
        db.install_plugin(&plugin)
            .map_err(|error| format!("{registration_error_context}: {error}"))?;
        Ok(plugin)
    }

    pub(crate) fn uninstall_plugin(&self, plugin_id: &str) -> Result<(), String> {
        let lifecycle_lock = self.lifecycle_locks.lock_for(plugin_id);
        let _lifecycle_guard = lifecycle_lock.acquire();
        // Keep the outer database guard through filesystem finalization so concurrent
        // database requests cannot act on the same staged package state.
        let db = db::acquire_db(self.db);
        let plugin = db
            .get_plugin(plugin_id)
            .map_err(|error| format!("Failed to read plugin before uninstall: {error}"))?;

        let staged_uninstall = if let Some(plugin) = plugin.as_ref() {
            if plugin.is_builtin || plugin.source_kind == "builtin" {
                return Err("built-in plugins cannot be uninstalled".to_string());
            }

            Some(crate::plugin_installation::stage_managed_plugin_uninstall(
                plugin,
                self.app_data_dir()?,
            )?)
        } else {
            None
        };

        let database_result = db
            .uninstall_plugin(plugin_id)
            .map_err(|error| format!("Failed to uninstall plugin: {error}"));

        let result = match database_result {
            Ok(()) => match staged_uninstall {
                Some(staged_uninstall) => staged_uninstall.commit(),
                None => match self.app_data_dir.as_deref() {
                    Some(app_data_dir) =>
                        crate::plugin_installation::cleanup_staged_managed_plugin_uninstall(
                            plugin_id,
                            app_data_dir,
                        ),
                    None => Ok(()),
                },
            },
            Err(database_error) => match staged_uninstall {
                Some(staged_uninstall) => match staged_uninstall.rollback() {
                    Ok(()) => Err(database_error),
                    Err(rollback_error) => Err(format!(
                        "{database_error}; managed plugin package recovery also failed: {rollback_error}"
                    )),
                },
                None => Err(database_error),
            },
        };

        drop(db);
        result
    }

    pub(crate) fn plugin(&self, plugin_id: &str) -> Result<Option<db::PluginRow>, String> {
        let db = db::acquire_db(self.db);
        db.get_plugin(plugin_id)
            .map_err(|error| format!("Failed to get plugin: {error}"))
    }

    pub(crate) fn plugins(&self) -> Result<Vec<db::PluginRow>, String> {
        let db = db::acquire_db(self.db);
        db.list_plugins()
            .map_err(|error| format!("Failed to list plugins: {error}"))
    }

    fn app_data_dir(&self) -> Result<&Path, String> {
        self.app_data_dir
            .as_deref()
            .ok_or_else(|| "app data directory is required for this plugin operation".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, path::PathBuf, sync::mpsc, time::Duration};
    use tempfile::tempdir;

    const MANAGED_PLUGIN_ID: &str = "acme.managed";

    fn managed_plugin(install_path: &Path) -> db::PluginRow {
        db::PluginRow {
            id: MANAGED_PLUGIN_ID.to_string(),
            name: "Managed plugin".to_string(),
            version: "1.0.0".to_string(),
            api_version: 1,
            description: "Managed plugin for uninstall tests".to_string(),
            permissions: "[]".to_string(),
            contributes: "{}".to_string(),
            frontend_entry: "dist/frontend.js".to_string(),
            backend_entry: None,
            install_path: install_path.to_string_lossy().into_owned(),
            source_kind: "npm".to_string(),
            source_spec: "npm:@acme/managed@1.0.0".to_string(),
            package_metadata: "{}".to_string(),
            installed_at: 0,
            is_builtin: false,
        }
    }

    fn write_managed_plugin_package(app_data_dir: &Path) -> PathBuf {
        let install_path =
            crate::plugin_installation::managed_plugin_dir(app_data_dir, MANAGED_PLUGIN_ID);
        fs::create_dir_all(install_path.join("dist"))
            .expect("managed plugin directory should create");
        fs::write(install_path.join("dist/frontend.js"), "old package")
            .expect("managed plugin artifact should write");
        install_path
    }

    fn write_replacement_package_source(source_path: &Path) {
        fs::create_dir_all(source_path.join("dist"))
            .expect("replacement package directory should create");
        fs::write(
            source_path.join("package.json"),
            r#"{"name":"@acme/managed","version":"2.0.0","openforge":{"id":"acme.managed","apiVersion":1,"displayName":"Managed plugin","description":"Replacement managed plugin","frontend":"dist/frontend.js"}}"#,
        )
        .expect("replacement package metadata should write");
        fs::write(source_path.join("dist/frontend.js"), "replacement package")
            .expect("replacement package artifact should write");
    }

    fn database_with_managed_plugin(app_data_dir: &Path, install_path: &Path) -> db::Database {
        let database = db::Database::new(app_data_dir.join("openforge.db"))
            .expect("test database should create");
        database
            .install_plugin(&managed_plugin(install_path))
            .expect("managed plugin row should install");
        database
    }

    #[test]
    fn managed_install_finalization_serializes_with_uninstall() {
        let app_data_dir = tempdir().expect("app data tempdir should create");
        let install_path = write_managed_plugin_package(app_data_dir.path());
        let database = database_with_managed_plugin(app_data_dir.path(), &install_path);
        let replacement_source = tempdir().expect("replacement source tempdir should create");
        write_replacement_package_source(replacement_source.path());
        let prepared = crate::plugin_installation::prepare_managed_plugin_bundle_for_test(
            replacement_source.path(),
            app_data_dir.path(),
        )
        .expect("replacement package should prepare");

        let (published_tx, published_rx) = mpsc::channel();
        let (continue_install_tx, continue_install_rx) = mpsc::channel();

        let database = Mutex::new(database);
        let lifecycle_locks = PluginLifecycleLocks::new();
        let (published_artifact, install_holds_lock, uninstall_waits_for_lock) =
            std::thread::scope(|scope| {
                let install_database = &database;
                let install_lifecycle_locks = &lifecycle_locks;
                let install_app_data_dir = app_data_dir.path().to_path_buf();
                let install = scope.spawn(move || {
                    let platform = PluginPlatform::new(
                        install_database,
                        Some(install_app_data_dir),
                        None,
                        install_lifecycle_locks,
                    );
                    platform.finalize_plugin_installation_with(
                        prepared,
                        "Failed to install replacement plugin",
                        || {
                            published_tx
                                .send(())
                                .expect("publication signal should send");
                            continue_install_rx
                                .recv()
                                .expect("install continuation should arrive");
                        },
                    )
                });

                published_rx
                    .recv()
                    .expect("replacement package should publish");
                let published_artifact = fs::read_to_string(install_path.join("dist/frontend.js"));
                let lifecycle_lock = lifecycle_locks.lock_for(MANAGED_PLUGIN_ID);
                let install_holds_lock = lifecycle_lock.is_locked();

                let uninstall_database = &database;
                let uninstall_lifecycle_locks = &lifecycle_locks;
                let uninstall_app_data_dir = app_data_dir.path().to_path_buf();
                let uninstall = scope.spawn(move || {
                    let platform = PluginPlatform::new(
                        uninstall_database,
                        Some(uninstall_app_data_dir),
                        None,
                        uninstall_lifecycle_locks,
                    );
                    platform.uninstall_plugin(MANAGED_PLUGIN_ID)
                });

                let uninstall_waits_for_lock =
                    lifecycle_lock.wait_for_waiter(Duration::from_secs(1));
                continue_install_tx
                    .send(())
                    .expect("install should continue");
                install
                    .join()
                    .expect("install thread should not panic")
                    .expect("replacement package should install");
                uninstall
                    .join()
                    .expect("uninstall thread should not panic")
                    .expect("uninstall should succeed");

                (
                    published_artifact,
                    install_holds_lock,
                    uninstall_waits_for_lock,
                )
            });

        assert_eq!(
            published_artifact.expect("published replacement should remain readable"),
            "replacement package"
        );

        assert!(
            install_holds_lock,
            "managed installation must hold the per-plugin lifecycle lock while published artifacts await registration"
        );
        assert!(
            uninstall_waits_for_lock,
            "uninstall must contend for the same per-plugin lifecycle lock before installation resumes"
        );

        let platform = PluginPlatform::new(
            &database,
            Some(app_data_dir.path().to_path_buf()),
            None,
            &lifecycle_locks,
        );
        assert!(platform
            .plugin(MANAGED_PLUGIN_ID)
            .expect("plugin lookup should succeed")
            .is_none());
        assert!(!install_path.exists());
    }

    #[test]
    fn uninstall_keeps_managed_package_when_database_delete_fails() {
        let app_data_dir = tempdir().expect("app data tempdir should create");
        let install_path = write_managed_plugin_package(app_data_dir.path());
        let database = database_with_managed_plugin(app_data_dir.path(), &install_path);
        {
            let connection = database.connection();
            let connection = connection.lock().expect("database connection should lock");
            connection
                .execute_batch(
                    "CREATE TRIGGER fail_managed_plugin_uninstall
                     BEFORE DELETE ON plugins
                     WHEN OLD.id = 'acme.managed'
                     BEGIN
                       SELECT RAISE(ABORT, 'forced plugin uninstall failure');
                     END;",
                )
                .expect("failure trigger should create");
        }

        let database = Mutex::new(database);
        let lifecycle_locks = PluginLifecycleLocks::new();
        let platform = PluginPlatform::new(
            &database,
            Some(app_data_dir.path().to_path_buf()),
            None,
            &lifecycle_locks,
        );

        let error = platform
            .uninstall_plugin(MANAGED_PLUGIN_ID)
            .expect_err("database failure should abort uninstall");

        assert!(error.contains("Failed to uninstall plugin"));
        assert!(platform
            .plugin(MANAGED_PLUGIN_ID)
            .expect("plugin row should remain readable")
            .is_some());
        assert!(install_path.join("dist/frontend.js").is_file());
    }

    #[test]
    fn uninstall_removes_staged_package_when_plugin_row_is_already_gone() {
        let app_data_dir = tempdir().expect("app data tempdir should create");
        let install_path = write_managed_plugin_package(app_data_dir.path());
        let plugin = managed_plugin(&install_path);
        let _staged_uninstall = crate::plugin_installation::stage_managed_plugin_uninstall(
            &plugin,
            app_data_dir.path(),
        )
        .expect("managed plugin package should stage");
        assert!(!install_path.exists());

        let database = Mutex::new(
            db::Database::new(app_data_dir.path().join("openforge.db"))
                .expect("test database should create"),
        );
        let lifecycle_locks = PluginLifecycleLocks::new();
        let platform = PluginPlatform::new(
            &database,
            Some(app_data_dir.path().to_path_buf()),
            None,
            &lifecycle_locks,
        );
        assert!(platform
            .plugin(MANAGED_PLUGIN_ID)
            .expect("plugin lookup should succeed")
            .is_none());

        platform
            .uninstall_plugin(MANAGED_PLUGIN_ID)
            .expect("retry should remove the staged package");

        let managed_plugins_dir =
            crate::plugin_installation::managed_plugins_dir(app_data_dir.path());
        assert!(fs::read_dir(managed_plugins_dir)
            .expect("managed plugins directory should remain readable")
            .next()
            .is_none());
    }

    #[test]
    fn uninstall_preserves_traversal_install_path_target() {
        let temp_dir = tempdir().expect("test tempdir should create");
        let app_data_dir = temp_dir.path().join("app-data");
        let declared_install_path =
            crate::plugin_installation::managed_plugin_dir(&app_data_dir, MANAGED_PLUGIN_ID);
        fs::create_dir_all(&declared_install_path).expect("declared install path should create");

        let external_path = temp_dir.path().join("external");
        fs::create_dir_all(&external_path).expect("external directory should create");
        fs::write(external_path.join("keep.txt"), "keep").expect("external marker should write");

        let traversal_install_path = declared_install_path.join("../../..").join("external");
        assert!(traversal_install_path.join("keep.txt").is_file());
        let database = db::Database::new(app_data_dir.join("openforge.db"))
            .expect("test database should create");
        database
            .install_plugin(&managed_plugin(&traversal_install_path))
            .expect("malformed plugin row should install");
        let database = Mutex::new(database);
        let lifecycle_locks = PluginLifecycleLocks::new();
        let platform = PluginPlatform::new(&database, Some(app_data_dir), None, &lifecycle_locks);

        platform
            .uninstall_plugin(MANAGED_PLUGIN_ID)
            .expect("plugin row should uninstall without deleting external files");

        assert!(external_path.join("keep.txt").is_file());
        assert!(platform
            .plugin(MANAGED_PLUGIN_ID)
            .expect("plugin lookup should succeed")
            .is_none());
    }
}
