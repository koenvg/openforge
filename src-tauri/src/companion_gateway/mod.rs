mod attention;
mod contract;
mod devices;
mod identity;
mod lifecycle;
mod network;
mod pairing;

pub(crate) const COMPANION_GATEWAY_ENABLED_CONFIG: &str = "companion_gateway_enabled";

pub(crate) fn enabled_preference(database: &crate::db::Database) -> Result<bool, String> {
    database
        .get_config(COMPANION_GATEWAY_ENABLED_CONFIG)
        .map(|value| value.is_some_and(|value| value == "true"))
        .map_err(|error| format!("failed to read Companion Gateway preference: {error}"))
}

pub(crate) use lifecycle::CompanionGatewayManager;
pub(crate) use pairing::PairingDecision;

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
mod attention_tests;
#[cfg(test)]
mod pairing_tests;
#[cfg(test)]
mod tests;
