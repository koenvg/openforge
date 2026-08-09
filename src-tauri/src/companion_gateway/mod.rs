mod advertisement;
mod attention;
mod contract;
mod devices;
mod identity;
mod identity_lifecycle;
mod lifecycle;
mod listener_runtime;
mod live_events;
mod network;
mod pairing;
mod project_board;
mod rate_limit;
mod stream_termination;
mod tailscale;
mod task_actions;
mod task_detail;
mod terminal;
mod terminal_protocol;
#[cfg(test)]
mod terminal_protocol_tests;
mod trust_policy;

pub(crate) const COMPANION_GATEWAY_ENABLED_CONFIG: &str = "companion_gateway_enabled";
pub(crate) const COMPANION_TAILSCALE_HOSTNAME_CONFIG: &str =
    "companion_tailscale_magicdns_hostname";

pub(crate) fn enabled_preference(database: &crate::db::Database) -> Result<bool, String> {
    database
        .get_config(COMPANION_GATEWAY_ENABLED_CONFIG)
        .map(|value| value.is_some_and(|value| value == "true"))
        .map_err(|error| format!("failed to read Companion Gateway preference: {error}"))
}

pub(crate) fn tailscale_hostname_preference(
    database: &crate::db::Database,
) -> Result<Option<String>, String> {
    database
        .get_config(COMPANION_TAILSCALE_HOSTNAME_CONFIG)
        .map_err(|error| format!("failed to read Companion Tailscale hostname: {error}"))?
        .map(|hostname| tailscale::normalize_magicdns_hostname(&hostname))
        .transpose()
}

pub(crate) use lifecycle::CompanionGatewayManager;
pub(crate) use pairing::PairingDecision;
pub(crate) use tailscale::normalize_magicdns_hostname;

#[cfg(test)]
fn test_manager_with_store(
    store: std::sync::Arc<dyn identity::CompanionIdentityStore>,
) -> CompanionGatewayManager {
    use std::{net::IpAddr, sync::Arc};

    CompanionGatewayManager::new(
        store,
        Arc::new(devices::InMemoryCompanionDeviceStore::default()),
        Arc::new(network::FixedEndpointProvider::new(vec![(
            network::CompanionEndpointKind::Lan,
            IpAddr::V4(std::net::Ipv4Addr::LOCALHOST),
        )])),
        Arc::new(advertisement::NoopCompanionAdvertiser),
        0,
    )
}

#[cfg(test)]
pub(crate) fn test_manager() -> CompanionGatewayManager {
    test_manager_with_store(std::sync::Arc::new(
        identity::InMemoryIdentityStore::default(),
    ))
}

#[cfg(test)]
pub(crate) fn delayed_test_manager(delay: std::time::Duration) -> CompanionGatewayManager {
    test_manager_with_store(std::sync::Arc::new(identity::DelayedIdentityStore::new(
        delay,
    )))
}

#[cfg(test)]
pub(crate) fn non_cancelling_test_manager() -> (
    CompanionGatewayManager,
    tokio::sync::oneshot::Receiver<()>,
    std::sync::mpsc::Sender<()>,
) {
    let (store, entered, release) = identity::NonCancellingBlockingIdentityStore::new();
    (
        test_manager_with_store(std::sync::Arc::new(store)),
        entered,
        release,
    )
}

#[cfg(test)]
mod attention_tests;
#[cfg(test)]
mod live_events_tests;
#[cfg(test)]
mod pairing_tests;
#[cfg(test)]
mod project_board_tests;
#[cfg(test)]
mod task_actions_tests;
#[cfg(test)]
mod task_detail_tests;
#[cfg(test)]
mod terminal_tests;
#[cfg(test)]
mod tests;
