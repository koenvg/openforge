use openforge_session_host::*;
use std::sync::{Arc, Mutex};

#[test]
fn terminal_color_profile_light_fallback_and_xterm_extended_palette_are_stable() {
    let profile = TerminalColorProfile::default();
    assert_eq!(profile.version, 1);
    assert_eq!(profile.background, TerminalRgbColor::new(255, 255, 255));
    assert_eq!(profile.foreground, TerminalRgbColor::new(32, 32, 32));
    assert_eq!(profile.ansi_colors.len(), 16);

    let palette = profile.xterm_palette();
    assert_eq!(palette[0], TerminalRgbColor::new(32, 32, 32));
    assert_eq!(palette[16], TerminalRgbColor::new(0, 0, 0));
    assert_eq!(palette[17], TerminalRgbColor::new(0, 0, 95));
    assert_eq!(palette[231], TerminalRgbColor::new(255, 255, 255));
    assert_eq!(palette[232], TerminalRgbColor::new(8, 8, 8));
    assert_eq!(palette[255], TerminalRgbColor::new(238, 238, 238));
}

#[test]
fn terminal_color_profile_json_is_camel_case_and_rejects_invalid_contracts() {
    let profile = TerminalColorProfile::default();
    let value = serde_json::to_value(profile).unwrap();
    assert!(value.get("ansiColors").is_some());
    assert!(value.get("ansi_colors").is_none());

    let mut wrong_version = value.clone();
    wrong_version["version"] = 2.into();
    assert!(serde_json::from_value::<TerminalColorProfile>(wrong_version).is_err());

    let mut short_palette = value.clone();
    short_palette["ansiColors"] = serde_json::json!([]);
    assert!(serde_json::from_value::<TerminalColorProfile>(short_palette).is_err());

    let mut invalid_channel = value;
    invalid_channel["foreground"]["red"] = 256.into();
    assert!(serde_json::from_value::<TerminalColorProfile>(invalid_channel).is_err());
}

#[derive(Clone, Default)]
struct ProfileBackend(Arc<Mutex<Vec<TerminalColorProfile>>>);

impl HostBackend for ProfileBackend {
    async fn inventory(&self) -> Result<Vec<BackendSession>, HostError> {
        Ok(Vec::new())
    }

    async fn set_terminal_color_profile(
        &self,
        profile: TerminalColorProfile,
    ) -> Result<(), HostError> {
        self.0.lock().unwrap().push(profile);
        Ok(())
    }

    async fn spawn_prepared(&self, _request: &SpawnRequest) -> Result<PtyInstanceId, HostError> {
        unreachable!()
    }

    async fn terminate_exact(&self, _session: &HostedSession) -> Result<(), HostError> {
        unreachable!()
    }

    async fn attach(&self, _session: &HostedSession) -> Result<BackendAttachment, HostError> {
        unreachable!()
    }

    async fn operate(&self, _session: &HostedSession, _action: &IoAction) -> Result<(), HostError> {
        unreachable!()
    }
}

#[tokio::test]
async fn profile_mutation_is_retry_safe_conflict_checked_and_controller_fenced() {
    let installation = InstallationId::parse("profile-installation").unwrap();
    let backend = ProfileBackend::default();
    let host = InProcessHost::new(
        backend.clone(),
        installation.clone(),
        Arc::new(tokio::sync::Mutex::new(HostState::new())),
    );
    let first = host.connect(&installation).await.unwrap().controller;
    let profile = TerminalColorProfile {
        foreground: TerminalRgbColor::new(1, 2, 3),
        ..TerminalColorProfile::default()
    };
    let operation = OperationId::parse("profile-1").unwrap();

    host.set_terminal_color_profile(&first, operation.clone(), profile)
        .await
        .unwrap();
    host.set_terminal_color_profile(&first, operation.clone(), profile)
        .await
        .unwrap();
    assert_eq!(backend.0.lock().unwrap().as_slice(), [profile]);

    let mut conflicting = profile;
    conflicting.background = TerminalRgbColor::new(4, 5, 6);
    assert_eq!(
        host.set_terminal_color_profile(&first, operation, conflicting)
            .await,
        Err(HostError::OperationConflict)
    );

    let current = host.connect(&installation).await.unwrap().controller;
    assert_eq!(
        host.set_terminal_color_profile(
            &first,
            OperationId::parse("stale-profile").unwrap(),
            profile,
        )
        .await,
        Err(HostError::StaleController)
    );
    host.set_terminal_color_profile(&current, OperationId::parse("profile-2").unwrap(), profile)
        .await
        .unwrap();
}

#[tokio::test]
async fn programmatic_profile_version_is_validated_before_backend_mutation() {
    let installation = InstallationId::parse("profile-validation").unwrap();
    let backend = ProfileBackend::default();
    let host = InProcessHost::new(
        backend.clone(),
        installation.clone(),
        Arc::new(tokio::sync::Mutex::new(HostState::new())),
    );
    let controller = host.connect(&installation).await.unwrap().controller;
    let profile = TerminalColorProfile {
        version: 2,
        ..TerminalColorProfile::default()
    };

    assert_eq!(
        host.set_terminal_color_profile(
            &controller,
            OperationId::parse("invalid-profile").unwrap(),
            profile,
        )
        .await,
        Err(HostError::InvalidRequest(
            "unsupported terminal color profile version"
        ))
    );
    assert!(backend.0.lock().unwrap().is_empty());
}
