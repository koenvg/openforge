//! Agent PTY behavior suites. Keep provider fixtures separate from behavior assertions.

#[path = "agent/concurrency.rs"]
mod concurrency;
#[path = "agent/lifecycle.rs"]
mod lifecycle;
#[path = "agent/model_attachment.rs"]
mod model_attachment;
#[path = "agent/scoped_environment.rs"]
mod scoped_environment;
#[path = "agent/support.rs"]
mod support;
#[path = "agent/workspace.rs"]
mod workspace;

#[path = "pr_completion.rs"]
mod pr_completion;
