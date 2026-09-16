use openforge_session_protocol::{read_frame, write_frame, Envelope, Error, MAX_FRAME_BYTES};
use std::io::Cursor;

#[test]
fn local_protocol_refuses_unknown_versions_and_oversized_frames_before_payload_allocation() {
    // v1 lacks authoritative owner metadata; reject it as well as future versions.
    for version in [1, openforge_session_protocol::VERSION + 1] {
        let mut wire = Vec::new();
        write_frame(
            &mut wire,
            &Envelope {
                version,
                body: "connect",
            },
        )
        .unwrap();
        assert!(matches!(
            read_frame::<_, String>(&mut Cursor::new(wire)),
            Err(Error::Version)
        ));
    }
    let mut oversized = Cursor::new(((MAX_FRAME_BYTES + 1) as u32).to_be_bytes());
    assert!(matches!(
        read_frame::<_, String>(&mut oversized),
        Err(Error::Capacity)
    ));
}

#[test]
fn wire_requests_use_the_shared_validated_identities() {
    for (installation, generation) in [("invalid namespace", 1), ("valid-installation", 0)] {
        let mut wire = Vec::new();
        write_frame(&mut wire, &Envelope {
            version: openforge_session_protocol::VERSION,
            body: serde_json::json!({"token":"fixture", "command":{"kind":"inventory", "controller":{
                "installation":installation, "lifetime":"valid-lifetime", "generation":generation,
            }}}),
        }).unwrap();
        assert!(matches!(
            read_frame::<_, openforge_session_protocol::Request>(&mut Cursor::new(wire)),
            Err(Error::InvalidRequest)
        ));
    }
}
