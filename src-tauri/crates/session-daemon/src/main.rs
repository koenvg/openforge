mod agent_config;
mod agent_connection;
mod agent_gateway;
mod backend;
mod host;
mod journal;
mod notification_delivery;
mod notification_journal;
#[cfg(test)]
mod notification_journal_tests;
mod output;
mod process;
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
    if let Err(error) = server::run() {
        eprintln!("session daemon stopped: {error}");
        std::process::exit(1);
    }
}
