use super::super::{
    command_output_details, install_plugin_package_from_source_spec,
    install_plugin_package_from_source_spec_async, managed_plugin_dir, managed_plugins_dir,
    resolve_requested_package_dir_name, GIT_PATH_ENV, NPM_PATH_ENV,
};
use super::{make_executable, write_package_json};
use serde_json::Value;
use std::{fs, path::PathBuf};
use tempfile::tempdir;

#[test]
fn command_output_details_reports_metadata_only() {
    let details = command_output_details(
        b"stdout with /Users/example/project",
        b"stderr with secret plugin failure",
    );

    assert_eq!(
        details,
        "command exited with stdout_bytes=34 stderr_bytes=33"
    );
    assert!(!details.contains("/Users/example/project"));
    assert!(!details.contains("secret plugin failure"));
}

#[test]
fn install_local_svelte_package_preserves_declared_frontend_styles() {
    let source = tempdir().expect("source tempdir should create");
    let managed = tempdir().expect("managed tempdir should create");
    fs::create_dir_all(source.path().join("dist")).expect("dist dir should create");
    fs::write(source.path().join("dist/frontend.js"), "export default {};")
        .expect("frontend should write");
    fs::write(
        source.path().join("dist/plugin-local.css"),
        ".plugin-view { color: red; }",
    )
    .expect("frontend stylesheet should write");
    write_package_json(
        source.path(),
        r#"{"id":"acme.local","apiVersion":1,"displayName":"Local Plugin","description":"A local plugin","icon":{"type":"svg","svg":"<svg viewBox=\"0 0 24 24\"><rect x=\"15\" y=\"5\" width=\"4\" height=\"12\"/><rect x=\"7\" y=\"8\" width=\"4\" height=\"9\"/></svg>"},"frontend":"dist/frontend.js","frontendStyles":["dist/plugin-local.css"],"requires":["views"]}"#,
    );

    let row =
        install_plugin_package_from_source_spec(&source.path().to_string_lossy(), managed.path())
            .expect("local package install should succeed");

    assert_eq!(row.id, "acme.local");
    assert_eq!(row.name, "Local Plugin");
    assert_eq!(row.source_kind, "local");
    assert_eq!(row.source_spec, source.path().to_string_lossy());
    assert_eq!(
        row.install_path,
        source.path().canonicalize().unwrap().to_string_lossy()
    );
    assert!(!managed_plugin_dir(managed.path(), "acme.local").exists());
    let metadata: Value =
        serde_json::from_str(&row.package_metadata).expect("stored package metadata should parse");
    assert_eq!(metadata["displayName"], "Local Plugin");
    assert_eq!(metadata["icon"]["type"], "svg");
    assert_eq!(metadata["frontendStyles"][0], "dist/plugin-local.css");
    assert!(metadata.get("openforge").is_none());
}

#[test]
fn resolve_requested_package_dir_name_handles_version_and_alias_specs() {
    assert_eq!(
        resolve_requested_package_dir_name("example-plugin@1.2.3")
            .expect("version spec should resolve"),
        "example-plugin"
    );
    assert_eq!(
        resolve_requested_package_dir_name("example-plugin@latest")
            .expect("tag spec should resolve"),
        "example-plugin"
    );
    assert_eq!(
        resolve_requested_package_dir_name("@openforge-app/example-plugin@1.2.3")
            .expect("scoped version spec should resolve"),
        "@openforge-app/example-plugin"
    );
    assert_eq!(
        resolve_requested_package_dir_name("plugin-alias@npm:@openforge-app/example-plugin@1.2.3")
            .expect("alias spec should resolve"),
        "plugin-alias"
    );
}

#[tokio::test]
async fn install_npm_package_source_uses_managed_directory_and_records_source() {
    let managed = tempdir().expect("managed tempdir should create");
    let fake_npm_dir = tempdir().expect("fake npm dir should create");
    let fake_npm = fake_npm_dir.path().join("npm");
    let script = r#"#!/bin/sh
prefix=""
while [ $# -gt 0 ]; do
  case "$1" in
--prefix)
  shift
  prefix="$1"
  ;;
  esac
  shift
done
mkdir -p "$prefix/node_modules/fake-package/dist"
cat > "$prefix/node_modules/fake-package/package.json" <<'EOF'
{"name":"fake-package","version":"2.0.0","openforge":{"id":"acme.npm","apiVersion":1,"displayName":"Npm Plugin","description":"Installed from npm","frontend":"dist/index.js"}}
EOF
echo "export const ok = true;" > "$prefix/node_modules/fake-package/dist/index.js"
"#;
    fs::write(&fake_npm, script).expect("fake npm should write");
    make_executable(&fake_npm);

    let previous = std::env::var(NPM_PATH_ENV).ok();
    std::env::set_var(NPM_PATH_ENV, &fake_npm);
    let row =
        install_plugin_package_from_source_spec_async("npm:fake-package@2.0.0", managed.path())
            .await
            .expect("npm install should succeed");
    match previous {
        Some(value) => std::env::set_var(NPM_PATH_ENV, value),
        None => std::env::remove_var(NPM_PATH_ENV),
    }

    let install_path = PathBuf::from(&row.install_path);
    assert_eq!(row.id, "acme.npm");
    assert_eq!(row.version, "2.0.0");
    assert_eq!(row.source_kind, "npm");
    assert_eq!(row.source_spec, "npm:fake-package@2.0.0");
    assert!(install_path.starts_with(managed_plugins_dir(managed.path())));
    assert!(install_path.join("package.json").exists());
    assert!(install_path.join("dist/index.js").exists());
}

#[tokio::test]
async fn install_git_package_source_uses_external_git_and_records_source() {
    let managed = tempdir().expect("managed tempdir should create");
    let fake_git_dir = tempdir().expect("fake git dir should create");
    let fake_git = fake_git_dir.path().join("git");
    let script = r#"#!/bin/sh
for last do :; done
dest="$last"
mkdir -p "$dest/dist"
cat > "$dest/package.json" <<'EOF'
{"name":"git-package","version":"3.0.0","openforge":{"id":"acme.git","apiVersion":1,"displayName":"Git Plugin","description":"Installed from git","frontend":"dist/index.js"}}
EOF
echo "export const ok = true;" > "$dest/dist/index.js"
"#;
    fs::write(&fake_git, script).expect("fake git should write");
    make_executable(&fake_git);

    let previous = std::env::var(GIT_PATH_ENV).ok();
    std::env::set_var(GIT_PATH_ENV, &fake_git);
    let row = install_plugin_package_from_source_spec_async(
        "git:github.com/acme/plugin@main",
        managed.path(),
    )
    .await
    .expect("git install should succeed");
    match previous {
        Some(value) => std::env::set_var(GIT_PATH_ENV, value),
        None => std::env::remove_var(GIT_PATH_ENV),
    }

    let install_path = PathBuf::from(&row.install_path);
    assert_eq!(row.id, "acme.git");
    assert_eq!(row.source_kind, "git");
    assert_eq!(row.source_spec, "git:github.com/acme/plugin@main");
    assert!(install_path.starts_with(managed_plugins_dir(managed.path())));
    assert!(install_path.join("package.json").exists());
}
