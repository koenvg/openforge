use openforge_session_client::{runtime::RuntimeDirectory, Client};
use openforge_session_protocol::Error;
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::PermissionsExt;

#[test]
fn daemon_launches_when_the_durable_runtime_path_is_too_long_for_a_unix_socket() {
    let root = tempfile::Builder::new()
        .prefix(&"long-openforge-app-data-".repeat(6))
        .tempdir_in("/tmp")
        .unwrap();
    let executable = std::path::Path::new(env!("CARGO_BIN_EXE_openforge-session-daemon"));

    let client = Client::launch(executable, root.path()).unwrap_or_else(|error| {
        let log =
            std::fs::read_to_string(root.path().join("session-v1/daemon.log")).unwrap_or_default();
        panic!("daemon launch failed: {error}\n{log}");
    });
    let runtime = RuntimeDirectory::open_existing(root.path()).unwrap();
    let legacy_socket = runtime.path().join("control.sock");

    assert!(legacy_socket.as_os_str().as_bytes().len() >= 104);
    assert_ne!(runtime.socket_path(), legacy_socket);
    assert!(runtime.path().join("credentials.json").is_file());
    assert!(runtime.path().join("daemon.log").is_file());
    assert!(client.inventory().is_ok());
    client.shutdown_empty().unwrap();
    std::fs::remove_dir(runtime.socket_path().parent().unwrap()).unwrap();
}

#[test]
fn daemon_keeps_the_existing_socket_location_when_it_fits() {
    let root = tempfile::Builder::new()
        .prefix("of-short-")
        .tempdir_in("/tmp")
        .unwrap();
    let executable = std::path::Path::new(env!("CARGO_BIN_EXE_openforge-session-daemon"));

    let client = Client::launch(executable, root.path()).unwrap();
    let runtime = RuntimeDirectory::open_existing(root.path()).unwrap();

    assert_eq!(runtime.socket_path(), runtime.path().join("control.sock"));
    client.shutdown_empty().unwrap();
}

#[test]
fn long_runtime_path_rejects_an_unsafe_installation_socket_directory() {
    let root = tempfile::Builder::new()
        .prefix(&"long-openforge-app-data-".repeat(6))
        .tempdir_in("/tmp")
        .unwrap();
    let runtime = RuntimeDirectory::open(root.path()).unwrap();
    let socket_directory = runtime.socket_path().parent().unwrap().to_path_buf();
    std::fs::remove_dir(&socket_directory).unwrap();
    std::fs::create_dir(&socket_directory).unwrap();
    std::fs::set_permissions(&socket_directory, std::fs::Permissions::from_mode(0o755)).unwrap();

    let result = RuntimeDirectory::open(root.path());
    std::fs::remove_dir(&socket_directory).unwrap();

    assert!(matches!(result, Err(Error::Unauthorized)));
}
