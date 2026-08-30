use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock, Weak};

use super::event_model::{
    AppEvent, AppEventCursor, AppEventEnvelope, AppEventError, AppEventFrame, AppEventGap,
    AppEventId, AppEventMeta, DeliveryClass, EmitReceipt, APP_EVENT_SCHEMA_VERSION,
};

pub type AppEventSender = tokio::sync::broadcast::Sender<AppEventEnvelope>;

struct AppEventBusInner {
    sender: AppEventSender,
    replay: Mutex<VecDeque<AppEventEnvelope>>,
    replay_capacity: usize,
    sequence: AtomicU64,
    epoch: String,
}

#[derive(Clone)]
pub struct AppEventBus {
    inner: Arc<AppEventBusInner>,
}

impl AppEventBus {
    pub fn new(channel_capacity: usize, replay_capacity: usize) -> Self {
        let (sender, _) = tokio::sync::broadcast::channel(channel_capacity);
        let bus = Self {
            inner: Arc::new(AppEventBusInner {
                sender,
                replay: Mutex::new(VecDeque::with_capacity(replay_capacity)),
                replay_capacity,
                sequence: AtomicU64::new(0),
                epoch: uuid::Uuid::new_v4().to_string(),
            }),
        };
        register_bus_sender(&bus);
        bus
    }

    pub fn sender(&self) -> AppEventSender {
        self.inner.sender.clone()
    }

    pub fn tasks(&self) -> TaskEvents {
        TaskEvents { bus: self.clone() }
    }

    pub fn try_emit<E>(&self, event: E) -> Result<EmitReceipt, AppEventError>
    where
        E: Into<AppEvent>,
    {
        let event = event.into();
        let replayable = event.delivery != DeliveryClass::RealtimeLossy;
        let emitted_at_ms = now_ms()?;
        let seq = self.inner.sequence.fetch_add(1, Ordering::SeqCst) + 1;
        let id = AppEventId {
            epoch: self.inner.epoch.clone(),
            seq,
        };
        let envelope = AppEventEnvelope {
            id: Some(id.clone()),
            event_name: event.event_name,
            payload: event.payload,
            meta: Some(AppEventMeta {
                sequence: seq,
                emitted_at_ms,
                ordering_key: event.ordering_key,
                delivery: event.delivery,
                schema_version: APP_EVENT_SCHEMA_VERSION,
            }),
        };

        if replayable && self.inner.replay_capacity > 0 {
            if let Ok(mut replay) = self.inner.replay.lock() {
                replay.push_back(envelope.clone());
                while replay.len() > self.inner.replay_capacity {
                    replay.pop_front();
                }
            }
        }

        self.inner
            .sender
            .send(envelope)
            .map(|_| EmitReceipt { id: id.clone() })
            .or_else(|error| {
                // No active subscribers is not a publish failure. Durable events remain replayable.
                if error.0.id.as_ref() == Some(&id) {
                    Ok(EmitReceipt { id })
                } else {
                    Err(AppEventError::BusClosed)
                }
            })
    }

    pub fn subscribe(
        &self,
        cursor: Option<AppEventCursor>,
    ) -> Result<AppEventSubscription, AppEventError> {
        let receiver = self.inner.sender.subscribe();
        let mut queued = VecDeque::new();

        let replay = self
            .inner
            .replay
            .lock()
            .map_err(|_| AppEventError::BusClosed)?;
        let oldest = replay.front().and_then(envelope_cursor);
        let newest = replay.back().and_then(envelope_cursor);

        if let Some(cursor) = cursor {
            if let (Some(oldest), Some(newest)) = (oldest, newest) {
                if cursor.epoch != newest.epoch || cursor.seq.saturating_add(1) < oldest.seq {
                    queued.push_back(AppEventFrame::Gap(AppEventGap {
                        requested_after: cursor,
                        oldest_available: oldest,
                        newest_available: newest,
                    }));
                } else {
                    for envelope in replay.iter() {
                        if envelope
                            .id
                            .as_ref()
                            .map(|id| id.epoch == cursor.epoch && id.seq > cursor.seq)
                            .unwrap_or(false)
                        {
                            queued.push_back(AppEventFrame::Event(envelope.clone()));
                        }
                    }
                }
            }
        } else {
            queued.extend(
                replay
                    .iter()
                    .filter(|envelope| {
                        envelope
                            .meta
                            .as_ref()
                            .map(|meta| meta.delivery == DeliveryClass::Lifecycle)
                            .unwrap_or(false)
                    })
                    .cloned()
                    .map(AppEventFrame::Event),
            );
        }
        drop(replay);

        let last_delivered = queued
            .iter()
            .filter_map(frame_cursor)
            .max_by_key(|cursor| cursor.seq);

        Ok(AppEventSubscription {
            inner: Arc::clone(&self.inner),
            queued,
            receiver,
            last_delivered,
        })
    }
}

