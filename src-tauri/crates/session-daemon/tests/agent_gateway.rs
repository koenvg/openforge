#[path = "support/agent_gateway.rs"]
mod support;

#[path = "agent_gateway/authenticated_forwarding.rs"]
mod authenticated_forwarding;
#[path = "agent_gateway/http_ingress_rejection.rs"]
mod http_ingress_rejection;
#[path = "agent_gateway/lifecycle_notifications.rs"]
mod lifecycle_notifications;
