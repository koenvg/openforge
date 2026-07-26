//! Discovery of OpenForge plugin packages inside a user-chosen folder.
//!
//! The global settings page remembers one "plugin folder" (typically a checkout of a
//! repository holding several plugins) and lists every plugin package found inside it so
//! each can be installed with a single click. Package parsing and validation are reused
//! from [`crate::plugin_installation`] so a row shown as installable here is exactly what
//! the local installer accepts; validation failures become per-row problems instead of
//! aborting the whole scan.

use serde::Serialize;
use std::fs;
use std::path::Path;

/// Directories below the chosen folder are walked to this depth (the folder itself is
/// depth 0). Two levels reach the common `<repo>/plugins/<plugin>` layout without turning
/// an unrelated folder choice into a deep filesystem crawl.
const MAX_DEPTH: usize = 2;

/// Never descend into these: build output, dependencies, sources, and test fixtures hold
/// no installable plugin package, and fixtures in particular contain deliberately broken
/// `package.json` files that would show up as bogus rows.
const SKIPPED_DIR_NAMES: &[&str] = &[
    "node_modules",
    "dist",
    "build",
    "coverage",
    "target",
    "src",
    "test-fixtures",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredPlugin {
    /// Absolute path of the plugin package directory, used verbatim as the local install source.
    pub path: String,
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    /// True when the local installer would accept this package as-is.
    pub installable: bool,
    /// True when the package declares entry artifacts that are not on disk yet.
    pub needs_build: bool,
    /// Why the package cannot be installed, in the installer's own words.
    pub problem: Option<String>,
}

pub fn scan_plugin_folder(folder: &Path) -> Result<Vec<DiscoveredPlugin>, String> {
    if !folder.is_dir() {
        return Err(format!(
            "plugin folder is not a directory: {}",
            folder.display()
        ));
    }

    let mut discovered = Vec::new();
    collect_plugin_packages(folder, 0, &mut discovered);
    flag_duplicate_ids(&mut discovered);
    discovered.sort_by(|left, right| {
        left.name
            .to_lowercase()
            .cmp(&right.name.to_lowercase())
            .then_with(|| left.path.cmp(&right.path))
    });
    Ok(discovered)
}

fn collect_plugin_packages(dir: &Path, depth: usize, discovered: &mut Vec<DiscoveredPlugin>) {
    if let Some(inspected) = crate::plugin_installation::inspect_plugin_package_dir(dir) {
        discovered.push(discovered_plugin(dir, inspected));
        // Subdirectories of a plugin package are its own sources and build output, never
        // more plugins, so matching ends the descent down this branch.
        return;
    }

    if depth >= MAX_DEPTH {
        return;
    }

    let Ok(entries) = fs::read_dir(dir) else {
        // An unreadable subdirectory drops out of the listing rather than failing the whole
        // scan; the folder the user actually chose is checked up front.
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if name.starts_with('.') || SKIPPED_DIR_NAMES.contains(&name) {
            continue;
        }
        collect_plugin_packages(&path, depth + 1, discovered);
    }
}

fn discovered_plugin(
    dir: &Path,
    inspected: crate::plugin_installation::InspectedPluginPackage,
) -> DiscoveredPlugin {
    let path = dir
        .canonicalize()
        .unwrap_or_else(|_| dir.to_path_buf())
        .to_string_lossy()
        .to_string();

    DiscoveredPlugin {
        path,
        id: inspected.id,
        name: inspected.name,
        version: inspected.version,
        description: inspected.description,
        installable: inspected.problem.is_none(),
        needs_build: !inspected.missing_entries.is_empty(),
        problem: inspected.problem,
    }
}

/// Two folders claiming the same plugin id cannot both be installed, and guessing a winner
/// would install something the user did not choose. Both rows are blocked and named instead.
/// The duplicate takes precedence over any other problem on the row: it has to be resolved in
/// the folder first, and a rescan then surfaces whatever else is wrong.
fn flag_duplicate_ids(discovered: &mut [DiscoveredPlugin]) {
    let duplicated_ids: Vec<String> = discovered
        .iter()
        .filter(|plugin| !plugin.id.is_empty())
        .filter(|plugin| {
            discovered
                .iter()
                .filter(|other| other.id == plugin.id)
                .count()
                > 1
        })
        .map(|plugin| plugin.id.clone())
        .collect();

    for plugin in discovered.iter_mut() {
        if duplicated_ids.contains(&plugin.id) {
            plugin.installable = false;
            plugin.problem = Some(format!(
                "two folders in this plugin folder declare the plugin id \"{}\"; remove or fix one of them",
                plugin.id
            ));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use tempfile::tempdir;

    struct PluginFixture {
        id: String,
        display_name: String,
        api_version: i64,
        built: bool,
    }

    impl PluginFixture {
        fn new(id: &str, display_name: &str) -> Self {
            Self {
                id: id.to_string(),
                display_name: display_name.to_string(),
                api_version: 1,
                built: true,
            }
        }

        fn unbuilt(mut self) -> Self {
            self.built = false;
            self
        }

        fn api_version(mut self, api_version: i64) -> Self {
            self.api_version = api_version;
            self
        }

        fn write_to(&self, dir: &Path) -> PathBuf {
            fs::create_dir_all(dir).expect("plugin package dir should create");
            fs::write(
                dir.join("package.json"),
                format!(
                    r#"{{"name":"@acme/{id}","version":"2.3.4","openforge":{{"id":"{id}","apiVersion":{api_version},"displayName":"{display_name}","description":"{display_name} does things","frontend":"./dist/frontend.js"}}}}"#,
                    id = self.id,
                    api_version = self.api_version,
                    display_name = self.display_name,
                ),
            )
            .expect("package.json should write");

            if self.built {
                fs::create_dir_all(dir.join("dist")).expect("dist dir should create");
                fs::write(dir.join("dist").join("frontend.js"), "export default {}")
                    .expect("frontend entry should write");
            }

            dir.to_path_buf()
        }
    }

    fn write_plain_package(dir: &Path, name: &str) {
        fs::create_dir_all(dir).expect("package dir should create");
        fs::write(
            dir.join("package.json"),
            format!(r#"{{"name":"{name}","version":"1.0.0"}}"#),
        )
        .expect("package.json should write");
    }

    fn scan(folder: &Path) -> Vec<DiscoveredPlugin> {
        scan_plugin_folder(folder).expect("scan should succeed")
    }

    #[test]
    fn finds_plugin_packages_nested_under_a_plugins_directory() {
        let root = tempdir().expect("temp dir");
        PluginFixture::new("com.acme.alpha", "Alpha").write_to(&root.path().join("plugins/alpha"));
        PluginFixture::new("com.acme.beta", "Beta").write_to(&root.path().join("plugins/beta"));

        let found = scan(root.path());

        assert_eq!(
            found.iter().map(|p| p.id.as_str()).collect::<Vec<_>>(),
            vec!["com.acme.alpha", "com.acme.beta"]
        );
        assert!(found.iter().all(|p| p.installable));
        assert!(found.iter().all(|p| p.problem.is_none()));
    }

    #[test]
    fn reports_package_metadata_for_display() {
        let root = tempdir().expect("temp dir");
        let package_dir =
            PluginFixture::new("com.acme.alpha", "Alpha").write_to(&root.path().join("alpha"));

        let found = scan(root.path());

        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name, "Alpha");
        assert_eq!(found[0].version, "2.3.4");
        assert_eq!(found[0].description, "Alpha does things");
        assert_eq!(
            found[0].path,
            package_dir
                .canonicalize()
                .expect("package dir should canonicalize")
                .to_string_lossy()
        );
    }

    #[test]
    fn finds_a_plugin_package_at_the_folder_root() {
        let root = tempdir().expect("temp dir");
        PluginFixture::new("com.acme.solo", "Solo").write_to(root.path());

        let found = scan(root.path());

        assert_eq!(found.len(), 1);
        assert_eq!(found[0].id, "com.acme.solo");
    }

    #[test]
    fn ignores_packages_without_openforge_metadata() {
        let root = tempdir().expect("temp dir");
        write_plain_package(&root.path().join("plugins/not-a-plugin"), "@acme/utils");
        PluginFixture::new("com.acme.alpha", "Alpha").write_to(&root.path().join("plugins/alpha"));

        let found = scan(root.path());

        assert_eq!(found.len(), 1);
        assert_eq!(found[0].id, "com.acme.alpha");
    }

    #[test]
    fn skips_dependency_and_fixture_directories() {
        let root = tempdir().expect("temp dir");
        PluginFixture::new("com.acme.vendored", "Vendored")
            .write_to(&root.path().join("node_modules/vendored"));
        PluginFixture::new("com.acme.fixture", "Fixture")
            .write_to(&root.path().join("test-fixtures/fixture"));

        assert_eq!(scan(root.path()), Vec::new());
    }

    #[test]
    fn does_not_descend_into_a_matched_plugin_package() {
        let root = tempdir().expect("temp dir");
        let outer = root.path().join("alpha");
        PluginFixture::new("com.acme.alpha", "Alpha").write_to(&outer);
        PluginFixture::new("com.acme.inner", "Inner").write_to(&outer.join("examples"));

        let found = scan(root.path());

        assert_eq!(found.len(), 1);
        assert_eq!(found[0].id, "com.acme.alpha");
    }

    #[test]
    fn flags_a_plugin_package_that_has_not_been_built() {
        let root = tempdir().expect("temp dir");
        PluginFixture::new("com.acme.alpha", "Alpha")
            .unbuilt()
            .write_to(&root.path().join("plugins/alpha"));

        let found = scan(root.path());

        assert_eq!(found.len(), 1);
        assert!(found[0].needs_build);
        assert!(!found[0].installable);
        assert!(
            found[0]
                .problem
                .as_deref()
                .expect("unbuilt package should report a problem")
                .contains("build"),
            "problem should point at the missing build: {:?}",
            found[0].problem
        );
        assert_eq!(found[0].name, "Alpha", "an unbuilt row still needs a label");
    }

    #[test]
    fn reports_an_unsupported_api_version_as_a_row_problem() {
        let root = tempdir().expect("temp dir");
        PluginFixture::new("com.acme.alpha", "Alpha")
            .api_version(99)
            .write_to(&root.path().join("plugins/alpha"));
        PluginFixture::new("com.acme.beta", "Beta").write_to(&root.path().join("plugins/beta"));

        let found = scan(root.path());

        assert_eq!(found.len(), 2, "one bad package must not hide the good one");
        let alpha = found
            .iter()
            .find(|p| p.id == "com.acme.alpha")
            .expect("alpha should be reported");
        assert!(!alpha.installable);
        assert!(!alpha.needs_build);
        assert!(
            alpha
                .problem
                .as_deref()
                .expect("unsupported apiVersion should report a problem")
                .contains("apiVersion"),
            "problem should name the offending field: {:?}",
            alpha.problem
        );
        assert!(
            found
                .iter()
                .find(|p| p.id == "com.acme.beta")
                .expect("beta should be reported")
                .installable
        );
    }

    #[test]
    fn marks_packages_that_share_a_plugin_id_as_unusable() {
        let root = tempdir().expect("temp dir");
        PluginFixture::new("com.acme.alpha", "Alpha").write_to(&root.path().join("plugins/alpha"));
        PluginFixture::new("com.acme.alpha", "Alpha Copy")
            .write_to(&root.path().join("plugins/alpha-copy"));

        let found = scan(root.path());

        assert_eq!(found.len(), 2);
        for plugin in &found {
            assert!(!plugin.installable, "neither duplicate may be installable");
            assert!(
                plugin
                    .problem
                    .as_deref()
                    .expect("duplicate id should report a problem")
                    .contains("com.acme.alpha"),
                "problem should name the duplicated id: {:?}",
                plugin.problem
            );
        }
    }

    #[test]
    fn sorts_results_by_display_name() {
        let root = tempdir().expect("temp dir");
        PluginFixture::new("com.acme.zulu", "Zulu").write_to(&root.path().join("plugins/zulu"));
        PluginFixture::new("com.acme.alpha", "Alpha").write_to(&root.path().join("plugins/alpha"));
        PluginFixture::new("com.acme.mike", "Mike").write_to(&root.path().join("plugins/mike"));

        let found = scan(root.path());

        assert_eq!(
            found.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(),
            vec!["Alpha", "Mike", "Zulu"]
        );
    }

    #[test]
    fn errors_when_the_folder_does_not_exist() {
        let root = tempdir().expect("temp dir");

        let error = scan_plugin_folder(&root.path().join("missing"))
            .expect_err("a missing folder should be an error");

        assert!(
            error.contains("missing"),
            "error should name the folder: {error}"
        );
    }

    #[test]
    fn errors_when_the_folder_is_a_file() {
        let root = tempdir().expect("temp dir");
        let file = root.path().join("plugins.txt");
        fs::write(&file, "not a folder").expect("file should write");

        scan_plugin_folder(&file).expect_err("a file should be an error");
    }
}