fn register_bus_sender(bus: &AppEventBus) {
    if let Ok(mut registry) = bus_registry().lock() {
        registry.retain(|registered| registered.upgrade().is_some());
        registry.push(Arc::downgrade(&bus.inner));
    }
}

fn bus_registry() -> &'static Mutex<Vec<Weak<AppEventBusInner>>> {
    static REGISTRY: OnceLock<Mutex<Vec<Weak<AppEventBusInner>>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(Vec::new()))
}

pub(super) fn bus_for_sender(sender: &AppEventSender) -> Option<AppEventBus> {
    let mut registry = bus_registry().lock().ok()?;
    registry.retain(|registered| registered.upgrade().is_some());
    registry.iter().filter_map(Weak::upgrade).find_map(|inner| {
        if inner.sender.same_channel(sender) {
            Some(AppEventBus { inner })
        } else {
            None
        }
    })
}

pub struct AppEventSubscription {
    inner: Arc<AppEventBusInner>,
    queued: VecDeque<AppEventFrame>,
    receiver: tokio::sync::broadcast::Receiver<AppEventEnvelope>,
    last_delivered: Option<AppEventCursor>,
}

impl AppEventSubscription {
    pub async fn recv(&mut self) -> Option<AppEventFrame> {
        if let Some(frame) = self.queued.pop_front() {
            self.note_delivered(&frame);
            return Some(frame);
        }

        loop {
            match self.receiver.recv().await {
                Ok(envelope) => {
                    if self.already_delivered(&envelope) {
                        continue;
                    }
                    let frame = AppEventFrame::Event(envelope);
                    self.note_delivered(&frame);
                    return Some(frame);
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    if let Some(gap) = self.current_gap() {
                        let frame = AppEventFrame::Gap(gap);
                        self.note_delivered(&frame);
                        return Some(frame);
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => return None,
            }
        }
    }

    fn already_delivered(&self, envelope: &AppEventEnvelope) -> bool {
        let Some(cursor) = envelope_cursor(envelope) else {
            return false;
        };
        self.last_delivered
            .as_ref()
            .map(|last| last.epoch == cursor.epoch && cursor.seq <= last.seq)
            .unwrap_or(false)
    }

    fn note_delivered(&mut self, frame: &AppEventFrame) {
        if let Some(cursor) = frame_cursor(frame) {
            let should_update = self
                .last_delivered
                .as_ref()
                .map(|last| last.epoch != cursor.epoch || cursor.seq > last.seq)
                .unwrap_or(true);
            if should_update {
                self.last_delivered = Some(cursor);
            }
        }
    }

    fn current_gap(&self) -> Option<AppEventGap> {
        let replay = self.inner.replay.lock().ok()?;
        let oldest = replay.front().and_then(envelope_cursor)?;
        let newest = replay.back().and_then(envelope_cursor)?;
        let requested_after = self
            .last_delivered
            .clone()
            .unwrap_or_else(|| AppEventCursor {
                epoch: newest.epoch.clone(),
                seq: 0,
            });
        Some(AppEventGap {
            requested_after,
            oldest_available: oldest,
            newest_available: newest,
        })
    }
}

#[derive(Clone)]
pub struct TaskEvents {
    bus: AppEventBus,
}

impl TaskEvents {
    pub fn created(
        &self,
        task_id: &str,
        project_id: Option<&str>,
    ) -> Result<EmitReceipt, AppEventError> {
        self.changed("created", task_id, project_id)
    }

    pub fn updated(
        &self,
        task_id: &str,
        project_id: Option<&str>,
    ) -> Result<EmitReceipt, AppEventError> {
        self.changed("updated", task_id, project_id)
    }

    pub fn completed(
        &self,
        task_id: &str,
        project_id: Option<&str>,
    ) -> Result<EmitReceipt, AppEventError> {
        // Keep the established `deleted` invalidation action for desktop and
        // plugin consumers even though the Task row remains as reference data.
        self.changed("deleted", task_id, project_id)
    }

    fn changed(
        &self,
        action: &str,
        task_id: &str,
        project_id: Option<&str>,
    ) -> Result<EmitReceipt, AppEventError> {
        let mut payload = serde_json::json!({
            "action": action,
            "task_id": task_id,
        });
        if let Some(project_id) = project_id {
            payload["project_id"] = serde_json::json!(project_id);
        }
        self.bus.try_emit(AppEvent::new(
            "task-changed",
            payload,
            DeliveryClass::StateInvalidation,
            Some(format!("task:{task_id}")),
        ))
    }
}

fn envelope_cursor(envelope: &AppEventEnvelope) -> Option<AppEventCursor> {
    envelope.id.as_ref().map(|id| AppEventCursor {
        epoch: id.epoch.clone(),
        seq: id.seq,
    })
}

fn frame_cursor(frame: &AppEventFrame) -> Option<AppEventCursor> {
    match frame {
        AppEventFrame::Event(envelope) => envelope_cursor(envelope),
        AppEventFrame::Gap(gap) => Some(gap.newest_available.clone()),
    }
}

fn now_ms() -> Result<u64, AppEventError> {
    crate::unix_timestamp::milliseconds(std::time::SystemTime::now())
        .map_err(|_| AppEventError::Clock)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_app_event_bus_assigns_sequence_metadata_and_preserves_legacy_shape() {
        let bus = AppEventBus::new(16, 8);
        let mut subscription = bus.subscribe(None).expect("subscribe should work");

        let receipt = bus
            .tasks()
            .updated("T-1009", Some("P-4"))
            .expect("event should publish");

        let AppEventFrame::Event(received) =
            subscription.recv().await.expect("event should arrive")
        else {
            panic!("expected event frame");
        };

        assert_eq!(receipt.id.seq, 1);
        assert_eq!(received.event_name, "task-changed");
        assert_eq!(received.payload["action"], "updated");
        assert_eq!(received.payload["task_id"], "T-1009");
        assert_eq!(received.payload["project_id"], "P-4");
        assert_eq!(received.id.as_ref().expect("id should be present").seq, 1);
        let meta = received.meta.as_ref().expect("meta should be present");
        assert_eq!(meta.sequence, 1);
        assert_eq!(meta.ordering_key.as_deref(), Some("task:T-1009"));
        assert_eq!(meta.delivery, DeliveryClass::StateInvalidation);
    }

    #[tokio::test]
    async fn realtime_events_are_live_only_and_do_not_enter_cursor_replay() {
        let bus = AppEventBus::new(16, 8);
        let first = bus
            .tasks()
            .updated("T-1", None)
            .expect("first event should publish");
        bus.try_emit(AppEvent::new(
            "pty-model-output-T-1",
            serde_json::json!({ "data": "dGlueQ==", "instance_id": 7, "sequence": 1 }),
            DeliveryClass::RealtimeLossy,
            Some("pty:T-1".to_string()),
        ))
        .expect("realtime event should publish");
        bus.tasks()
            .updated("T-2", None)
            .expect("second durable event should publish");

        let mut subscription = bus
            .subscribe(Some(AppEventCursor::after(first.id)))
            .expect("cursor subscription should work");
        let AppEventFrame::Event(received) = subscription.recv().await.expect("event") else {
            panic!("expected durable event frame");
        };

        assert_eq!(received.event_name, "task-changed");
        assert_eq!(received.payload["task_id"], "T-2");
    }

    #[tokio::test]
    async fn test_app_event_bus_replays_events_after_cursor() {
        let bus = AppEventBus::new(16, 8);
        let first = bus
            .tasks()
            .updated("T-1", None)
            .expect("first event should publish");
        bus.tasks()
            .updated("T-2", None)
            .expect("second event should publish");

        let mut subscription = bus
            .subscribe(Some(AppEventCursor::after(first.id.clone())))
            .expect("subscribe after cursor should work");

        let AppEventFrame::Event(received) = subscription
            .recv()
            .await
            .expect("replayed event should arrive")
        else {
            panic!("expected event frame");
        };
        assert_eq!(received.event_name, "task-changed");
        assert_eq!(received.payload["task_id"], "T-2");
        assert_eq!(received.id.as_ref().expect("id should be present").seq, 2);
    }

    #[tokio::test]
    async fn test_app_event_bus_skips_live_duplicates_after_replay() {
        let bus = AppEventBus::new(16, 8);
        let first = bus
            .tasks()
            .updated("T-1", None)
            .expect("first event should publish");
        bus.tasks()
            .updated("T-2", None)
            .expect("second event should publish");

        let mut subscription = bus
            .subscribe(Some(AppEventCursor::after(first.id.clone())))
            .expect("subscribe after cursor should work");

        let AppEventFrame::Event(replayed) = subscription
            .recv()
            .await
            .expect("replayed event should arrive")
        else {
            panic!("expected replayed event frame");
        };
        bus.sender()
            .send(replayed)
            .expect("test duplicate should publish to live receiver");
        bus.tasks()
            .updated("T-3", None)
            .expect("third event should publish");

        let AppEventFrame::Event(received) = subscription
            .recv()
            .await
            .expect("next unique event should arrive")
        else {
            panic!("expected unique event frame");
        };
        assert_eq!(received.payload["task_id"], "T-3");
    }

    #[tokio::test]
    async fn test_app_event_bus_reports_gap_when_live_subscriber_lags() {
        let bus = AppEventBus::new(1, 8);
        let mut subscription = bus.subscribe(None).expect("subscribe should work");
        bus.tasks()
            .updated("T-1", None)
            .expect("first event should publish");
        bus.tasks()
            .updated("T-2", None)
            .expect("second event should publish");
        bus.tasks()
            .updated("T-3", None)
            .expect("third event should publish");

        let AppEventFrame::Gap(gap) = subscription.recv().await.expect("lag gap should arrive")
        else {
            panic!("expected gap frame");
        };
        assert_eq!(gap.oldest_available.seq, 1);
        assert_eq!(gap.newest_available.seq, 3);
    }

    #[tokio::test]
    async fn test_app_event_bus_reports_gap_when_cursor_is_older_than_replay() {
        let bus = AppEventBus::new(16, 1);
        let first = bus
            .tasks()
            .updated("T-1", None)
            .expect("first event should publish");
        bus.tasks()
            .updated("T-2", None)
            .expect("second event should publish");
        bus.tasks()
            .updated("T-3", None)
            .expect("third event should publish");

        let mut subscription = bus
            .subscribe(Some(AppEventCursor::after(first.id.clone())))
            .expect("subscribe after expired cursor should still return a gap frame");

        let AppEventFrame::Gap(gap) = subscription.recv().await.expect("gap should arrive") else {
            panic!("expected gap frame");
        };
        assert_eq!(gap.requested_after.seq, 1);
        assert_eq!(gap.oldest_available.seq, 3);
        assert_eq!(gap.newest_available.seq, 3);
    }

    #[test]
    fn test_app_event_bus_accepts_maximum_sequence_cursor_without_overflow() {
        let bus = AppEventBus::new(16, 1);
        let receipt = bus
            .tasks()
            .updated("T-1", None)
            .expect("event should publish");
        let subscription = bus
            .subscribe(Some(AppEventCursor {
                epoch: receipt.id.epoch,
                seq: u64::MAX,
            }))
            .expect("maximum cursor should not overflow");

        assert!(subscription.queued.is_empty());
    }
}
