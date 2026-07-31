use mdns_sd::{ServiceDaemon, ServiceInfo};
use std::{net::IpAddr, time::Duration};

pub(crate) const COMPANION_SERVICE_TYPE: &str = "_openforge._tcp.local.";
const ADVERTISEMENT_STOP_TIMEOUT: Duration = Duration::from_millis(250);

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CompanionAdvertisement {
    pub(crate) host_id: String,
    pub(crate) protocol_version: u8,
    pub(crate) addresses: Vec<IpAddr>,
    pub(crate) port: u16,
}

pub(crate) trait CompanionAdvertisementHandle: Send {}

pub(crate) trait CompanionAdvertiser: Send + Sync {
    fn advertise(
        &self,
        advertisement: CompanionAdvertisement,
    ) -> Result<Box<dyn CompanionAdvertisementHandle>, String>;
}

pub(crate) struct MdnsCompanionAdvertiser;

impl CompanionAdvertiser for MdnsCompanionAdvertiser {
    fn advertise(
        &self,
        advertisement: CompanionAdvertisement,
    ) -> Result<Box<dyn CompanionAdvertisementHandle>, String> {
        let service = create_service_info(&advertisement)?;
        let daemon = ServiceDaemon::new()
            .map_err(|error| format!("failed to start Companion mDNS daemon: {error}"))?;
        let fullname = service.get_fullname().to_string();
        if let Err(error) = daemon.register(service) {
            let _ = daemon.shutdown();
            return Err(format!("failed to advertise Companion Gateway: {error}"));
        }

        Ok(Box::new(MdnsCompanionAdvertisement {
            daemon: Some(daemon),
            fullname,
        }))
    }
}

fn create_service_info(advertisement: &CompanionAdvertisement) -> Result<ServiceInfo, String> {
    let instance_suffix: String = advertisement.host_id.chars().take(8).collect();
    let instance_name = format!("OpenForge-{instance_suffix}");
    let hostname = format!("openforge-{}.local.", advertisement.host_id);
    let protocol_version = advertisement.protocol_version.to_string();
    let properties = [
        ("hostId", advertisement.host_id.as_str()),
        ("protocolVersion", protocol_version.as_str()),
    ];
    ServiceInfo::new(
        COMPANION_SERVICE_TYPE,
        &instance_name,
        &hostname,
        advertisement.addresses.as_slice(),
        advertisement.port,
        &properties[..],
    )
    .map_err(|error| format!("failed to create Companion mDNS service: {error}"))
}

struct MdnsCompanionAdvertisement {
    daemon: Option<ServiceDaemon>,
    fullname: String,
}

impl CompanionAdvertisementHandle for MdnsCompanionAdvertisement {}

impl Drop for MdnsCompanionAdvertisement {
    fn drop(&mut self) {
        let Some(daemon) = self.daemon.take() else {
            return;
        };
        if let Ok(unregistered) = daemon.unregister(&self.fullname) {
            let _ = unregistered.recv_timeout(ADVERTISEMENT_STOP_TIMEOUT);
        }
        if let Ok(shutdown) = daemon.shutdown() {
            let _ = shutdown.recv_timeout(ADVERTISEMENT_STOP_TIMEOUT);
        }
    }
}

#[cfg(test)]
pub(crate) struct NoopCompanionAdvertiser;

#[cfg(test)]
impl CompanionAdvertiser for NoopCompanionAdvertiser {
    fn advertise(
        &self,
        _advertisement: CompanionAdvertisement,
    ) -> Result<Box<dyn CompanionAdvertisementHandle>, String> {
        Ok(Box::new(NoopCompanionAdvertisement))
    }
}

#[cfg(test)]
struct NoopCompanionAdvertisement;

#[cfg(test)]
impl CompanionAdvertisementHandle for NoopCompanionAdvertisement {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discovery_record_exposes_only_endpoint_selection_metadata() {
        let service = create_service_info(&CompanionAdvertisement {
            host_id: "65d91f21-6732-45a6-9418-3dfaf4c93f52".to_string(),
            protocol_version: 1,
            addresses: vec!["192.168.1.20".parse().expect("test IP")],
            port: 17_424,
        })
        .expect("service record");
        let properties = service.get_properties();

        assert_eq!(properties.len(), 2);
        assert_eq!(
            service.get_property_val_str("hostId"),
            Some("65d91f21-6732-45a6-9418-3dfaf4c93f52")
        );
        assert_eq!(service.get_property_val_str("protocolVersion"), Some("1"));
        for forbidden in [
            "certificate",
            "credential",
            "token",
            "task",
            "handoff",
            "secret",
        ] {
            assert!(
                properties
                    .iter()
                    .all(|property| !property.key().to_lowercase().contains(forbidden)),
                "mDNS must not expose {forbidden} metadata"
            );
        }
    }
}
