use futures::future::BoxFuture;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fmt;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentCommandRuntime {
    Backend,
    Frontend,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCommandDescriptor {
    pub qualified_id: String,
    pub plugin_id: String,
    pub runtime: AgentCommandRuntime,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<Value>,
    pub description: String,
    pub examples: Vec<Value>,
    pub discoverable: bool,
}

fn is_exact_descriptor(
    plugin_id: &str,
    runtime: AgentCommandRuntime,
    descriptor: &AgentCommandDescriptor,
) -> bool {
    descriptor.plugin_id == plugin_id
        && descriptor.runtime == runtime
        && descriptor
            .qualified_id
            .strip_prefix(plugin_id)
            .and_then(|suffix| suffix.strip_prefix('.'))
            .is_some_and(|local_id| !local_id.is_empty())
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginCommandDiscoveryContext {
    pub task_id: Option<String>,
    pub project_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PluginCommandInvocationSource {
    AgentCli,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginCommandInvocationContext {
    pub task_id: Option<String>,
    pub project_id: String,
    pub source: PluginCommandInvocationSource,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ResolvedPluginCommandContext {
    task_id: Option<String>,
    project_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PluginCommandDiscoveryError {
    MissingContext,
    TaskNotFound {
        task_id: String,
    },
    TaskMissingProject {
        task_id: String,
    },
    ProjectNotFound {
        project_id: String,
    },
    ConflictingContext {
        task_id: String,
        task_project_id: String,
        requested_project_id: String,
    },
    PluginNotInstalled {
        plugin_id: String,
    },
    PluginDisabled {
        plugin_id: String,
        project_id: String,
    },
    FrontendUnavailable {
        plugin_id: String,
        reason: String,
    },
    CommandNotFound {
        command_id: String,
    },
    Database(String),
    Runtime(String),
}

impl fmt::Display for PluginCommandDiscoveryError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::MissingContext => write!(formatter, "plugin command discovery requires --task-id or --project-id"),
            Self::TaskNotFound { task_id } => write!(formatter, "Task not found: {task_id}"),
            Self::TaskMissingProject { task_id } => write!(formatter, "Task {task_id} is not assigned to a Project"),
            Self::ProjectNotFound { project_id } => write!(formatter, "Project not found: {project_id}"),
            Self::ConflictingContext { task_id, task_project_id, requested_project_id } => write!(
                formatter,
                "Task {task_id} belongs to Project {task_project_id}, which conflicts with requested Project {requested_project_id}"
            ),
            Self::PluginNotInstalled { plugin_id } => write!(formatter, "Plugin is not installed: {plugin_id}"),
            Self::PluginDisabled { plugin_id, project_id } => {
                write!(formatter, "Plugin {plugin_id} is not enabled for Project {project_id}")
            }
            Self::FrontendUnavailable { plugin_id, reason } => {
                write!(formatter, "Frontend runtime for Plugin {plugin_id} is unavailable: {reason}")
            }
            Self::CommandNotFound { command_id } => {
                write!(formatter, "Unknown agent-facing Plugin Command: {command_id}")
            }
            Self::Database(message) | Self::Runtime(message) => formatter.write_str(message),
        }
    }
}

impl std::error::Error for PluginCommandDiscoveryError {}

pub trait BackendAgentCommandCatalog {
    fn list_agent_commands<'a>(
        &'a self,
        plugin_id: &'a str,
        project_id: &'a str,
    ) -> BoxFuture<'a, Result<Vec<AgentCommandDescriptor>, String>>;
    fn invoke_agent_command<'a>(
        &'a self,
        plugin_id: &'a str,
        project_id: &'a str,
        command_id: &'a str,
        input: Option<Value>,
        context: PluginCommandInvocationContext,
    ) -> BoxFuture<'a, Result<Value, String>>;
}

pub trait FrontendAgentCommandCatalog: Sync {
    fn list_frontend_agent_commands<'a>(
        &'a self,
        plugin_id: &'a str,
        project_id: &'a str,
    ) -> BoxFuture<'a, Result<Vec<AgentCommandDescriptor>, String>>;
    fn invoke_frontend_agent_command<'a>(
        &'a self,
        plugin_id: &'a str,
        project_id: &'a str,
        command_id: &'a str,
        input: Option<Value>,
        context: PluginCommandInvocationContext,
    ) -> BoxFuture<'a, Result<Value, String>>;
}
impl BackendAgentCommandCatalog for crate::plugin_platform::PluginPlatform<'_> {
    fn list_agent_commands<'a>(
        &'a self,
        plugin_id: &'a str,
        project_id: &'a str,
    ) -> BoxFuture<'a, Result<Vec<AgentCommandDescriptor>, String>> {
        Box::pin(async move { self.agent_command_descriptors(plugin_id, project_id).await })
    }

    fn invoke_agent_command<'a>(
        &'a self,
        plugin_id: &'a str,
        project_id: &'a str,
        command_id: &'a str,
        input: Option<Value>,
        context: PluginCommandInvocationContext,
    ) -> BoxFuture<'a, Result<Value, String>> {
        Box::pin(async move {
            self.invoke_agent_command(plugin_id, project_id, command_id, input, context)
                .await
        })
    }
}

