use super::{
    contract::{CompanionAuthorizer, CompanionErrorCode},
    devices::{
        CompanionDeviceAuthentication, CompanionDeviceRecord, CompanionDeviceRevocationBatch,
        CompanionDeviceStore, CompanionPairedDevice,
    },
};
use axum::http::HeaderMap;
use base64::Engine;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, VecDeque},
    net::IpAddr,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use subtle::ConstantTimeEq;

const PAIRING_SUBMISSION_RATE_LIMIT: usize = 12;
const PAIRING_POLL_RATE_LIMIT: usize = 180;
const GLOBAL_PAIRING_SUBMISSION_RATE_LIMIT: usize = 256;
const GLOBAL_PAIRING_POLL_RATE_LIMIT: usize = 4_096;
const MAX_RATE_LIMIT_PEERS: usize = 1_024;
const PAIRING_RATE_WINDOW: Duration = Duration::from_secs(60);
const RETIRED_SECRET_LIMIT: usize = 32;
const MAX_DEVICE_NAME_LEN: usize = 80;

#[derive(Debug, Clone)]
pub(crate) struct PairingBootstrap {
    pub(crate) protocol_version: u8,
    pub(crate) host_id: String,
    pub(crate) certificate_sha256: String,
    pub(crate) endpoint_candidates: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PairingQrPayload {
    protocol_version: u8,
    host_id: String,
    certificate_sha256: String,
    endpoint_candidates: Vec<String>,
    one_time_secret: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PendingPairingRequest {
    pub(crate) request_id: String,
    pub(crate) device_name: String,
    pub(crate) platform: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PairingSessionStatus {
    pub(crate) session_id: String,
    pub(crate) expires_at: String,
    pub(crate) qr_payload: String,
    pub(crate) pending_request: Option<PendingPairingRequest>,
    pub(crate) delivery_pending: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PairingDecision {
    Approve,
    Reject,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PairingSubmission {
    pub(crate) secret: String,
    pub(crate) device_name: String,
    pub(crate) platform: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PairingSubmissionResponse {
    pub(crate) request_id: String,
    pub(crate) status: &'static str,
    pub(crate) expires_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PairingPollResponse {
    pub(crate) status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) device_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) credential: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PairingError {
    Invalid,
    Gone,
    Rejected,
    RateLimited,
    InvalidDevice,
    Unavailable,
}

struct PendingRequestState {
    request: PendingPairingRequest,
    outcome: PairingOutcome,
}

enum PairingOutcome {
    Pending,
    Rejected,
    Approved {
        device_id: String,
        credential: String,
    },
}

struct PairingSession {
    status: PairingSessionStatus,
    secret_verifier: [u8; 32],
    expires_at: Instant,
    request: Option<PendingRequestState>,
}

#[derive(Default)]
struct PairingState {
    session: Option<PairingSession>,
    retired_secret_verifiers: VecDeque<[u8; 32]>,
}

#[derive(Debug, Clone, Copy)]
pub(crate) enum PairingRequestKind {
    Submission,
    Poll,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CompanionAuthenticatedDevice {
    pub(crate) device_id: String,
}

/// Signals consumed by the canonical Companion SSE route so trust changes can
/// close only the affected device stream without coupling trust storage to HTTP.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum CompanionStreamTermination {
    DeviceRevoked { device_id: String },
    AllDevicesRevoked,
    GatewayClosing,
}

impl CompanionStreamTermination {
    pub(crate) fn terminates(&self, device_id: &str) -> bool {
        match self {
            Self::DeviceRevoked { device_id: revoked } => revoked == device_id,
            Self::AllDevicesRevoked | Self::GatewayClosing => true,
        }
    }
}

/// Authenticated stream principal plus a race-safe trust termination subscription.
#[allow(dead_code)] // Consumed by the canonical SSE route when KVG-2947 is integrated.
pub(crate) struct CompanionStreamAuthorization {
    principal: CompanionAuthenticatedDevice,
    terminations: tokio::sync::broadcast::Receiver<CompanionStreamTermination>,
}

#[allow(dead_code)] // Consumed by the canonical SSE route when KVG-2947 is integrated.
impl CompanionStreamAuthorization {
    pub(crate) fn device_id(&self) -> &str {
        &self.principal.device_id
    }

    pub(crate) async fn wait_for_termination(&mut self) -> CompanionStreamTermination {
        loop {
            match self.terminations.recv().await {
                Ok(termination) if termination.terminates(self.device_id()) => return termination,
                Ok(_) => {}
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    // Missing any trust event is unsafe. Force the stream closed so the
                    // client reconnects and authenticates against current device state.
                    return CompanionStreamTermination::AllDevicesRevoked;
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    return CompanionStreamTermination::GatewayClosing;
                }
            }
        }
    }
}

#[derive(Default)]
struct PairingRateLimits {
    submission_by_peer: HashMap<IpAddr, VecDeque<Instant>>,
    poll_by_peer: HashMap<IpAddr, VecDeque<Instant>>,
    global_submissions: VecDeque<Instant>,
    global_polls: VecDeque<Instant>,
}

pub(crate) struct PairingCoordinator {
    state: Mutex<PairingState>,
    rate_limits: Mutex<PairingRateLimits>,
    devices: Arc<dyn CompanionDeviceStore>,
    termination_tx: tokio::sync::broadcast::Sender<CompanionStreamTermination>,
    gateway_accepting_streams: std::sync::atomic::AtomicBool,
    ttl: Duration,
}

impl PairingCoordinator {
    pub(crate) fn new(devices: Arc<dyn CompanionDeviceStore>, ttl: Duration) -> Self {
        let (termination_tx, _) = tokio::sync::broadcast::channel(64);
        Self {
            state: Mutex::new(PairingState::default()),
            rate_limits: Mutex::new(PairingRateLimits::default()),
            devices,
            termination_tx,
            gateway_accepting_streams: std::sync::atomic::AtomicBool::new(false),
            ttl,
        }
    }

    pub(crate) fn start(
        &self,
        bootstrap: PairingBootstrap,
    ) -> Result<PairingSessionStatus, String> {
        let mut state = self.lock_state()?;
        expire_session(&mut state);
        if state.session.as_ref().is_some_and(|session| {
            session
                .request
                .as_ref()
                .is_some_and(|request| matches!(request.outcome, PairingOutcome::Approved { .. }))
        }) {
            return Err(
                "Approved Companion credential is still awaiting device delivery".to_string(),
            );
        }
        let secret = random_secret();
        let now = chrono::Utc::now();
        let expires_at = now
            + chrono::Duration::from_std(self.ttl)
                .map_err(|error| format!("invalid Companion pairing lifetime: {error}"))?;
        let status = PairingSessionStatus {
            session_id: uuid::Uuid::new_v4().to_string(),
            expires_at: expires_at.to_rfc3339(),
            qr_payload: serde_json::to_string(&PairingQrPayload {
                protocol_version: bootstrap.protocol_version,
                host_id: bootstrap.host_id,
                certificate_sha256: bootstrap.certificate_sha256,
                endpoint_candidates: bootstrap.endpoint_candidates,
                one_time_secret: secret.clone(),
            })
            .map_err(|error| format!("failed to encode Companion pairing QR: {error}"))?,
            pending_request: None,
            delivery_pending: false,
        };
        retire_current_session(&mut state);
        state.session = Some(PairingSession {
            status: status.clone(),
            secret_verifier: verifier(&secret),
            expires_at: Instant::now() + self.ttl,
            request: None,
        });
        Ok(status)
    }

    pub(crate) fn status(&self) -> Result<Option<PairingSessionStatus>, String> {
        let mut state = self.lock_state()?;
        expire_session(&mut state);
        Ok(state.session.as_ref().and_then(|session| {
            let mut status = session.status.clone();
            status.pending_request = match session.request.as_ref() {
                Some(pending) if matches!(pending.outcome, PairingOutcome::Pending) => {
                    Some(pending.request.clone())
                }
                Some(pending) if matches!(pending.outcome, PairingOutcome::Approved { .. }) => {
                    status.delivery_pending = true;
                    None
                }
                Some(_) => return None,
                None => None,
            };
            Some(status)
        }))
    }

    pub(crate) fn cancel(&self, session_id: &str) -> Result<(), String> {
        let mut state = self.lock_state()?;
        expire_session(&mut state);
        if state
            .session
            .as_ref()
            .is_some_and(|session| session.status.session_id == session_id)
        {
            retire_current_session(&mut state);
            return Ok(());
        }
        Err("Companion pairing session is no longer active".to_string())
    }

    pub(crate) fn clear(&self) -> Result<(), String> {
        let mut state = self.lock_state()?;
        retire_current_session(&mut state);
        Ok(())
    }

    pub(crate) fn admit_request(
        &self,
        peer: IpAddr,
        kind: PairingRequestKind,
    ) -> Result<(), PairingError> {
        let mut limits = self
            .rate_limits
            .lock()
            .map_err(|_| PairingError::Unavailable)?;
        match kind {
            PairingRequestKind::Submission => {
                let PairingRateLimits {
                    submission_by_peer,
                    global_submissions,
                    ..
                } = &mut *limits;
                admit_rate_limited_request(
                    submission_by_peer,
                    global_submissions,
                    peer,
                    PAIRING_SUBMISSION_RATE_LIMIT,
                    GLOBAL_PAIRING_SUBMISSION_RATE_LIMIT,
                )
            }
            PairingRequestKind::Poll => {
                let PairingRateLimits {
                    poll_by_peer,
                    global_polls,
                    ..
                } = &mut *limits;
                admit_rate_limited_request(
                    poll_by_peer,
                    global_polls,
                    peer,
                    PAIRING_POLL_RATE_LIMIT,
                    GLOBAL_PAIRING_POLL_RATE_LIMIT,
                )
            }
        }
    }

    pub(crate) fn submit(
        &self,
        submission: PairingSubmission,
    ) -> Result<PairingSubmissionResponse, PairingError> {
        validate_device(&submission.device_name, &submission.platform)?;
        if !valid_secret(&submission.secret) {
            return Err(PairingError::Invalid);
        }
        let supplied_verifier = verifier(&submission.secret);
        let mut state = self.state.lock().map_err(|_| PairingError::Unavailable)?;
        expire_session(&mut state);
        let Some(session) = state.session.as_mut() else {
            return Err(if matches_retired(&state, &supplied_verifier) {
                PairingError::Gone
            } else {
                PairingError::Invalid
            });
        };
        if !constant_time_equal(&session.secret_verifier, &supplied_verifier) {
            return Err(if matches_retired(&state, &supplied_verifier) {
                PairingError::Gone
            } else {
                PairingError::Invalid
            });
        }
        if session.request.is_some() {
            return Err(PairingError::Gone);
        }
        let request_id = uuid::Uuid::new_v4().to_string();
        session.request = Some(PendingRequestState {
            request: PendingPairingRequest {
                request_id: request_id.clone(),
                device_name: submission.device_name,
                platform: submission.platform,
            },
            outcome: PairingOutcome::Pending,
        });
        Ok(PairingSubmissionResponse {
            request_id,
            status: "pending",
            expires_at: session.status.expires_at.clone(),
        })
    }

    pub(crate) fn poll(
        &self,
        request_id: &str,
        secret: &str,
    ) -> Result<PairingPollResponse, PairingError> {
        if !valid_secret(secret) {
            return Err(PairingError::Invalid);
        }
        let supplied_verifier = verifier(secret);
        let mut state = self.state.lock().map_err(|_| PairingError::Unavailable)?;
        expire_session(&mut state);
        let Some(session) = state.session.as_mut() else {
            return Err(if matches_retired(&state, &supplied_verifier) {
                PairingError::Gone
            } else {
                PairingError::Invalid
            });
        };
        if !constant_time_equal(&session.secret_verifier, &supplied_verifier) {
            return Err(PairingError::Invalid);
        }
        let Some(pending) = session.request.as_mut() else {
            return Err(PairingError::Invalid);
        };
        if pending.request.request_id != request_id {
            return Err(PairingError::Invalid);
        }
        match &mut pending.outcome {
            PairingOutcome::Pending => Ok(PairingPollResponse {
                status: "pending",
                device_id: None,
                credential: None,
            }),
            PairingOutcome::Rejected => Err(PairingError::Rejected),
            PairingOutcome::Approved {
                device_id,
                credential,
            } => {
                let response = PairingPollResponse {
                    status: "approved",
                    device_id: Some(device_id.clone()),
                    credential: Some(std::mem::take(credential)),
                };
                retire_current_session(&mut state);
                Ok(response)
            }
        }
    }

    pub(crate) fn decide(&self, request_id: &str, decision: PairingDecision) -> Result<(), String> {
        let mut state = self.lock_state()?;
        expire_session(&mut state);
        let session = state
            .session
            .as_mut()
            .ok_or_else(|| "Companion pairing session is no longer active".to_string())?;
        let pending = session
            .request
            .as_mut()
            .filter(|pending| pending.request.request_id == request_id)
            .ok_or_else(|| "Companion pairing request was not found".to_string())?;
        if !matches!(pending.outcome, PairingOutcome::Pending) {
            return Err("Companion pairing request was already decided".to_string());
        }
        match decision {
            PairingDecision::Reject => pending.outcome = PairingOutcome::Rejected,
            PairingDecision::Approve => {
                let credential = random_secret();
                let device_id = uuid::Uuid::new_v4().to_string();
                self.devices.save(&CompanionDeviceRecord {
                    device_id: device_id.clone(),
                    device_name: pending.request.device_name.clone(),
                    platform: pending.request.platform.clone(),
                    credential_verifier: verifier(&credential),
                    paired_at: chrono::Utc::now().timestamp(),
                    last_seen_at: None,
                    revoked_at: None,
                })?;
                pending.outcome = PairingOutcome::Approved {
                    device_id,
                    credential,
                };
            }
        }
        Ok(())
    }

    pub(crate) fn devices(&self) -> Result<Vec<CompanionPairedDevice>, String> {
        self.devices
            .list()
            .map(|records| records.iter().map(CompanionPairedDevice::from).collect())
    }

    pub(crate) fn revoke(&self, device_id: &str) -> Result<(), String> {
        if !self
            .devices
            .revoke(device_id, chrono::Utc::now().timestamp())?
        {
            return Err("Companion device was not found".to_string());
        }
        let _ = self
            .termination_tx
            .send(CompanionStreamTermination::DeviceRevoked {
                device_id: device_id.to_string(),
            });
        Ok(())
    }

    pub(crate) fn revoke_all(&self) -> Result<CompanionDeviceRevocationBatch, String> {
        self.devices.revoke_all(chrono::Utc::now().timestamp())
    }

    pub(crate) fn notify_all_devices_revoked(&self) {
        let _ = self
            .termination_tx
            .send(CompanionStreamTermination::AllDevicesRevoked);
    }

    pub(crate) fn rollback_revoke_all(
        &self,
        batch: &CompanionDeviceRevocationBatch,
    ) -> Result<(), String> {
        self.devices.rollback_revoke_all(batch)
    }

    #[allow(dead_code)] // Subscription is wired into the canonical SSE route by KVG-2947.
    pub(crate) fn subscribe_stream_terminations(
        &self,
    ) -> tokio::sync::broadcast::Receiver<CompanionStreamTermination> {
        self.termination_tx.subscribe()
    }

    pub(crate) fn notify_gateway_closing(&self) {
        self.gateway_accepting_streams
            .store(false, std::sync::atomic::Ordering::SeqCst);
        let _ = self
            .termination_tx
            .send(CompanionStreamTermination::GatewayClosing);
    }
    pub(crate) fn mark_gateway_not_accepting_streams(&self) {
        self.gateway_accepting_streams
            .store(false, std::sync::atomic::Ordering::SeqCst);
    }

    pub(crate) fn notify_gateway_running(&self) {
        self.gateway_accepting_streams
            .store(true, std::sync::atomic::Ordering::SeqCst);
    }

    pub(crate) fn authorize_device(
        &self,
        headers: &HeaderMap,
    ) -> Result<CompanionAuthenticatedDevice, CompanionErrorCode> {
        let credential = headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.strip_prefix("Bearer "))
            .filter(|value| !value.is_empty())
            .ok_or(CompanionErrorCode::Unauthenticated)?;
        let supplied_verifier = verifier(credential);
        match self
            .devices
            .authenticate(&supplied_verifier, chrono::Utc::now().timestamp())
            .map_err(|_| CompanionErrorCode::TemporarilyUnavailable)?
        {
            CompanionDeviceAuthentication::Active { device_id } => {
                Ok(CompanionAuthenticatedDevice { device_id })
            }
            CompanionDeviceAuthentication::Revoked => Err(CompanionErrorCode::Revoked),
            CompanionDeviceAuthentication::Missing => Err(CompanionErrorCode::Unauthenticated),
        }
    }

    #[allow(dead_code)] // Wired into the canonical SSE route by KVG-2947.
    pub(crate) fn authorize_stream(
        &self,
        headers: &HeaderMap,
    ) -> Result<CompanionStreamAuthorization, CompanionErrorCode> {
        // Subscribe first, then authorize. A revocation racing authorization is
        // therefore either observed by the authorization read or queued for the stream.
        let terminations = self.subscribe_stream_terminations();
        if !self
            .gateway_accepting_streams
            .load(std::sync::atomic::Ordering::SeqCst)
        {
            return Err(CompanionErrorCode::TemporarilyUnavailable);
        }
        let principal = self.authorize_device(headers)?;
        if !self
            .gateway_accepting_streams
            .load(std::sync::atomic::Ordering::SeqCst)
        {
            return Err(CompanionErrorCode::TemporarilyUnavailable);
        }
        Ok(CompanionStreamAuthorization {
            principal,
            terminations,
        })
    }

    fn lock_state(&self) -> Result<std::sync::MutexGuard<'_, PairingState>, String> {
        self.state
            .lock()
            .map_err(|_| "Companion pairing state lock was poisoned".to_string())
    }
}

impl CompanionAuthorizer for PairingCoordinator {
    fn authorize(
        &self,
        headers: &HeaderMap,
    ) -> Result<CompanionAuthenticatedDevice, CompanionErrorCode> {
        self.authorize_device(headers)
    }
}

fn validate_device(device_name: &str, platform: &str) -> Result<(), PairingError> {
    let name = device_name.trim();
    if name.is_empty() || name.chars().count() > MAX_DEVICE_NAME_LEN {
        return Err(PairingError::InvalidDevice);
    }
    if !matches!(platform, "ios" | "android") {
        return Err(PairingError::InvalidDevice);
    }
    Ok(())
}

fn valid_secret(secret: &str) -> bool {
    secret.len() == 43
        && secret
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn random_secret() -> String {
    let mut bytes = [0_u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn verifier(secret: &str) -> [u8; 32] {
    Sha256::digest(secret.as_bytes()).into()
}

fn constant_time_equal(left: &[u8; 32], right: &[u8; 32]) -> bool {
    bool::from(left.ct_eq(right))
}

fn prune_attempts(attempts: &mut VecDeque<Instant>, now: Instant) {
    while attempts
        .front()
        .is_some_and(|attempt| now.duration_since(*attempt) >= PAIRING_RATE_WINDOW)
    {
        attempts.pop_front();
    }
}

fn admit_rate_limited_request(
    by_peer: &mut HashMap<IpAddr, VecDeque<Instant>>,
    global: &mut VecDeque<Instant>,
    peer: IpAddr,
    peer_limit: usize,
    global_limit: usize,
) -> Result<(), PairingError> {
    let now = Instant::now();
    prune_attempts(global, now);
    if global.len() >= global_limit {
        return Err(PairingError::RateLimited);
    }
    by_peer.retain(|_, attempts| {
        prune_attempts(attempts, now);
        !attempts.is_empty()
    });
    if !by_peer.contains_key(&peer) && by_peer.len() >= MAX_RATE_LIMIT_PEERS {
        return Err(PairingError::RateLimited);
    }
    let attempts = by_peer.entry(peer).or_default();
    if attempts.len() >= peer_limit {
        return Err(PairingError::RateLimited);
    }
    attempts.push_back(now);
    global.push_back(now);
    Ok(())
}

fn expire_session(state: &mut PairingState) {
    if state
        .session
        .as_ref()
        .is_some_and(|session| Instant::now() >= session.expires_at)
    {
        retire_current_session(state);
    }
}

fn retire_current_session(state: &mut PairingState) {
    if let Some(session) = state.session.take() {
        state
            .retired_secret_verifiers
            .push_back(session.secret_verifier);
        while state.retired_secret_verifiers.len() > RETIRED_SECRET_LIMIT {
            state.retired_secret_verifiers.pop_front();
        }
    }
}

fn matches_retired(state: &PairingState, supplied_verifier: &[u8; 32]) -> bool {
    state
        .retired_secret_verifiers
        .iter()
        .fold(false, |matched, retired| {
            matched | constant_time_equal(retired, supplied_verifier)
        })
}
