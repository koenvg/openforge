//! Bounded accepted input. A timeout never discards the unwritten suffix.
use openforge_session_protocol::Error;
use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    io::Write,
    time::{Duration, Instant},
};

const MAX_BYTES: usize = 256 * 1024;
const MAX_WRITES: usize = 1024;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Pending {
    bytes: Vec<u8>,
    offset: usize,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct InputCheckpoint {
    format: u32,
    pending: VecDeque<Pending>,
    failed: bool,
}
impl InputCheckpoint {
    pub fn retained_bytes(&self) -> usize {
        self.pending
            .iter()
            .map(|pending| pending.bytes.len())
            .fold(0, usize::saturating_add)
    }
    pub fn validate(&self) -> Result<(), Error> {
        if self.format != 1 {
            return Err(Error::Version);
        }
        if self.failed {
            return Err(Error::RecoveryUnavailable);
        }
        if self.pending.len() > MAX_WRITES {
            return Err(Error::Capacity);
        }
        let mut total = 0usize;
        for pending in &self.pending {
            if pending.offset >= pending.bytes.len() {
                return Err(Error::InvalidRequest);
            }
            total = total
                .checked_add(pending.bytes.len())
                .ok_or(Error::Capacity)?;
            if total > MAX_BYTES {
                return Err(Error::Capacity);
            }
        }
        Ok(())
    }
}

pub(crate) struct InputWriter {
    writer: Box<dyn Write + Send>,
    state: InputCheckpoint,
}
impl InputWriter {
    pub fn new(writer: Box<dyn Write + Send>) -> Self {
        Self {
            writer,
            state: InputCheckpoint {
                format: 1,
                pending: VecDeque::new(),
                failed: false,
            },
        }
    }
    pub fn restore(writer: Box<dyn Write + Send>, state: InputCheckpoint) -> Result<Self, Error> {
        state.validate()?;
        Ok(Self { writer, state })
    }
    pub fn checkpoint(&self) -> Result<InputCheckpoint, Error> {
        self.state.validate()?;
        Ok(self.state.clone())
    }
    pub fn submit(&mut self, bytes: &[u8]) -> Result<(), Error> {
        if self.state.failed {
            return Err(Error::OutcomeUnknown);
        }
        let retained: usize = self
            .state
            .pending
            .iter()
            .map(|pending| pending.bytes.len())
            .sum();
        if retained.saturating_add(bytes.len()) > MAX_BYTES
            || self.state.pending.len() >= MAX_WRITES
        {
            return Err(Error::Capacity);
        }
        if !bytes.is_empty() {
            self.state.pending.push_back(Pending {
                bytes: bytes.to_vec(),
                offset: 0,
            });
        }
        self.drain(Duration::from_millis(250))
    }
    pub fn reply(&mut self, bytes: &[u8]) -> Result<(), Error> {
        let result = self.submit(bytes);
        if result == Err(Error::Capacity) {
            // The model already consumed this query. Refuse replacement rather than
            // pretend a reply that did not fit the bounded queue can be reconstructed.
            self.state.failed = true;
        }
        result
    }
    pub fn progress(&mut self) -> Result<(), Error> {
        self.drain(Duration::from_millis(5))
    }
    fn drain(&mut self, budget: Duration) -> Result<(), Error> {
        if self.state.failed {
            return Err(Error::OutcomeUnknown);
        }
        let deadline = Instant::now() + budget;
        while let Some(pending) = self.state.pending.front_mut() {
            match self.writer.write(&pending.bytes[pending.offset..]) {
                Ok(written) if written > 0 => pending.offset += written,
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::Interrupted
                    ) =>
                {
                    if Instant::now() >= deadline {
                        return Err(Error::OutcomeUnknown);
                    }
                    std::thread::sleep(Duration::from_millis(2));
                    continue;
                }
                _ => {
                    self.state.failed = true;
                    return Err(Error::OutcomeUnknown);
                }
            }
            if pending.offset == pending.bytes.len() {
                self.state.pending.pop_front();
            }
            if !self.state.pending.is_empty() && Instant::now() >= deadline {
                return Err(Error::OutcomeUnknown);
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    struct Sink {
        bytes: Arc<Mutex<Vec<u8>>>,
        allowance: usize,
    }
    impl std::io::Write for Sink {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            if self.allowance == 0 {
                return Err(std::io::ErrorKind::WouldBlock.into());
            }
            let count = bytes.len().min(self.allowance);
            self.bytes
                .lock()
                .unwrap()
                .extend_from_slice(&bytes[..count]);
            self.allowance -= count;
            Ok(count)
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn partial_accepted_input_keeps_its_offset_and_order_through_checkpoint_restore() {
        let bytes = Arc::new(Mutex::new(Vec::new()));
        let mut writer = InputWriter::new(Box::new(Sink {
            bytes: Arc::clone(&bytes),
            allowance: 2,
        }));
        assert_eq!(writer.submit(b"hello"), Err(Error::OutcomeUnknown));
        assert_eq!(writer.submit(b" world"), Err(Error::OutcomeUnknown));
        assert_eq!(*bytes.lock().unwrap(), b"he");
        let saved = writer.checkpoint().unwrap();
        let saved = serde_json::from_slice(&serde_json::to_vec(&saved).unwrap()).unwrap();
        drop(writer);
        let mut resumed = InputWriter::restore(
            Box::new(Sink {
                bytes: Arc::clone(&bytes),
                allowance: usize::MAX,
            }),
            saved,
        )
        .unwrap();
        resumed.progress().unwrap();
        resumed.progress().unwrap();
        assert_eq!(*bytes.lock().unwrap(), b"hello world");
        resumed.submit(b"!").unwrap();
        assert_eq!(*bytes.lock().unwrap(), b"hello world!");
    }
}
