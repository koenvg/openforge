use super::*;
use crate::{
    input::InputCheckpoint,
    process_native::{self, ChildHandle, Descriptor, Master},
    quiescence::{Gate, Paused},
    terminal_model::TerminalModelCheckpoint,
};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ProcessCheckpoint {
    format: u32,
    pub descriptor: Descriptor,
    identity: ManagedProcessIdentity,
    pty: PtyIdentity,
    session_key: String,
    model: TerminalModelCheckpoint,
    input: InputCheckpoint,
    root_exit: Option<(u32, u64)>,
    stopping: bool,
    reader_done: bool,
}
impl ProcessCheckpoint {
    fn validate(&self) -> Result<(), Error> {
        if self.format != 1
            || self.session_key.is_empty()
            || self.session_key.len() > 1024
            || self.pty.instance.value() != self.model.instance_id()
            || self.descriptor.fd < 3
            || self.root_exit.is_some_and(|(_, elapsed)| elapsed > 250)
            || (self.stopping && self.root_exit.is_none())
        {
            return Err(Error::InvalidRequest);
        }
        self.identity.validate().map_err(host_error)?;
        self.input.validate()
    }
    pub fn validate_for_image(&self) -> Result<(), Error> {
        self.validate()?;
        self.model
            .validate_for_image()
            .map_err(|_| Error::RecoveryUnavailable)
    }
    pub fn matches_session(&self, session: &Session) -> bool {
        self.pty == session.pty
            && self.identity.root_pid as u32 == session.pid
            && self.session_key == session.session_key
            && self.root_exit.map(|(code, _)| code) == session.exit_code
            && self.model.instance_id() == session.pty.instance.value()
    }
    pub fn retained_bytes(&self) -> usize {
        self.model
            .retained_bytes()
            .saturating_add(self.input.retained_bytes())
    }
}

impl Process {
    pub fn pause(&self) -> Result<Paused, Error> {
        self.reader_gate.pause(Duration::from_secs(5))
    }
    pub fn checkpoint(&self, pause: &Paused) -> Result<ProcessCheckpoint, Error> {
        if !pause.protects(&self.reader_gate) {
            return Err(Error::InvalidRequest);
        }
        let model = self
            .model
            .checkpoint()
            .map_err(|_| Error::RecoveryUnavailable)?;
        Ok(ProcessCheckpoint {
            format: 1,
            descriptor: self.master.checkpoint()?,
            identity: self.identity.clone(),
            pty: self.pty.clone(),
            session_key: self.session_key.clone(),
            model,
            input: self
                .writer
                .lock()
                .map_err(|_| Error::OutcomeUnknown)?
                .checkpoint()?,
            // Pause freezes the bounded output-drain interval; it does not reset it.
            root_exit: self
                .root_exit
                .map(|(code, observed)| (code, observed.elapsed().as_millis().min(250) as u64)),
            stopping: self.reader.stopping(),
            reader_done: self.reader_done.load(Ordering::Acquire),
        })
    }
    pub fn restore(checkpoint: ProcessCheckpoint, journal: SharedJournal) -> Result<Self, Error> {
        checkpoint.validate()?;
        let master = Master::restore(&checkpoint.descriptor)?;
        let reader = process_native::duplicate(checkpoint.descriptor.fd)?;
        let reader_signal = ReaderSignal::new(checkpoint.stopping)?;
        let writer = Arc::new(Mutex::new(InputWriter::restore(
            Box::new(process_native::duplicate(checkpoint.descriptor.fd)?),
            checkpoint.input,
        )?));
        let (model, feeder) = TerminalModelSession::restore_with_event_sink(
            checkpoint.session_key.clone(),
            checkpoint.model,
            event_sink(
                checkpoint.pty.clone(),
                journal,
                Arc::clone(&writer),
                Arc::clone(&reader_signal),
            ),
        )
        .map_err(host_error)?;
        let reader_gate = Arc::new(Gate::default());
        let restore_pause = reader_gate.pause(Duration::ZERO)?;
        let process = Self {
            master,
            child: ChildHandle::Inherited {
                pid: checkpoint.identity.root_pid,
                exit: checkpoint.root_exit.map(|(code, _)| code),
            },
            identity: checkpoint.identity,
            writer,
            model: Arc::new(model),
            reader: reader_signal,
            reader_done: Arc::new(AtomicBool::new(checkpoint.reader_done)),
            reader_gate,
            restore_pause: Some(restore_pause),
            cleanup_on_drop: false,
            session_key: checkpoint.session_key,
            pty: checkpoint.pty,
            root_exit: checkpoint
                .root_exit
                .map(|(code, elapsed)| (code, Instant::now() - Duration::from_millis(elapsed))),
        };
        if !checkpoint.reader_done {
            process.start_reader(reader, feeder)?;
        }
        Ok(process)
    }

    /// # Safety
    /// Call only after exec removed the previous owning wrappers, and after every
    /// retained descriptor and all restored resources have been validated uniquely.
    pub unsafe fn activate_restored(&mut self) {
        // SAFETY: the caller establishes exclusive ownership of the inherited master.
        unsafe {
            self.master.activate();
        }
        self.cleanup_on_drop = true;
        self.restore_pause.take();
    }
}
