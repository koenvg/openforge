use crate::journal::SharedJournal;
use openforge_session_client::runtime::io_error;
use openforge_session_protocol::*;
use std::os::unix::net::UnixStream;
use std::sync::{atomic::AtomicBool, Arc};
use std::time::Duration;

const MAX_SUBSCRIBERS: usize = 8;

struct Subscriber {
    closed: Arc<AtomicBool>,
    stream: UnixStream,
    thread: std::thread::JoinHandle<()>,
}

pub(crate) struct Subscribers {
    journal: SharedJournal,
    live: Vec<Subscriber>,
}

impl Subscribers {
    pub fn new(journal: SharedJournal) -> Self {
        Self {
            journal,
            live: Vec::new(),
        }
    }

    pub fn close_all(&mut self) {
        for subscriber in std::mem::take(&mut self.live) {
            self.close(subscriber);
        }
    }

    pub fn add(&mut self, stream: &UnixStream, first: EventBatch) -> Result<(), Error> {
        let finished: Vec<_> = self
            .live
            .iter()
            .enumerate()
            .filter(|(_, subscriber)| subscriber.thread.is_finished())
            .map(|(index, _)| index)
            .rev()
            .collect();
        for index in finished {
            self.live.swap_remove(index);
        }
        if self.live.len() >= MAX_SUBSCRIBERS {
            let oldest = self.live.remove(0);
            self.close(oldest);
        }
        stream
            .set_write_timeout(Some(Duration::from_secs(5)))
            .map_err(io_error)?;
        let closed = Arc::new(AtomicBool::new(false));
        let journal = Arc::clone(&self.journal);
        let thread_closed = Arc::clone(&closed);
        let mut writer = stream.try_clone().map_err(io_error)?;
        let stream = stream.try_clone().map_err(io_error)?;
        let thread = std::thread::Builder::new()
            .name("session-events".into())
            .spawn(move || push(&journal, &thread_closed, &mut writer, first))
            .map_err(io_error)?;
        self.live.push(Subscriber {
            closed,
            stream,
            thread,
        });
        Ok(())
    }

    fn close(&self, subscriber: Subscriber) {
        let _ = subscriber.stream.shutdown(std::net::Shutdown::Both);
        self.journal.close(&subscriber.closed);
    }
}

fn push(journal: &SharedJournal, closed: &AtomicBool, stream: &mut UnixStream, first: EventBatch) {
    let mut cursor = first.cursor;
    let mut next = Ok(first);
    loop {
        let failed = next.is_err();
        let sent = write_frame(
            stream,
            &Envelope {
                version: VERSION,
                body: next.map(Response::Events),
            },
        );
        if failed || sent.is_err() {
            return;
        }
        let batch = {
            let journal = journal.wait_after(cursor, closed);
            if closed.load(std::sync::atomic::Ordering::Acquire) {
                return;
            }
            journal.events(cursor)
        };
        if let Ok(batch) = &batch {
            cursor = batch.cursor;
        }
        next = batch;
    }
}
