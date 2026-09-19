use super::*;
use std::io::Read;

fn read(mut opened: AuthorizedFile) -> String {
    let mut content = String::new();
    opened
        .file
        .read_to_string(&mut content)
        .expect("read authorized file");
    content
}

#[test]
fn opens_regular_files_relative_to_the_authorized_root() {
    let root = tempfile::tempdir().expect("root");
    std::fs::create_dir(root.path().join("src")).expect("src directory");
    std::fs::write(root.path().join("src/main.txt"), "authorized").expect("file fixture");

    let opened = open_authorized_file(root.path(), "src/main.txt", SymlinkPolicy::FollowWithinRoot)
        .expect("authorized file");

    assert!(opened.metadata().is_file());
    assert_eq!(opened.resolved_path(), Path::new("src/main.txt"));
    assert_eq!(read(opened), "authorized");
}

#[cfg(unix)]
#[test]
fn preserves_inside_root_symlink_preview_behavior() {
    let root = tempfile::tempdir().expect("root");
    std::fs::create_dir(root.path().join("actual")).expect("actual directory");
    std::fs::write(root.path().join("actual/file.txt"), "inside").expect("file fixture");
    std::os::unix::fs::symlink("actual", root.path().join("relative-link"))
        .expect("relative symlink");
    std::os::unix::fs::symlink(
        root.path().join("actual/file.txt"),
        root.path().join("absolute-link"),
    )
    .expect("absolute symlink");

    for path in ["relative-link/file.txt", "absolute-link"] {
        let opened = open_authorized_file(root.path(), path, SymlinkPolicy::FollowWithinRoot)
            .expect("inside-root symlink remains readable");
        assert_eq!(opened.resolved_path(), Path::new("actual/file.txt"));
        assert_eq!(read(opened), "inside", "preview through {path}");
    }
}

#[cfg(unix)]
#[test]
fn rejects_symlinks_that_resolve_outside_the_authorized_root() {
    let root = tempfile::tempdir().expect("root");
    let outside = tempfile::tempdir().expect("outside");
    std::fs::write(outside.path().join("secret.txt"), "outside").expect("outside fixture");
    std::os::unix::fs::symlink(outside.path(), root.path().join("escape"))
        .expect("outside symlink");

    let error = open_authorized_file(
        root.path(),
        "escape/secret.txt",
        SymlinkPolicy::FollowWithinRoot,
    )
    .expect_err("outside-root symlink must be rejected");

    assert_eq!(error.kind(), AuthorizedOpenErrorKind::Forbidden);
}

#[cfg(unix)]
#[test]
fn component_replacement_cannot_redirect_the_open_outside_the_root() {
    let root = tempfile::tempdir().expect("root");
    let outside = tempfile::tempdir().expect("outside");
    std::fs::create_dir(root.path().join("nested")).expect("nested directory");
    std::fs::write(root.path().join("nested/file.txt"), "inside").expect("inside fixture");
    std::fs::write(outside.path().join("file.txt"), "outside").expect("outside fixture");

    let result = open_authorized_file_with_hook(
        root.path(),
        "nested/file.txt",
        SymlinkPolicy::FollowWithinRoot,
        || {
            std::fs::rename(root.path().join("nested"), root.path().join("original"))
                .expect("move authorized component");
            std::os::unix::fs::symlink(outside.path(), root.path().join("nested"))
                .expect("replace component with outside symlink");
        },
    );

    match result {
        Ok(opened) => assert_ne!(read(opened), "outside"),
        Err(error) => assert!(matches!(
            error.kind(),
            AuthorizedOpenErrorKind::Forbidden | AuthorizedOpenErrorKind::BadRequest
        )),
    }
}

#[cfg(unix)]
#[test]
fn deny_policy_rejects_even_inside_root_symlinks() {
    let root = tempfile::tempdir().expect("root");
    std::fs::write(root.path().join("actual.txt"), "inside").expect("file fixture");
    std::os::unix::fs::symlink("actual.txt", root.path().join("linked.txt"))
        .expect("inside symlink");

    let error = open_authorized_file(root.path(), "linked.txt", SymlinkPolicy::Deny)
        .expect_err("strict document policy must reject symlinks");

    assert_eq!(error.kind(), AuthorizedOpenErrorKind::Forbidden);
}

#[cfg(unix)]
#[test]
fn rejects_fifo_without_waiting_for_a_writer() {
    use std::os::unix::ffi::OsStrExt;

    let root = tempfile::tempdir().expect("root");
    let fifo = root.path().join("preview.txt");
    let fifo_path = std::ffi::CString::new(fifo.as_os_str().as_bytes()).expect("fifo path");
    // SAFETY: fifo_path is a valid, NUL-terminated path and the mode is a valid permission mask.
    let result = unsafe { libc::mkfifo(fifo_path.as_ptr(), 0o600) };
    assert_eq!(result, 0, "create FIFO fixture");

    let started = std::time::Instant::now();
    let error = open_authorized_file(root.path(), "preview.txt", SymlinkPolicy::FollowWithinRoot)
        .expect_err("FIFO must not be opened as preview content");

    assert_eq!(error.kind(), AuthorizedOpenErrorKind::BadRequest);
    assert!(started.elapsed() < std::time::Duration::from_secs(1));
}

#[cfg(unix)]
#[test]
fn rejects_unix_socket_without_connecting() {
    let root = tempfile::tempdir().expect("root");
    let _listener = std::os::unix::net::UnixListener::bind(root.path().join("preview.sock"))
        .expect("socket fixture");

    let started = std::time::Instant::now();
    let error = open_authorized_file(root.path(), "preview.sock", SymlinkPolicy::FollowWithinRoot)
        .expect_err("socket must not be opened as preview content");

    assert_eq!(error.kind(), AuthorizedOpenErrorKind::BadRequest);
    assert!(started.elapsed() < std::time::Duration::from_secs(1));
}
