use serde::{Deserialize, Serialize};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub(crate) enum CompanionEndpointKind {
    Lan,
    Tailscale,
}

pub(crate) trait CompanionEndpointProvider: Send + Sync {
    fn bind_endpoints(&self) -> Result<Vec<(CompanionEndpointKind, IpAddr)>, String>;
}

#[derive(Debug, Default)]
pub(crate) struct PrivateInterfaceEndpointProvider;

fn is_tailscale_ipv4(address: Ipv4Addr) -> bool {
    let octets = address.octets();
    octets[0] == 100 && (64..=127).contains(&octets[1])
}

fn is_tailscale_ipv6(address: Ipv6Addr) -> bool {
    let segments = address.segments();
    segments[0] == 0xfd7a && segments[1] == 0x115c && segments[2] == 0xa1e0
}

fn classify_private_address(address: IpAddr) -> Option<CompanionEndpointKind> {
    match address {
        IpAddr::V4(address) if is_tailscale_ipv4(address) => Some(CompanionEndpointKind::Tailscale),
        IpAddr::V4(address) if address.is_private() => Some(CompanionEndpointKind::Lan),
        IpAddr::V6(address) if is_tailscale_ipv6(address) => Some(CompanionEndpointKind::Tailscale),
        IpAddr::V6(address) if (address.segments()[0] & 0xfe00) == 0xfc00 => {
            Some(CompanionEndpointKind::Lan)
        }
        _ => None,
    }
}

impl CompanionEndpointProvider for PrivateInterfaceEndpointProvider {
    fn bind_endpoints(&self) -> Result<Vec<(CompanionEndpointKind, IpAddr)>, String> {
        let mut endpoints = if_addrs::get_if_addrs()
            .map_err(|error| format!("failed to inspect private network interfaces: {error}"))?
            .into_iter()
            .filter_map(|interface| {
                let address = interface.ip();
                classify_private_address(address).map(|kind| (kind, address))
            })
            .collect::<Vec<_>>();
        endpoints.sort_unstable();
        endpoints.dedup();

        if endpoints.is_empty() {
            return Err("No reachable private network interface is available".to_string());
        }
        Ok(endpoints)
    }
}

#[cfg(test)]
#[derive(Debug)]
pub(crate) struct FixedEndpointProvider {
    endpoints: Vec<(CompanionEndpointKind, IpAddr)>,
}

#[cfg(test)]
impl FixedEndpointProvider {
    pub(crate) fn new(endpoints: Vec<(CompanionEndpointKind, IpAddr)>) -> Self {
        Self { endpoints }
    }
}

#[cfg(test)]
impl CompanionEndpointProvider for FixedEndpointProvider {
    fn bind_endpoints(&self) -> Result<Vec<(CompanionEndpointKind, IpAddr)>, String> {
        Ok(self.endpoints.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_private_lan_and_tailscale_addresses_are_classified() {
        assert_eq!(
            classify_private_address(IpAddr::V4(Ipv4Addr::new(192, 168, 1, 8))),
            Some(CompanionEndpointKind::Lan)
        );
        assert_eq!(
            classify_private_address(IpAddr::V4(Ipv4Addr::new(100, 64, 4, 8))),
            Some(CompanionEndpointKind::Tailscale)
        );
        assert_eq!(
            classify_private_address(IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8))),
            None
        );
        assert_eq!(
            classify_private_address(IpAddr::V4(Ipv4Addr::LOCALHOST)),
            None
        );
    }
}
