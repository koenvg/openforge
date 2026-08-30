use super::super::runtime_command::{
    test_support::{lock_plugin_host_env, EnvVarRestore},
    BUN_PATH_ENV, ENTRYPOINT_ENV,
};
use std::fs;
use std::path::PathBuf;
use tempfile::{tempdir, TempDir};

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

const BUN_SHIM: &str = "#!/bin/sh\nif [ \"$1\" = \"run\" ]; then shift; fi\nexec node \"$@\"\n";

pub(super) struct StdioTestHarness {
    _bun_env: EnvVarRestore,
    _entrypoint_env: EnvVarRestore,
    _env_lock: tokio::sync::MutexGuard<'static, ()>,
    temp: TempDir,
}

impl StdioTestHarness {
    pub(super) async fn new(sidecar_source: &str) -> Self {
        let temp = tempdir().expect("tempdir should create");
        let sidecar_path = temp.path().join("sidecar.cjs");
        let bun_shim_path = temp.path().join("bun-shim");

        fs::write(&sidecar_path, sidecar_source).expect("sidecar should write");
        fs::write(&bun_shim_path, BUN_SHIM).expect("bun shim should write");
        make_executable(&bun_shim_path);

        let env_lock = lock_plugin_host_env().await;
        let bun_env = EnvVarRestore::set_path(BUN_PATH_ENV, &bun_shim_path);
        let entrypoint_env = EnvVarRestore::set_path(ENTRYPOINT_ENV, &sidecar_path);

        Self {
            _bun_env: bun_env,
            _entrypoint_env: entrypoint_env,
            _env_lock: env_lock,
            temp,
        }
    }

    pub(super) fn write_file(&self, filename: &str, contents: &str) -> PathBuf {
        let path = self.temp.path().join(filename);
        fs::write(&path, contents).expect("test file should write");
        path
    }
}

#[cfg(unix)]
fn make_executable(path: &std::path::Path) {
    let mut permissions = fs::metadata(path)
        .expect("metadata should read")
        .permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(path, permissions).expect("permissions should set");
}

#[cfg(not(unix))]
fn make_executable(_path: &std::path::Path) {}
