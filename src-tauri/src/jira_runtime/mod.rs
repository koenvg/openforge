//! Read-only Jira Cloud access for the PR review gap analysis.
//!
//! The PR is an outcome of a ticket, so the walkthrough agent is given the
//! ticket as context. This module fetches the work item; the API token lives in
//! the keychain and never leaves core (see `app_invoke::jira`).

pub mod adf;
pub mod client;
