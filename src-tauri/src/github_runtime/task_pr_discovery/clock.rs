use std::{future::Future, pin::Pin, time::Duration};

pub(super) trait Clock: Send + Sync {
    fn now(&self) -> i64;
    fn sleep(&self, delay: Duration) -> Pin<Box<dyn Future<Output = ()> + Send + '_>>;
}
pub(super) struct SystemClock;
impl Clock for SystemClock {
    fn now(&self) -> i64 {
        crate::unix_timestamp::seconds(std::time::SystemTime::now()).unwrap_or(0)
    }
    fn sleep(&self, delay: Duration) -> Pin<Box<dyn Future<Output = ()> + Send + '_>> {
        Box::pin(tokio::time::sleep(delay))
    }
}
