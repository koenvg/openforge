use openforge_session_host::{DaemonLifetimeId, PtyInstanceId};
use openforge_session_protocol::*;
use std::io::Cursor;

fn pty() -> PtyIdentity {
    PtyIdentity {
        installation: InstallationId::parse("valid-installation").unwrap(),
        lifetime: DaemonLifetimeId::parse("valid-lifetime").unwrap(),
        instance: PtyInstanceId::new(1).unwrap(),
    }
}

fn terminal_bytes(len: usize) -> Vec<u8> {
    (0..len).map(|index| (index % 256) as u8).collect()
}

fn frame<T: serde::Serialize>(body: T) -> Vec<u8> {
    let mut wire = Vec::new();
    write_frame(
        &mut wire,
        &Envelope {
            version: VERSION,
            body,
        },
    )
    .unwrap();
    wire
}

fn frame_json(wire: &[u8]) -> serde_json::Value {
    serde_json::from_slice(&wire[4..]).unwrap()
}

fn output_batch(bytes: usize) -> EventBatch {
    let events = (0..bytes / (64 * 1024))
        .map(|sequence| Event::Output {
            pty: pty(),
            sequence: sequence as u64,
            data: terminal_bytes(64 * 1024),
        })
        .collect();
    EventBatch {
        cursor: 8,
        gap: false,
        retained_bytes: bytes,
        events,
    }
}

#[test]
fn output_event_round_trips_as_base64_text() {
    let data = terminal_bytes(4096);
    let wire = frame(Event::Output {
        pty: pty(),
        sequence: 7,
        data: data.clone(),
    });

    assert!(frame_json(&wire)["body"]["data"].is_string());
    let Event::Output {
        pty: decoded_pty,
        sequence,
        data: decoded,
    } = read_frame::<_, Event>(&mut Cursor::new(wire)).unwrap()
    else {
        panic!("expected output event");
    };
    assert_eq!((decoded_pty, sequence, decoded), (pty(), 7, data));
}

#[test]
fn recovery_round_trips_every_byte_field_as_base64_text() {
    let recovery = Recovery {
        pty: pty(),
        watermark: 3,
        cursor: 4,
        portable_vt: b"\x1b[31mportable".to_vec(),
        compatibility_replay: terminal_bytes(300),
        continuation: Vec::new(),
    };
    let wire = frame(Ok::<_, Error>(Response::Recovery(recovery.clone())));

    let json = frame_json(&wire);
    for field in ["portableVt", "compatibilityReplay", "continuation"] {
        assert!(json["body"]["Ok"]["value"][field].is_string(), "{field}");
    }
    let Response::Recovery(decoded) =
        read_frame::<_, Result<Response, Error>>(&mut Cursor::new(wire))
            .unwrap()
            .unwrap()
    else {
        panic!("expected recovery");
    };
    assert_eq!(
        (
            decoded.pty,
            decoded.watermark,
            decoded.cursor,
            decoded.portable_vt,
            decoded.compatibility_replay,
            decoded.continuation,
        ),
        (
            recovery.pty,
            recovery.watermark,
            recovery.cursor,
            recovery.portable_vt,
            recovery.compatibility_replay,
            recovery.continuation,
        )
    );
}

#[test]
fn input_write_round_trips_as_base64_text() {
    let request = Request {
        token: "fixture".into(),
        command: Command::Io {
            controller: Controller {
                installation: InstallationId::parse("valid-installation").unwrap(),
                lifetime: DaemonLifetimeId::parse("valid-lifetime").unwrap(),
                generation: openforge_session_host::ControllerGeneration::new(1).unwrap(),
            },
            operation: OperationId::parse("input-1").unwrap(),
            pty: pty(),
            sequence: 2,
            action: IoAction::Write(b"paste\x00\xff".to_vec()),
        },
    };
    let wire = frame(request);

    assert!(frame_json(&wire)["body"]["command"]["action"]["value"].is_string());
    let decoded = read_frame::<_, Request>(&mut Cursor::new(wire)).unwrap();
    assert!(matches!(
        decoded.command,
        Command::Io { action: IoAction::Write(bytes), .. } if bytes == b"paste\x00\xff"
    ));
}

#[test]
fn byte_fields_outside_frames_keep_the_persisted_number_array_format() {
    let action = IoAction::Write(b"hi".to_vec());
    let persisted = serde_json::to_value(&action).unwrap();

    assert_eq!(
        persisted,
        serde_json::json!({"kind": "write", "value": [104, 105]})
    );
    assert!(serde_json::from_value::<IoAction>(persisted).unwrap() == action);
}

#[test]
fn invalid_base64_byte_fields_are_refused() {
    let mut wire = frame(Event::Output {
        pty: pty(),
        sequence: 1,
        data: b"ok".to_vec(),
    });
    let mut json = frame_json(&wire);
    json["body"]["data"] = "not base64!".into();
    let body = serde_json::to_vec(&json).unwrap();
    wire = (body.len() as u32).to_be_bytes().to_vec();
    wire.extend(body);

    assert!(matches!(
        read_frame::<_, Event>(&mut Cursor::new(wire)),
        Err(Error::InvalidRequest)
    ));
}

#[test]
fn half_mebibyte_output_batch_frame_shrinks_from_number_arrays_to_base64() {
    let batch = Ok::<_, Error>(Response::Events(output_batch(512 * 1024)));
    let number_array_frame = serde_json::to_vec(&Envelope {
        version: VERSION,
        body: &batch,
    })
    .unwrap()
    .len();
    let base64_frame = frame(&batch).len();

    eprintln!(
        "512 KiB output batch: number arrays {number_array_frame} B, base64 {base64_frame} B"
    );
    assert!(number_array_frame > 3 * 512 * 1024);
    assert!(base64_frame < 512 * 1024 * 4 / 3 + 4096);
}
