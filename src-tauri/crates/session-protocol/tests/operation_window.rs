use openforge_session_host::{
    CapacityKind, ControllerGeneration, DaemonLifetimeId, OperationWindow,
};
use openforge_session_protocol::*;

fn controller() -> Controller {
    Controller {
        installation: InstallationId::parse("protocol-window").unwrap(),
        lifetime: DaemonLifetimeId::parse("protocol-lifetime").unwrap(),
        generation: ControllerGeneration::new(1).unwrap(),
    }
}

#[test]
fn stream_commands_and_capacity_reasons_round_trip_without_payloads() {
    let commands = [
        Command::OpenOperationStream {
            controller: controller(),
        },
        Command::AcknowledgeOperations {
            controller: controller(),
            stream: 1,
            through: 42,
        },
    ];
    for command in commands {
        let mut bytes = Vec::new();
        write_frame(
            &mut bytes,
            &Envelope {
                version: VERSION,
                body: command.clone(),
            },
        )
        .unwrap();
        let decoded: Command = read_frame(&mut bytes.as_slice()).unwrap();
        assert_eq!(
            serde_json::to_value(decoded).unwrap(),
            serde_json::to_value(command).unwrap()
        );
    }
    for kind in [
        CapacityKind::OperationReceipts,
        CapacityKind::RequestBytes,
        CapacityKind::Sessions,
    ] {
        let error = Error::CapacityExceeded(kind);
        let decoded: Error = serde_json::from_str(&serde_json::to_string(&error).unwrap()).unwrap();
        assert_eq!(decoded, error);
        let host: openforge_session_host::HostError = decoded.into();
        assert_eq!(Error::from(host), error);
    }
    let expired: Error = openforge_session_host::HostError::OperationExpired.into();
    assert_eq!(expired, Error::OperationExpired);
    let response = Response::OperationWindow(OperationWindow {
        stream: 1,
        retired_through: 30,
        admitted_through: 32,
    });
    let json = serde_json::to_value(response).unwrap();
    assert_eq!(
        json,
        serde_json::json!({"kind":"operationWindow","value":{"stream":1,"retiredThrough":30,"admittedThrough":32}})
    );
}

#[test]
fn invalid_acknowledgement_shapes_and_versions_are_rejected() {
    let mut value = serde_json::to_value(Command::AcknowledgeOperations {
        controller: controller(),
        stream: 1,
        through: 2,
    })
    .unwrap();
    value["through"] = serde_json::json!(-1);
    assert!(serde_json::from_value::<Command>(value.clone()).is_err());
    value["through"] = serde_json::json!(2);
    value["input"] = serde_json::json!("must-not-be-an-ack-payload");
    assert!(serde_json::from_value::<Command>(value).is_err());
    let mut bytes = Vec::new();
    write_frame(
        &mut bytes,
        &Envelope {
            version: VERSION + 1,
            body: Command::OpenOperationStream {
                controller: controller(),
            },
        },
    )
    .unwrap();
    assert!(matches!(
        read_frame::<_, Command>(&mut bytes.as_slice()),
        Err(Error::Version)
    ));
}
