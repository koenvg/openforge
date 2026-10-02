//! Public startup evidence boundary. Ordinary ownership alone grants no update authority.
use serde_json::json;

#[test]
fn a_guard_or_restored_file_cannot_supply_missing_in_memory_birth_evidence() {
    let request = json!({"challenge":"a".repeat(64), "installation":"installation-one",
        "operation":"operation-one", "manifestSha256":"b".repeat(64),
        "recoveryRoot":"/private/missing", "controller":null});
    assert!(
        openforge_update_helper::source_attestation(&request, "c".repeat(64).as_str()).is_err()
    );
    assert!(!openforge_update_helper::source_attestation_available());
}

#[cfg(all(target_os = "macos", feature = "test-fixtures"))]
mod native {
    #[allow(dead_code)]
    mod common {
        include!("common/mod.rs");
    }
    #[test]
    fn eligible_original_app_and_owned_sidecar_can_prepare_and_cancel() {
        for scenario in ["", "recover-live", "pipe-loss", "arm-exited"] {
            let source =
                std::fs::read(env!("CARGO_BIN_EXE_openforge-update-source-fixture")).unwrap();
            let fixture = common::Fixture::with_target_bytes(
                &std::fs::read(env!("CARGO_BIN_EXE_openforge-update-helper")).unwrap(),
            );
            for name in [
                "Open Forge",
                "openforge-sidecar",
                "openforge-session-daemon",
                "openforge-update-helper",
            ] {
                std::fs::write(
                    fixture.destination.join("Contents/MacOS").join(name),
                    &source,
                )
                .unwrap();
            }
            let root = fixture.destination.parent().unwrap();
            std::fs::copy(
                env!("CARGO_BIN_EXE_openforge-update-helper"),
                root.join("private-helper"),
            )
            .unwrap();
            let output =
                std::process::Command::new(fixture.destination.join("Contents/MacOS/Open Forge"))
                    .arg(root)
                    .arg(scenario)
                    .env_clear()
                    .output()
                    .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
            assert!(String::from_utf8_lossy(&output.stdout).contains("prepared"));
            let expected = match scenario {
                "" => "cancelled",
                "recover-live" => "preparation-recovered",
                "pipe-loss" => "refused",
                "arm-exited" => "armed",
                _ => unreachable!(),
            };
            assert!(
                String::from_utf8_lossy(&output.stdout).contains(expected),
                "{scenario}: {}",
                String::from_utf8_lossy(&output.stdout)
            );
            assert!(fixture.bundle.exists());
            let mut recovery = openforge_update_helper::InstallTransaction::open(
                &fixture.state,
                "installation-one",
                &fixture.destination,
            )
            .unwrap();
            if scenario == "arm-exited" {
                assert!(recovery
                    .recover("operation-one")
                    .unwrap_err()
                    .contains("unknown"));
            } else {
                assert_eq!(
                    recovery.recover("operation-one").unwrap(),
                    openforge_update_helper::Phase::RolledBack
                );
            }
        }
    }
    #[test]
    fn refuses_tampering_changed_lifetimes_images_and_replayed_source_authority() {
        for scenario in [
            "guard-only",
            "wrong-key",
            "wrong-process",
            "tamper",
            "source-loss",
            "wrong-app",
            "changed-birth",
            "wrong-image",
            "wrong-roots",
            "stale-challenge",
            "wrong-operation",
            "exec-after-proof",
            "lose-after-prepared",
            "arm-live",
            "recover-source-loss",
            "recover-missing-source",
            "recover-reused-birth",
            "recover-stale-boot",
            "recover-replayed-operation",
            "recover-tamper",
        ] {
            let source =
                std::fs::read(env!("CARGO_BIN_EXE_openforge-update-source-fixture")).unwrap();
            let fixture = common::Fixture::with_target_bytes(
                &std::fs::read(env!("CARGO_BIN_EXE_openforge-update-helper")).unwrap(),
            );
            for name in [
                "Open Forge",
                "openforge-sidecar",
                "openforge-session-daemon",
                "openforge-update-helper",
            ] {
                std::fs::write(
                    fixture.destination.join("Contents/MacOS").join(name),
                    &source,
                )
                .unwrap();
            }
            let root = fixture.destination.parent().unwrap();
            std::fs::copy(
                env!("CARGO_BIN_EXE_openforge-update-helper"),
                root.join("private-helper"),
            )
            .unwrap();
            let output =
                std::process::Command::new(fixture.destination.join("Contents/MacOS/Open Forge"))
                    .arg(root)
                    .arg(scenario)
                    .env_clear()
                    .output()
                    .unwrap();
            assert!(
                output.status.success(),
                "{scenario}: {}",
                String::from_utf8_lossy(&output.stderr)
            );
            assert!(
                String::from_utf8_lossy(&output.stdout).contains("refused"),
                "{scenario}: {}",
                String::from_utf8_lossy(&output.stdout)
            );
            if !scenario.starts_with("recover-")
                && !matches!(scenario, "lose-after-prepared" | "arm-live")
            {
                assert!(!fixture.state.join("current.json").exists(), "{scenario}");
            }
            assert!(fixture.bundle.exists(), "{scenario}");
        }
    }
}