pub struct PluginCommandBroker<'a, Catalog> {
    database: Arc<Mutex<crate::db::Database>>,
    backend: &'a Catalog,
    frontend: Option<&'a dyn FrontendAgentCommandCatalog>,
}

impl<'a, Catalog> PluginCommandBroker<'a, Catalog>
where
    Catalog: BackendAgentCommandCatalog + Sync,
{
    pub fn with_frontend(
        database: Arc<Mutex<crate::db::Database>>,
        backend: &'a Catalog,
        frontend: &'a dyn FrontendAgentCommandCatalog,
    ) -> Self {
        Self {
            database,
            backend,
            frontend: Some(frontend),
        }
    }

    pub async fn list(
        &self,
        context: &PluginCommandDiscoveryContext,
    ) -> Result<Vec<AgentCommandDescriptor>, PluginCommandDiscoveryError> {
        let project_id = self.resolve_project_id(context)?;
        let plugins = {
            let database = self.database_lock()?;
            database.get_enabled_plugins(&project_id).map_err(|error| {
                PluginCommandDiscoveryError::Database(format!(
                    "Failed to get enabled plugins: {error}"
                ))
            })?
        };

        let mut descriptors = Vec::new();
        for plugin in plugins {
            if plugin.backend_entry.is_some() {
                let commands = self
                    .backend
                    .list_agent_commands(&plugin.id, &project_id)
                    .await
                    .map_err(|error| {
                        PluginCommandDiscoveryError::Runtime(format!(
                            "Failed to discover backend Plugin Commands for {}: {error}",
                            plugin.id
                        ))
                    })?;
                descriptors.extend(commands.into_iter().filter(|command| {
                    command.discoverable
                        && is_exact_descriptor(&plugin.id, AgentCommandRuntime::Backend, command)
                }));
            }

            if !plugin.frontend_entry.trim().is_empty() {
                if let Some(frontend) = self.frontend {
                    // Routine discovery is best-effort across frontend runtimes. Exact
                    // description still reports an unavailable runtime for frontend commands.
                    if let Ok(commands) = frontend
                        .list_frontend_agent_commands(&plugin.id, &project_id)
                        .await
                    {
                        descriptors.extend(commands.into_iter().filter(|command| {
                            command.discoverable
                                && is_exact_descriptor(
                                    &plugin.id,
                                    AgentCommandRuntime::Frontend,
                                    command,
                                )
                        }));
                    }
                }
            }
        }
        Ok(descriptors)
    }

    pub async fn describe(
        &self,
        context: &PluginCommandDiscoveryContext,
        command_id: &str,
    ) -> Result<AgentCommandDescriptor, PluginCommandDiscoveryError> {
        let project_id = self.resolve_project_id(context)?;
        let plugin = {
            let database = self.database_lock()?;
            let installed = database.list_plugins().map_err(|error| {
                PluginCommandDiscoveryError::Database(format!("Failed to list plugins: {error}"))
            })?;
            let plugin = installed
                .into_iter()
                .filter(|candidate| command_id.starts_with(&format!("{}.", candidate.id)))
                .max_by_key(|candidate| candidate.id.len());
            let Some(plugin) = plugin else {
                let plugin_id = command_id
                    .rsplit_once('.')
                    .map(|(plugin_id, _)| plugin_id)
                    .filter(|plugin_id| !plugin_id.is_empty())
                    .unwrap_or(command_id)
                    .to_string();
                return Err(PluginCommandDiscoveryError::PluginNotInstalled { plugin_id });
            };
            if !database
                .is_plugin_active_for_project(&project_id, &plugin.id)
                .map_err(|error| {
                    PluginCommandDiscoveryError::Database(format!(
                        "Failed to get plugin enablement: {error}"
                    ))
                })?
            {
                return Err(PluginCommandDiscoveryError::PluginDisabled {
                    plugin_id: plugin.id,
                    project_id,
                });
            }
            plugin
        };

        if plugin.backend_entry.is_some() {
            if let Some(command) = self
                .backend
                .list_agent_commands(&plugin.id, &project_id)
                .await
                .map_err(|error| {
                    PluginCommandDiscoveryError::Runtime(format!(
                        "Failed to discover backend Plugin Commands for {}: {error}",
                        plugin.id
                    ))
                })?
                .into_iter()
                .find(|command| {
                    command.qualified_id == command_id
                        && is_exact_descriptor(&plugin.id, AgentCommandRuntime::Backend, command)
                })
            {
                return Ok(command);
            }
        }

        if !plugin.frontend_entry.trim().is_empty() {
            let Some(frontend) = self.frontend else {
                return Err(PluginCommandDiscoveryError::FrontendUnavailable {
                    plugin_id: plugin.id,
                    reason: "the active trusted renderer is unavailable".to_string(),
                });
            };
            if let Some(command) = frontend
                .list_frontend_agent_commands(&plugin.id, &project_id)
                .await
                .map_err(|reason| PluginCommandDiscoveryError::FrontendUnavailable {
                    plugin_id: plugin.id.clone(),
                    reason,
                })?
                .into_iter()
                .find(|command| {
                    command.qualified_id == command_id
                        && is_exact_descriptor(&plugin.id, AgentCommandRuntime::Frontend, command)
                })
            {
                return Ok(command);
            }
        }

        Err(PluginCommandDiscoveryError::CommandNotFound {
            command_id: command_id.to_string(),
        })
    }

    pub async fn invoke(
        &self,
        context: &PluginCommandDiscoveryContext,
        command_id: &str,
        input: Option<Value>,
    ) -> Result<Value, PluginCommandDiscoveryError> {
        let descriptor = self.describe(context, command_id).await?;
        let resolved = self.resolve_context(context)?;
        let invocation_context = PluginCommandInvocationContext {
            task_id: resolved.task_id,
            project_id: resolved.project_id.clone(),
            source: PluginCommandInvocationSource::AgentCli,
        };
        match descriptor.runtime {
            AgentCommandRuntime::Backend => self
                .backend
                .invoke_agent_command(
                    &descriptor.plugin_id,
                    &resolved.project_id,
                    command_id,
                    input,
                    invocation_context,
                )
                .await
                .map_err(|error| {
                    PluginCommandDiscoveryError::Runtime(format!(
                        "Failed to invoke backend Plugin Command {command_id}: {error}"
                    ))
                }),
            AgentCommandRuntime::Frontend => {
                let frontend = self.frontend.ok_or_else(|| {
                    PluginCommandDiscoveryError::FrontendUnavailable {
                        plugin_id: descriptor.plugin_id.clone(),
                        reason: "the active trusted renderer is unavailable".to_string(),
                    }
                })?;
                frontend
                    .invoke_frontend_agent_command(
                        &descriptor.plugin_id,
                        &resolved.project_id,
                        command_id,
                        input,
                        invocation_context,
                    )
                    .await
                    .map_err(|reason| PluginCommandDiscoveryError::FrontendUnavailable {
                        plugin_id: descriptor.plugin_id,
                        reason,
                    })
            }
        }
    }

    fn resolve_project_id(
        &self,
        context: &PluginCommandDiscoveryContext,
    ) -> Result<String, PluginCommandDiscoveryError> {
        let task_id = context
            .task_id
            .as_deref()
            .filter(|value| !value.trim().is_empty());
        let requested_project_id = context
            .project_id
            .as_deref()
            .filter(|value| !value.trim().is_empty());
        if task_id.is_none() && requested_project_id.is_none() {
            return Err(PluginCommandDiscoveryError::MissingContext);
        }

        let database = self.database_lock()?;
        if let Some(task_id) = task_id {
            let task = database
                .get_task(task_id)
                .map_err(|error| {
                    PluginCommandDiscoveryError::Database(format!("Failed to get Task: {error}"))
                })?
                .ok_or_else(|| PluginCommandDiscoveryError::TaskNotFound {
                    task_id: task_id.to_string(),
                })?;
            let task_project_id =
                task.project_id
                    .ok_or_else(|| PluginCommandDiscoveryError::TaskMissingProject {
                        task_id: task_id.to_string(),
                    })?;
            if let Some(requested_project_id) = requested_project_id {
                if requested_project_id != task_project_id {
                    return Err(PluginCommandDiscoveryError::ConflictingContext {
                        task_id: task_id.to_string(),
                        task_project_id,
                        requested_project_id: requested_project_id.to_string(),
                    });
                }
            }
            self.require_project(&database, &task_project_id)?;
            return Ok(task_project_id);
        }

        let project_id = requested_project_id.expect("context presence checked");
        self.require_project(&database, project_id)?;
        Ok(project_id.to_string())
    }

    fn resolve_context(
        &self,
        context: &PluginCommandDiscoveryContext,
    ) -> Result<ResolvedPluginCommandContext, PluginCommandDiscoveryError> {
        let project_id = self.resolve_project_id(context)?;
        let task_id = context
            .task_id
            .as_ref()
            .filter(|value| !value.trim().is_empty())
            .cloned();
        Ok(ResolvedPluginCommandContext {
            task_id,
            project_id,
        })
    }

    fn require_project(
        &self,
        database: &crate::db::Database,
        project_id: &str,
    ) -> Result<(), PluginCommandDiscoveryError> {
        let exists = database
            .get_project(project_id)
            .map_err(|error| {
                PluginCommandDiscoveryError::Database(format!("Failed to get Project: {error}"))
            })?
            .is_some();
        if exists {
            Ok(())
        } else {
            Err(PluginCommandDiscoveryError::ProjectNotFound {
                project_id: project_id.to_string(),
            })
        }
    }

    fn database_lock(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, crate::db::Database>, PluginCommandDiscoveryError> {
        self.database.lock().map_err(|_| {
            PluginCommandDiscoveryError::Database(
                "plugin command database lock poisoned".to_string(),
            )
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures::future::BoxFuture;
    use serde_json::json;
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};

    #[derive(Debug, Clone, PartialEq)]
    struct FakeInvocation {
        plugin_id: String,
        project_id: String,
        command_id: String,
        input: Option<Value>,
        context: PluginCommandInvocationContext,
    }

    #[derive(Default)]
    struct FakeBackendCatalog {
        descriptors: HashMap<String, Vec<AgentCommandDescriptor>>,
        invocation_result: Value,
        invocations: Mutex<Vec<FakeInvocation>>,
    }

    impl BackendAgentCommandCatalog for FakeBackendCatalog {
        fn list_agent_commands<'a>(
            &'a self,
            plugin_id: &'a str,
            _project_id: &'a str,
        ) -> BoxFuture<'a, Result<Vec<AgentCommandDescriptor>, String>> {
            Box::pin(
                async move { Ok(self.descriptors.get(plugin_id).cloned().unwrap_or_default()) },
            )
        }

        fn invoke_agent_command<'a>(
            &'a self,
            plugin_id: &'a str,
            project_id: &'a str,
            command_id: &'a str,
            input: Option<Value>,
            context: PluginCommandInvocationContext,
        ) -> BoxFuture<'a, Result<Value, String>> {
            self.invocations
                .lock()
                .expect("invocations")
                .push(FakeInvocation {
                    plugin_id: plugin_id.to_string(),
                    project_id: project_id.to_string(),
                    command_id: command_id.to_string(),
                    input,
                    context,
                });
            Box::pin(async move { Ok(self.invocation_result.clone()) })
        }
    }

    fn descriptor(plugin_id: &str, command_id: &str, discoverable: bool) -> AgentCommandDescriptor {
        AgentCommandDescriptor {
            qualified_id: format!("{plugin_id}.{command_id}"),
            plugin_id: plugin_id.to_string(),
            runtime: AgentCommandRuntime::Backend,
            input: Some(json!({ "type": "object" })),
            output: Some(json!({ "type": "boolean" })),
            description: format!("Run {command_id}."),
            examples: vec![json!({ "force": true })],
            discoverable,
        }
    }

    fn seed_plugin(db: &crate::db::Database, plugin_id: &str, backend: bool) {
        db.install_plugin(&crate::db::PluginRow {
            id: plugin_id.to_string(),
            name: plugin_id.to_string(),
            version: "1.0.0".to_string(),
            api_version: 1,
            description: String::new(),
            permissions: "[]".to_string(),
            contributes: "{}".to_string(),
            frontend_entry: "dist/frontend.js".to_string(),
            backend_entry: backend.then(|| "dist/backend.js".to_string()),
            install_path: "/tmp/plugin".to_string(),
            source_kind: "test".to_string(),
            source_spec: plugin_id.to_string(),
            package_metadata: "{}".to_string(),
            installed_at: 0,
            is_builtin: false,
        })
        .expect("seed plugin");
    }

    fn backend_only_broker<Catalog>(
        database: Arc<Mutex<crate::db::Database>>,
        backend: &Catalog,
    ) -> PluginCommandBroker<'_, Catalog> {
        PluginCommandBroker {
            database,
            backend,
            frontend: None,
        }
    }

    #[tokio::test]
    async fn lists_only_catalog_discoverable_backend_commands_enabled_for_resolved_task_project() {
        let (database, _path) = crate::db::test_helpers::make_test_db("plugin_command_broker_list");
        let project = database
            .create_project("Project", "/tmp/project")
            .expect("project");
        let task = database
            .create_task("Task", "doing", Some(&project.id), None, None)
            .expect("task");
        seed_plugin(&database, "com.example.sync", true);
        seed_plugin(&database, "com.example.disabled", true);
        seed_plugin(&database, "com.example.frontend", false);
        database
            .set_plugin_enabled(&project.id, "com.example.sync", true)
            .expect("enable plugin");
        database
            .set_plugin_enabled(&project.id, "com.example.frontend", true)
            .expect("enable frontend plugin");
        let runtime = FakeBackendCatalog {
            descriptors: HashMap::from([
                (
                    "com.example.sync".to_string(),
                    vec![
                        descriptor("com.example.sync", "visible", true),
                        descriptor("com.example.sync", "hidden", false),
                        {
                            let mut spoofed = descriptor("com.example.other", "spoofed", true);
                            spoofed.qualified_id = "com.example.sync.spoofed".to_string();
                            spoofed
                        },
                    ],
                ),
                (
                    "com.example.disabled".to_string(),
                    vec![descriptor("com.example.disabled", "visible", true)],
                ),
            ]),
            ..Default::default()
        };
        let broker = backend_only_broker(Arc::new(Mutex::new(database)), &runtime);

        let commands = broker
            .list(&PluginCommandDiscoveryContext {
                task_id: Some(task.id),
                project_id: None,
            })
            .await
            .expect("list commands");

        assert_eq!(
            commands,
            vec![descriptor("com.example.sync", "visible", true)]
        );
    }

    #[tokio::test]
    async fn describes_hidden_exact_command_and_rejects_context_and_authorization_failures() {
        let (database, _path) =
            crate::db::test_helpers::make_test_db("plugin_command_broker_describe");
        let project = database
            .create_project("Project", "/tmp/project")
            .expect("project");
        let other = database
            .create_project("Other", "/tmp/other")
            .expect("other project");
        let task = database
            .create_task("Task", "doing", Some(&project.id), None, None)
            .expect("task");
        seed_plugin(&database, "com.example.sync", true);
        seed_plugin(&database, "com.example.disabled", true);
        database
            .set_plugin_enabled(&project.id, "com.example.sync", true)
            .expect("enable plugin");
        let runtime = FakeBackendCatalog {
            descriptors: HashMap::from([(
                "com.example.sync".to_string(),
                vec![descriptor("com.example.sync", "hidden", false)],
            )]),
            ..Default::default()
        };
        let broker = backend_only_broker(Arc::new(Mutex::new(database)), &runtime);

        let context = PluginCommandDiscoveryContext {
            task_id: Some(task.id.clone()),
            project_id: Some(project.id.clone()),
        };
        assert_eq!(
            broker
                .describe(&context, "com.example.sync.hidden")
                .await
                .expect("describe hidden command"),
            descriptor("com.example.sync", "hidden", false)
        );

        let conflict = broker
            .list(&PluginCommandDiscoveryContext {
                task_id: Some(task.id),
                project_id: Some(other.id),
            })
            .await
            .expect_err("conflicting context");
        assert!(matches!(
            conflict,
            PluginCommandDiscoveryError::ConflictingContext { .. }
        ));

        assert!(matches!(
            broker
                .list(&PluginCommandDiscoveryContext::default())
                .await
                .expect_err("missing context"),
            PluginCommandDiscoveryError::MissingContext
        ));
        assert!(matches!(
            broker
                .describe(
                    &PluginCommandDiscoveryContext {
                        task_id: None,
                        project_id: Some(project.id.clone()),
                    },
                    "com.example.disabled.command",
                )
                .await
                .expect_err("disabled plugin"),
            PluginCommandDiscoveryError::PluginDisabled { .. }
        ));
        assert!(matches!(
            broker
                .describe(
                    &PluginCommandDiscoveryContext {
                        task_id: None,
                        project_id: Some(project.id),
                    },
                    "com.example.missing.command",
                )
                .await
                .expect_err("uninstalled plugin"),
            PluginCommandDiscoveryError::PluginNotInstalled { .. }
        ));
    }

    #[tokio::test]
    async fn invokes_hidden_exact_backend_command_with_authoritative_separate_context() {
        let (database, _path) =
            crate::db::test_helpers::make_test_db("plugin_command_broker_invoke");
        let project = database
            .create_project("Project", "/tmp/project")
            .expect("project");
        let task = database
            .create_task("Task", "doing", Some(&project.id), None, None)
            .expect("task");
        seed_plugin(&database, "com.example.sync", true);
        database
            .set_plugin_enabled(&project.id, "com.example.sync", true)
            .expect("enable plugin");
        let runtime = FakeBackendCatalog {
            descriptors: HashMap::from([(
                "com.example.sync".to_string(),
                vec![descriptor("com.example.sync", "hidden", false)],
            )]),
            invocation_result: json!({ "synced": 3 }),
            ..Default::default()
        };
        let broker = backend_only_broker(Arc::new(Mutex::new(database)), &runtime);
        let input = json!({ "force": true });

        let result = broker
            .invoke(
                &PluginCommandDiscoveryContext {
                    task_id: Some(task.id.clone()),
                    project_id: None,
                },
                "com.example.sync.hidden",
                Some(input.clone()),
            )
            .await
            .expect("invoke hidden command");

        assert_eq!(result, json!({ "synced": 3 }));
        assert_eq!(
            runtime.invocations.lock().expect("invocations").as_slice(),
            &[FakeInvocation {
                plugin_id: "com.example.sync".to_string(),
                project_id: project.id.clone(),
                command_id: "com.example.sync.hidden".to_string(),
                input: Some(input),
                context: PluginCommandInvocationContext {
                    task_id: Some(task.id),
                    project_id: project.id,
                    source: PluginCommandInvocationSource::AgentCli,
                },
            }]
        );
    }

    impl FrontendAgentCommandCatalog for FakeBackendCatalog {
        fn list_frontend_agent_commands<'a>(
            &'a self,
            plugin_id: &'a str,
            _project_id: &'a str,
        ) -> BoxFuture<'a, Result<Vec<AgentCommandDescriptor>, String>> {
            Box::pin(
                async move { Ok(self.descriptors.get(plugin_id).cloned().unwrap_or_default()) },
            )
        }

        fn invoke_frontend_agent_command<'a>(
            &'a self,
            plugin_id: &'a str,
            project_id: &'a str,
            command_id: &'a str,
            input: Option<Value>,
            context: PluginCommandInvocationContext,
        ) -> BoxFuture<'a, Result<Value, String>> {
            self.invoke_agent_command(plugin_id, project_id, command_id, input, context)
        }
    }

    struct SelectivelyUnavailableFrontendCatalog {
        plugin_id: String,
    }

    impl FrontendAgentCommandCatalog for SelectivelyUnavailableFrontendCatalog {
        fn list_frontend_agent_commands<'a>(
            &'a self,
            plugin_id: &'a str,
            _project_id: &'a str,
        ) -> BoxFuture<'a, Result<Vec<AgentCommandDescriptor>, String>> {
            Box::pin(async move {
                if plugin_id == self.plugin_id {
                    Err(format!(
                        "Frontend runtime for Plugin {plugin_id} is unavailable"
                    ))
                } else {
                    Ok(Vec::new())
                }
            })
        }

        fn invoke_frontend_agent_command<'a>(
            &'a self,
            plugin_id: &'a str,
            _project_id: &'a str,
            _command_id: &'a str,
            _input: Option<Value>,
            _context: PluginCommandInvocationContext,
        ) -> BoxFuture<'a, Result<Value, String>> {
            Box::pin(async move {
                Err(format!(
                    "Frontend runtime for Plugin {plugin_id} is unavailable"
                ))
            })
        }
    }

    #[tokio::test]
    async fn lists_backend_commands_when_an_unrelated_plugin_frontend_is_unavailable() {
        let (database, _path) =
            crate::db::test_helpers::make_test_db("plugin_command_broker_partial_frontend");
        let project = database
            .create_project("Project", "/tmp/project")
            .expect("project");
        seed_plugin(&database, "com.example.sync", true);
        seed_plugin(&database, "com.example.unavailable", false);
        database
            .set_plugin_enabled(&project.id, "com.example.sync", true)
            .expect("enable backend plugin");
        database
            .set_plugin_enabled(&project.id, "com.example.unavailable", true)
            .expect("enable unavailable frontend plugin");
        let backend_command = descriptor("com.example.sync", "visible", true);
        let backend = FakeBackendCatalog {
            descriptors: HashMap::from([(
                "com.example.sync".to_string(),
                vec![backend_command.clone()],
            )]),
            ..Default::default()
        };
        let frontend = SelectivelyUnavailableFrontendCatalog {
            plugin_id: "com.example.unavailable".to_string(),
        };
        let broker =
            PluginCommandBroker::with_frontend(Arc::new(Mutex::new(database)), &backend, &frontend);

        assert_eq!(
            broker
                .list(&PluginCommandDiscoveryContext {
                    task_id: None,
                    project_id: Some(project.id),
                })
                .await
                .expect("list available commands"),
            vec![backend_command]
        );
    }

    #[tokio::test]
    async fn describes_exact_backend_command_when_its_plugin_frontend_is_unavailable() {
        let (database, _path) =
            crate::db::test_helpers::make_test_db("plugin_command_broker_backend_description");
        let project = database
            .create_project("Project", "/tmp/project")
            .expect("project");
        seed_plugin(&database, "com.example.sync", true);
        database
            .set_plugin_enabled(&project.id, "com.example.sync", true)
            .expect("enable plugin");
        let backend_command = descriptor("com.example.sync", "hidden", false);
        let backend = FakeBackendCatalog {
            descriptors: HashMap::from([(
                "com.example.sync".to_string(),
                vec![backend_command.clone()],
            )]),
            ..Default::default()
        };
        let frontend = SelectivelyUnavailableFrontendCatalog {
            plugin_id: "com.example.sync".to_string(),
        };
        let broker =
            PluginCommandBroker::with_frontend(Arc::new(Mutex::new(database)), &backend, &frontend);

        assert_eq!(
            broker
                .describe(
                    &PluginCommandDiscoveryContext {
                        task_id: None,
                        project_id: Some(project.id),
                    },
                    "com.example.sync.hidden",
                )
                .await
                .expect("describe backend command"),
            backend_command
        );
    }

    #[tokio::test]
    async fn describing_a_frontend_command_reports_its_unavailable_runtime() {
        let (database, _path) =
            crate::db::test_helpers::make_test_db("plugin_command_broker_frontend_unavailable");
        let project = database
            .create_project("Project", "/tmp/project")
            .expect("project");
        seed_plugin(&database, "com.example.browser", false);
        database
            .set_plugin_enabled(&project.id, "com.example.browser", true)
            .expect("enable plugin");
        let backend = FakeBackendCatalog::default();
        let frontend = SelectivelyUnavailableFrontendCatalog {
            plugin_id: "com.example.browser".to_string(),
        };
        let broker =
            PluginCommandBroker::with_frontend(Arc::new(Mutex::new(database)), &backend, &frontend);

        let error = broker
            .describe(
                &PluginCommandDiscoveryContext {
                    task_id: None,
                    project_id: Some(project.id),
                },
                "com.example.browser.open",
            )
            .await
            .expect_err("unavailable frontend command");

        assert_eq!(
            error,
            PluginCommandDiscoveryError::FrontendUnavailable {
                plugin_id: "com.example.browser".to_string(),
                reason: "Frontend runtime for Plugin com.example.browser is unavailable"
                    .to_string(),
            }
        );
    }

    #[tokio::test]
    async fn discovers_and_invokes_frontend_commands_through_the_shared_broker_seam() {
        let (database, _path) =
            crate::db::test_helpers::make_test_db("plugin_command_broker_frontend");
        let project = database
            .create_project("Project", "/tmp/project")
            .expect("project");
        let task = database
            .create_task("Task", "doing", Some(&project.id), None, None)
            .expect("task");
        seed_plugin(&database, "com.example.browser", false);
        database
            .set_plugin_enabled(&project.id, "com.example.browser", true)
            .expect("enable plugin");

        let backend = FakeBackendCatalog::default();
        let mut frontend_command = descriptor("com.example.browser", "open", true);
        frontend_command.runtime = AgentCommandRuntime::Frontend;
        let frontend = FakeBackendCatalog {
            descriptors: HashMap::from([(
                "com.example.browser".to_string(),
                vec![frontend_command.clone()],
            )]),
            invocation_result: json!({ "accepted": true }),
            ..Default::default()
        };
        let broker =
            PluginCommandBroker::with_frontend(Arc::new(Mutex::new(database)), &backend, &frontend);
        let context = PluginCommandDiscoveryContext {
            task_id: Some(task.id.clone()),
            project_id: None,
        };

        assert_eq!(
            broker.list(&context).await.expect("list"),
            vec![frontend_command]
        );
        assert_eq!(
            broker
                .invoke(
                    &context,
                    "com.example.browser.open",
                    Some(json!({ "url": "http://localhost:5173" })),
                )
                .await
                .expect("invoke"),
            json!({ "accepted": true })
        );
        assert_eq!(
            frontend.invocations.lock().expect("invocations")[0].context,
            PluginCommandInvocationContext {
                task_id: Some(task.id),
                project_id: project.id,
                source: PluginCommandInvocationSource::AgentCli,
            }
        );
    }
    #[test]
    fn agent_command_descriptor_round_trips_plugin_host_camel_case_json_without_handlers() {
        let value = json!({
            "qualifiedId": "com.example.sync.run",
            "pluginId": "com.example.sync",
            "runtime": "backend",
            "input": { "type": "object" },
            "output": { "type": "boolean" },
            "description": "Run synchronization.",
            "examples": [{ "force": true }],
            "discoverable": true
        });

        let descriptor: AgentCommandDescriptor =
            serde_json::from_value(value.clone()).expect("deserialize descriptor");
        assert_eq!(
            serde_json::to_value(descriptor).expect("serialize descriptor"),
            value
        );
        assert!(value.get("handler").is_none());
    }
}
