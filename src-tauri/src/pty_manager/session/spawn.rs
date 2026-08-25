//! PTY spawning split by lifecycle concern.

mod agent;
mod arbitration;
mod process;
mod registration;
mod shell;
mod streams;

#[cfg(test)]
#[path = "spawn/tests/support.rs"]
mod test_support;
