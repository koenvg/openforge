use super::super::remove_staged_managed_plugin_directory;
use std::fs;
use tempfile::tempdir;

#[test]
fn staged_cleanup_reports_non_directory_tombstone() {
    let temp_dir = tempdir().expect("cleanup tempdir should create");
    let staged_path = temp_dir.path().join("staged-package");
    fs::write(&staged_path, "not a directory").expect("staged file should write");

    let error = remove_staged_managed_plugin_directory(&staged_path)
        .expect_err("non-directory tombstone should fail cleanup");

    assert!(error.contains("failed to remove staged managed plugin directory"));
    assert!(staged_path.is_file());
}
