use openforge_session_client::{runtime::RuntimeDirectory, Client};
use openforge_session_protocol::{Error, VERSION};
use std::{
    io::{Read, Write},
    os::unix::{fs::PermissionsExt, net::UnixListener},
};

#[test]
fn a_daemon_on_the_previous_protocol_is_reported_as_incompatible_not_unknown_outcome() {
    let root = tempfile::Builder::new()
        .prefix("of-client-version-")
        .tempdir_in("/tmp")
        .unwrap();
    let runtime = RuntimeDirectory::open(root.path()).unwrap();
    let listener = UnixListener::bind(runtime.socket_path()).unwrap();
    std::fs::set_permissions(
        runtime.socket_path(),
        std::fs::Permissions::from_mode(0o600),
    )
    .unwrap();
    let daemon = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut size = [0; 4];
        stream.read_exact(&mut size).unwrap();
        let mut request = vec![0; u32::from_be_bytes(size) as usize];
        stream.read_exact(&mut request).unwrap();
        let reply = format!(
            r#"{{"version":{},"body":{{"Err":"version"}}}}"#,
            VERSION - 1
        );
        stream
            .write_all(&(reply.len() as u32).to_be_bytes())
            .unwrap();
        stream.write_all(reply.as_bytes()).unwrap();
    });

    assert!(matches!(Client::connect(root.path()), Err(Error::Version)));
    daemon.join().unwrap();
}
