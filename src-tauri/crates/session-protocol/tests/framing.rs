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
fn terminal_color_profile_command_uses_the_versioned_camel_case_contract() {
    let profile =
        serde_json::to_value(openforge_session_host::TerminalColorProfile::default()).unwrap();
    let command = serde_json::json!({
        "token": "fixture",
        "command": {
            "kind": "setTerminalColorProfile",
            "controller": {
                "installation": "valid-installation",
                "lifetime": "valid-lifetime",
                "generation": 1
            },
            "operation": "profile-1",
            "profile": profile
        }
    });
    let mut wire = Vec::new();
    write_frame(
        &mut wire,
        &Envelope {
            version: openforge_session_protocol::VERSION,
            body: command.clone(),
        },
    )
    .unwrap();
    let request = read_frame::<_, openforge_session_protocol::Request>(&mut Cursor::new(wire));
    assert!(matches!(
        request.unwrap().command,
        openforge_session_protocol::Command::SetTerminalColorProfile { .. }
    ));

    for invalid in [
        {
            let mut value = command.clone();
            value["command"]["profile"]["version"] = 2.into();
            value
        },
        {
            let mut value = command.clone();
            value["command"]["profile"]["foreground"]["red"] = 256.into();
            value
        },
        {
            let mut value = command;
            value["command"]["profile"]["ansi_colors"] =
                value["command"]["profile"]["ansiColors"].take();
            value
        },
    ] {
        let mut wire = Vec::new();
        write_frame(
            &mut wire,
            &Envelope {
                version: openforge_session_protocol::VERSION,
                body: invalid,
            },
        )
        .unwrap();
        assert!(matches!(
            read_frame::<_, openforge_session_protocol::Request>(&mut Cursor::new(wire)),
            Err(Error::InvalidRequest)
        ));
    }
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
