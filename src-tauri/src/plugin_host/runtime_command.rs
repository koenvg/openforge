use crate::backend_runtime::AppHandle;
use std::collections::HashMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

pub(super) const BUN_PATH_ENV: &str = "OPENFORGE_BUN_PATH";
pub(super) const ELECTRON_RUN_AS_NODE_ENV: &str = "ELECTRON_RUN_AS_NODE";
pub(super) const ENTRYPOINT_ENV: &str = "OPENFORGE_PLUGIN_HOST_ENTRYPOINT";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct SidecarRuntimeCommand {
    pub(super) command: PathBuf,
    pub(super) args: Vec<OsString>,
    pub(super) env: HashMap<&'static str, OsString>,
}

impl SidecarRuntimeCommand {
    fn bun(command: PathBuf, entrypoint: &Path) -> Self {
        Self {
            command,
            args: vec![OsString::from("run"), entrypoint.as_os_str().to_os_string()],
            env: HashMap::new(),
        }
    }

    fn electron_node(command: PathBuf, entrypoint: &Path) -> Self {
        Self {
            command,
            args: vec![entrypoint.as_os_str().to_os_string()],
            env: HashMap::from([(ELECTRON_RUN_AS_NODE_ENV, OsString::from("1"))]),
        }
    }

    pub(super) fn kind(&self) -> &'static str {
        if self.env.contains_key(ELECTRON_RUN_AS_NODE_ENV) {
            "electron-node"
        } else {
            "bun"
        }
    }
}

fn explicit_bun_runtime(entrypoint: &Path) -> Option<SidecarRuntimeCommand> {
    let path = std::env::var(BUN_PATH_ENV).ok()?;
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return None;
    }

    Some(SidecarRuntimeCommand::bun(
        PathBuf::from(trimmed),
        entrypoint,
    ))
}

fn is_javascript_entrypoint(entrypoint: &Path) -> bool {
    matches!(
        entrypoint
            .extension()
            .and_then(|extension| extension.to_str()),
        Some("js" | "mjs" | "cjs")
    )
}

fn packaged_electron_node_runtime(
    current_exe: Option<&Path>,
    entrypoint: &Path,
) -> Option<SidecarRuntimeCommand> {
    if !is_javascript_entrypoint(entrypoint) {
        return None;
    }

    let macos_dir = current_exe?.parent()?;
    if macos_dir.file_name()? != "MacOS" {
        return None;
    }

    let contents_dir = macos_dir.parent()?;
    if contents_dir.file_name()? != "Contents" {
        return None;
    }

    let electron_runtime = macos_dir.join(crate::data_identity::package_app_name());
    if electron_runtime.is_file() {
        Some(SidecarRuntimeCommand::electron_node(
            electron_runtime,
            entrypoint,
        ))
    } else {
        None
    }
}

pub(super) fn resolve_sidecar_runtime(entrypoint: &Path) -> Result<SidecarRuntimeCommand, String> {
    if let Some(runtime) = explicit_bun_runtime(entrypoint) {
        return Ok(runtime);
    }

    let current_exe = std::env::current_exe().ok();
    if let Some(runtime) = packaged_electron_node_runtime(current_exe.as_deref(), entrypoint) {
        return Ok(runtime);
    }

    which::which("bun")
        .map(|path| SidecarRuntimeCommand::bun(path, entrypoint))
        .map_err(|error| {
            format!(
                "failed to locate plugin host runtime: set {BUN_PATH_ENV}, install bun on PATH, or launch the packaged Electron app with its bundled Node runtime available ({error})"
            )
        })
}

pub(super) fn resolve_entrypoint(app_handle: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var(ENTRYPOINT_ENV) {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }

    let resource_entrypoint = app_handle
        .path()
        .resource_dir()
        .map(|path| path.join("plugin-host").join("index.js"))
        .map_err(|error| format!("failed to resolve plugin host resource directory: {error}"))?;
    if resource_entrypoint.is_file() {
        return Ok(resource_entrypoint);
    }

    let repo_entrypoint = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("plugin-host")
        .join("index.ts");
    if repo_entrypoint.is_file() {
        return Ok(repo_entrypoint);
    }

    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve plugin host entrypoint: {error}"))?;
    for filename in ["index.js", "index.ts"] {
        let app_data_entrypoint = app_data_dir.join("plugin-host").join(filename);
        if app_data_entrypoint.is_file() {
            return Ok(app_data_entrypoint);
        }
    }

    Ok(app_data_dir.join("plugin-host").join("index.ts"))
}

#[cfg(test)]
pub(in crate::plugin_host) mod test_support {
    use std::ffi::OsString;
    use std::path::Path;
    use std::sync::OnceLock;

    static PLUGIN_HOST_ENV_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();

    pub(in crate::plugin_host) struct EnvVarRestore {
        key: &'static str,
        previous: Option<OsString>,
    }

    impl EnvVarRestore {
        pub(in crate::plugin_host) fn set_path(key: &'static str, value: &Path) -> Self {
            let previous = std::env::var_os(key);
            std::env::set_var(key, value);
            Self { key, previous }
        }

