//! One ordered delivery at a time; only an exact committed receipt advances the journal.
use crate::{agent_gateway::Registration, notification_journal::NotificationJournal};
use axum::body::{to_bytes, Body};
use hyper_util::rt::TokioIo;
use openforge_session_protocol::*;
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

pub(crate) type SharedNotifications = Arc<Mutex<NotificationJournal>>;

pub(crate) async fn run(
    journal: SharedNotifications,
    registration: Registration,
    backend: crate::backend::Backend,
) {
    let mut failed = false;
    loop {
        let endpoint = registration.read().ok().and_then(|r| r.clone());
        let Some(endpoint) = endpoint else {
            tokio::time::sleep(Duration::from_millis(250)).await;
            continue;
        };
        let read_journal = Arc::clone(&journal);
        let backend = backend.clone();
        let next = tokio::task::spawn_blocking(move || {
            let live = backend.live_agent_identities()?;
            let mut journal = read_journal.lock().map_err(|_| Error::OutcomeUnknown)?;
            journal.retire_acknowledged(&live)?;
            journal.next()
        })
        .await;
        let result = match next {
            Ok(Ok(Some(delivery))) => match send(&endpoint, &delivery, &registration).await {
                Ok(receipt) => {
                    let journal = Arc::clone(&journal);
                    tokio::task::spawn_blocking(move || {
                        journal
                            .lock()
                            .map_err(|_| Error::OutcomeUnknown)?
                            .acknowledge(&receipt)
                    })
                    .await
                    .unwrap_or(Err(Error::OutcomeUnknown))
                }
                Err(error) => Err(error),
            },
            Ok(Ok(None)) => {
                tokio::time::sleep(Duration::from_millis(250)).await;
                continue;
            }
            _ => Err(Error::OutcomeUnknown),
        };
        if result.is_err() {
            if !failed {
                eprintln!(
                    "notification delivery pending: backend acknowledgement or journal unavailable"
                );
            }
            failed = true;
            tokio::time::sleep(Duration::from_secs(1)).await;
        } else {
            failed = false;
        }
    }
}

async fn send(
    endpoint: &Arc<SidecarEndpoint>,
    delivery: &NotificationDelivery,
    registration: &Registration,
) -> Result<NotificationReceipt, Error> {
    let (mut sender, connection) = tokio::time::timeout(Duration::from_secs(2), async {
        let stream = tokio::net::TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, endpoint.port))
            .await
            .map_err(|_| Error::OutcomeUnknown)?;
        hyper::client::conn::http1::handshake(TokioIo::new(stream))
            .await
            .map_err(|_| Error::OutcomeUnknown)
    })
    .await
    .map_err(|_| Error::OutcomeUnknown)??;
    if !registration
        .read()
        .ok()
        .and_then(|r| r.clone())
        .is_some_and(|current| Arc::ptr_eq(endpoint, &current))
    {
        return Err(Error::StaleController);
    }
    let body = serde_json::to_vec(delivery).map_err(|_| Error::InvalidRequest)?;
    let request = hyper::Request::post(NOTIFICATION_DELIVERY_PATH)
        .header("Host", "127.0.0.1")
        .header("Authorization", format!("Bearer {}", endpoint.token))
        .header("Content-Type", "application/json")
        .header("Content-Length", body.len())
        .body(Body::from(body))
        .map_err(|_| Error::InvalidRequest)?;
    let connection = tokio::spawn(async move {
        let _ = connection.await;
    });
    let result = tokio::time::timeout(Duration::from_secs(5), async {
        let response = sender
            .send_request(request)
            .await
            .map_err(|_| Error::OutcomeUnknown)?;
        if response.status() != 200 {
            return Err(Error::OutcomeUnknown);
        }
        let bytes = to_bytes(Body::new(response.into_body()), 1024)
            .await
            .map_err(|_| Error::OutcomeUnknown)?;
        let receipt: NotificationReceipt =
            serde_json::from_slice(&bytes).map_err(|_| Error::OutcomeUnknown)?;
        if receipt.journal_id != delivery.journal_id || receipt.position != delivery.position {
            return Err(Error::OutOfOrder);
        }
        Ok(receipt)
    })
    .await;
    connection.abort();
    result.map_err(|_| Error::OutcomeUnknown)?
}
