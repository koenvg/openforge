mod agent_config;
mod agent_connection;
mod agent_gateway;
mod backend;
mod host;
mod input;
mod journal;
mod notification_checkpoint;
mod notification_delivery;
mod notification_journal;
#[cfg(test)]
mod notification_journal_tests;
mod output;
mod process;
mod process_native;
mod quiescence;
mod recovery_cli;
mod replacement;
mod server;

// Compile the existing domain-free authority and supervision code in the PTY owner.
// Both adapters use the same implementation during this migration slice.
#[allow(dead_code)]
#[path = "../../../src/pty_manager/managed_process.rs"]
mod managed_process;
#[allow(dead_code, unused_imports)]
#[path = "../../../src/terminal_model.rs"]
mod terminal_model;

fn main() {
    if let Err(error) = replacement::run() {
        eprintln!("session daemon stopped: {error}");
        std::process::exit(1);
    }
}
