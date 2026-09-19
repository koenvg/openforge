use super::*;
use std::{
    sync::atomic::{AtomicI64, Ordering},
    time::Duration,
};
use tokio::sync::{mpsc, oneshot};

struct ManualClock {
    now: AtomicI64,
    sleeps: mpsc::UnboundedSender<(Duration, oneshot::Sender<()>)>,
}
impl super::super::clock::Clock for ManualClock {
    fn now(&self) -> i64 {
        self.now.load(Ordering::SeqCst)
    }
    fn sleep(
        &self,
        delay: Duration,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send + '_>> {
        Box::pin(async move {
            let (tx, rx) = oneshot::channel();
            self.sleeps.send((delay, tx)).unwrap();
            rx.await.unwrap();
            self.now.fetch_add(delay.as_secs() as i64, Ordering::SeqCst);
        })
    }
}

#[tokio::test]
async fn transient_and_visibility_failures_retry_only_twice_at_two_and_ten_seconds() {
    for status in [404, 503] {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let clock = Arc::new(ManualClock {
            now: AtomicI64::new(100),
            sleeps: tx,
        });
        let f = Fixture::with_clock(false, Some("test-token"), clock).await;
        f.api
            .statuses
            .lock()
            .unwrap()
            .extend([status, status, status]);
        f.output(42);
        for (attempt, expected) in [(1, 2), (2, 10)] {
            f.calls(attempt).await;
            let (delay, resume) = tokio::time::timeout(Duration::from_secs(2), rx.recv())
                .await
                .expect("retry scheduled")
                .unwrap();
            assert_eq!(delay, Duration::from_secs(expected));
            assert_eq!(f.api.calls.lock().unwrap().len(), attempt);
            resume.send(()).unwrap();
        }
        f.discovery.settled().await;
        assert_eq!(f.api.calls.lock().unwrap().len(), 3);
        assert!(rx.try_recv().is_err());
        assert!(acquire_db(&f.db)
            .get_pull_requests_for_task(&f.task_id)
            .unwrap()
            .is_empty());
        // A later signal remains eligible after exhausted retry work.
        f.output(42);
        f.discovery.settled().await;
        assert_eq!(f.api.calls.lock().unwrap().len(), 4);
        assert_eq!(
            acquire_db(&f.db)
                .get_pull_requests_for_task(&f.task_id)
                .unwrap()
                .len(),
            1
        );
    }
}

#[tokio::test]
async fn missing_credentials_and_authentication_failure_do_not_retry_or_link() {
    for token in [None, Some("test-token")] {
        let f = Fixture::new(false, token).await;
        f.api.statuses.lock().unwrap().push_back(401);
        f.output(42);
        f.discovery.settled().await;
        assert_eq!(
            f.api.calls.lock().unwrap().len(),
            usize::from(token.is_some())
        );
        assert!(acquire_db(&f.db)
            .get_pull_requests_for_task(&f.task_id)
            .unwrap()
            .is_empty());
    }
}

#[tokio::test]
async fn shared_rate_deadline_is_respected_without_clearing_it() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let f = Fixture::with_clock(
        false,
        Some("test-token"),
        Arc::new(ManualClock {
            now: AtomicI64::new(100),
            sleeps: tx,
        }),
    )
    .await;
    f.client.set_last_rate_limit_reset(Some(130));
    f.output(42);
    let (delay, resume) = tokio::time::timeout(Duration::from_secs(2), rx.recv())
        .await
        .expect("server deadline scheduled")
        .unwrap();
    assert_eq!(delay, Duration::from_secs(30));
    assert!(f.api.calls.lock().unwrap().is_empty());
    assert_eq!(f.client.get_last_rate_limit_reset(), Some(130));
    resume.send(()).unwrap();
    f.discovery.settled().await;
    assert_eq!(f.api.calls.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn github_rate_limit_response_preserves_links_and_waits_for_server_deadline() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let now = crate::unix_timestamp::seconds(std::time::SystemTime::now()).unwrap();
    let f = Fixture::with_clock(
        false,
        Some("test-token"),
        Arc::new(ManualClock {
            now: AtomicI64::new(now),
            sleeps: tx,
        }),
    )
    .await;
    f.api.statuses.lock().unwrap().push_back(429);
    *f.api.retry_after.lock().unwrap() = Some("20".into());
    f.output(42);
    let (delay, resume) = tokio::time::timeout(Duration::from_secs(2), rx.recv())
        .await
        .expect("rate retry scheduled")
        .unwrap();
    assert_eq!(
        delay.as_secs(),
        (f.client.get_last_rate_limit_reset().unwrap() - now) as u64
    );
    assert!(delay >= Duration::from_secs(20));
    assert!(acquire_db(&f.db)
        .get_pull_requests_for_task(&f.task_id)
        .unwrap()
        .is_empty());
    assert_eq!(f.api.calls.lock().unwrap().len(), 1);
    resume.send(()).unwrap();
    f.discovery.settled().await;
    assert_eq!(f.api.calls.lock().unwrap().len(), 2);
    assert_eq!(
        acquire_db(&f.db)
            .get_pull_requests_for_task(&f.task_id)
            .unwrap()
            .len(),
        1
    );
}
