mod managed_artifact_lifecycle;
mod metadata_validation;
mod package_sources;

use std::{fs, path::Path};

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

fn write_package_json(dir: &Path, openforge: &str) {
    fs::write(
        dir.join("package.json"),
        format!(r#"{{"name":"@acme/plugin","version":"1.2.3","openforge":{openforge}}}"#),
    )
    .expect("package.json should write");
}

fn make_executable(path: &Path) {
    #[cfg(unix)]
    {
        let mut permissions = fs::metadata(path)
            .expect("metadata should read")
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(path, permissions).expect("permissions should set");
    }
}