        pub(in crate::plugin_host) fn remove(key: &'static str) -> Self {
            let previous = std::env::var_os(key);
            std::env::remove_var(key);
            Self { key, previous }
        }
    }

    impl Drop for EnvVarRestore {
        fn drop(&mut self) {
            match &self.previous {
                Some(value) => std::env::set_var(self.key, value),
                None => std::env::remove_var(self.key),
            }
        }
    }

    pub(in crate::plugin_host) async fn lock_plugin_host_env(
    ) -> tokio::sync::MutexGuard<'static, ()> {
        PLUGIN_HOST_ENV_LOCK
            .get_or_init(|| tokio::sync::Mutex::new(()))
            .lock()
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::{lock_plugin_host_env, EnvVarRestore};
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[tokio::test]
    async fn resolve_entrypoint_prefers_packaged_resource_bundle_over_source_and_legacy_app_data() {
        let temp = tempdir().expect("tempdir should create");
        let resource_dir = temp.path().join("resources");
        let app_data_dir = temp.path().join("app-data");
        let bundled_entrypoint = resource_dir.join("plugin-host").join("index.js");
        let legacy_app_data_entrypoint = app_data_dir.join("plugin-host").join("index.ts");
        fs::create_dir_all(
            bundled_entrypoint
                .parent()
                .expect("resource parent should exist"),
        )
        .expect("resource dir should create");
        fs::create_dir_all(
            legacy_app_data_entrypoint
                .parent()
                .expect("app data parent should exist"),
        )
        .expect("app data dir should create");
        fs::write(&bundled_entrypoint, "console.log('bundled plugin host')")
            .expect("bundled entrypoint should write");
        fs::write(
            &legacy_app_data_entrypoint,
            "console.log('legacy plugin host')",
        )
        .expect("legacy entrypoint should write");

        let _env_lock = lock_plugin_host_env().await;
        let _entrypoint_env = EnvVarRestore::remove(ENTRYPOINT_ENV);
        let app = AppHandle::with_app_paths(app_data_dir, resource_dir);

        assert_eq!(
            resolve_entrypoint(&app).expect("entrypoint should resolve"),
            bundled_entrypoint
        );
    }

    #[tokio::test]
    async fn resolve_sidecar_runtime_prefers_explicit_bun_override() {
        let temp = tempdir().expect("tempdir should create");
        let entrypoint = temp.path().join("index.js");
        let bun_path = temp.path().join("custom-bun");
        fs::write(&entrypoint, "console.log('plugin host')").expect("entrypoint should write");

        let _env_lock = lock_plugin_host_env().await;
        let _bun_env = EnvVarRestore::set_path(BUN_PATH_ENV, &bun_path);

        let runtime = resolve_sidecar_runtime(&entrypoint).expect("runtime should resolve");

        assert_eq!(runtime.command, bun_path);
        assert_eq!(
            runtime.args,
            vec![OsString::from("run"), entrypoint.into_os_string()]
        );
        assert!(runtime.env.is_empty());
    }

    #[test]
    fn packaged_electron_node_runtime_uses_sibling_app_binary_for_bundled_javascript_host() {
        let temp = tempdir().expect("tempdir should create");
        let macos_dir = temp
            .path()
            .join("Open Forge.app")
            .join("Contents")
            .join("MacOS");
        fs::create_dir_all(&macos_dir).expect("macos dir should create");
        let sidecar_exe = macos_dir.join("openforge-sidecar");
        let electron_exe = macos_dir.join(crate::data_identity::package_app_name());
        let entrypoint = macos_dir.join("plugin-host").join("index.js");
        fs::create_dir_all(entrypoint.parent().expect("entrypoint parent"))
            .expect("plugin host dir should create");
        fs::write(&electron_exe, "electron").expect("electron runtime should write");
        fs::write(&entrypoint, "console.log('plugin host')").expect("entrypoint should write");

        let runtime = packaged_electron_node_runtime(Some(&sidecar_exe), &entrypoint)
            .expect("packaged runtime should resolve");

        assert_eq!(runtime.command, electron_exe);
        assert_eq!(runtime.args, vec![entrypoint.into_os_string()]);
        assert_eq!(
            runtime.env.get(ELECTRON_RUN_AS_NODE_ENV),
            Some(&OsString::from("1"))
        );
    }

    #[test]
    fn packaged_electron_node_runtime_does_not_claim_typescript_dev_entrypoints() {
        let temp = tempdir().expect("tempdir should create");
        let macos_dir = temp
            .path()
            .join("Open Forge.app")
            .join("Contents")
            .join("MacOS");
        fs::create_dir_all(&macos_dir).expect("macos dir should create");
        let sidecar_exe = macos_dir.join("openforge-sidecar");
        let electron_exe = macos_dir.join(crate::data_identity::package_app_name());
        let entrypoint = macos_dir.join("plugin-host").join("index.ts");
        fs::write(&electron_exe, "electron").expect("electron runtime should write");

        assert!(packaged_electron_node_runtime(Some(&sidecar_exe), &entrypoint).is_none());
    }
}
