use openforge_session_host::CapacityKind;
use openforge_session_protocol::{Error, ResourceCapacity};
use serde_json::json;

#[test]
fn capacity_refusals_name_the_resource_without_terminal_payloads() {
    for (kind, name) in [
        (CapacityKind::FileDescriptors, "fileDescriptors"),
        (CapacityKind::ProcessSlots, "processSlots"),
        (CapacityKind::MemoryHeadroom, "memoryHeadroom"),
        (CapacityKind::CheckpointBytes, "checkpointBytes"),
        (CapacityKind::CheckpointTime, "checkpointTime"),
        (CapacityKind::RetainedHistory, "retainedHistory"),
        (CapacityKind::PtyDevices, "ptyDevices"),
    ] {
        let error = Error::CapacityExceeded(kind);
        let encoded = serde_json::to_value(&error).unwrap();
        assert_eq!(encoded, json!({"capacityExceeded": name}));
        assert_eq!(serde_json::from_value::<Error>(encoded).unwrap(), error);
    }

    let diagnostics = ResourceCapacity {
        open_descriptors: 792,
        descriptor_limit: 1024,
        occupied_processes: 410,
        process_limit: 1000,
        available_memory_bytes: 1_073_741_824,
        spawn_memory_reserve_bytes: 536_870_912,
        checkpoint_byte_limit: 33_554_432,
    };
    let value = serde_json::to_value(diagnostics).unwrap();
    assert_eq!(
        value,
        json!({
            "openDescriptors": 792,
            "descriptorLimit": 1024,
            "occupiedProcesses": 410,
            "processLimit": 1000,
            "availableMemoryBytes": 1_073_741_824,
            "spawnMemoryReserveBytes": 536_870_912,
            "checkpointByteLimit": 33_554_432
        })
    );
    assert!(!value.to_string().contains("input"));
    assert!(!value.to_string().contains("environment"));
}
