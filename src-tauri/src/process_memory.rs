use crate::{
    db::AgentSessionRow,
    plugin_host::PluginHost,
    pty_manager::{PtyManager, TerminalSessionLifecycleState},
};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use sysinfo::{ProcessesToUpdate, System};

#[derive(Debug, Clone, PartialEq, Eq)]
struct ProcessInfo {
    pid: u32,
    parent_pid: Option<u32>,
    rss_bytes: u64,
    command: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProcessMemoryNode {
    pub pid: u32,
    pub parent_pid: Option<u32>,
    pub rss_bytes: u64,
    pub total_tree_rss_bytes: u64,
    pub command: String,
    pub children: Vec<ProcessMemoryNode>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PluginHostRuntimeMetricsStatus {
    Available,
    Unavailable,
    Error,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginHostMemoryDiagnostics {
    pub state: String,
    pub root_pid: Option<u32>,
    pub root_process: Option<ProcessMemoryNode>,
    pub root_rss_bytes: u64,
    pub total_tree_rss_bytes: u64,
    pub helper_processes: Vec<ProcessMemoryNode>,
    pub runtime_metrics_status: PluginHostRuntimeMetricsStatus,
    pub v8_memory_usage: Option<crate::plugin_host::PluginHostV8MemoryUsage>,
    pub plugins: Vec<crate::plugin_host::PluginLifecycleDiagnostics>,
    pub plugin_count: u64,
    pub plugins_truncated: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PtyProcessTreeMemoryDiagnostics {
    pub task_id: String,
    pub provider: Option<String>,
    pub agent_session_id: Option<String>,
    pub agent_session_status: Option<String>,
    pub pty_instance_id: u64,
    pub session_key: String,
    pub session_kind: String,
    pub lifecycle_state: TerminalSessionLifecycleState,
    pub root_pid: Option<u32>,
    pub pid_file_name: String,
    pub root_process: Option<ProcessMemoryNode>,
    pub root_rss_bytes: u64,
    pub total_tree_rss_bytes: u64,
    pub helper_processes: Vec<ProcessMemoryNode>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProcessMemoryTotals {
    pub sidecar_rss_bytes: u64,
    pub sidecar_total_tree_rss_bytes: u64,
    pub plugin_host_rss_bytes: u64,
    pub plugin_host_total_tree_rss_bytes: u64,
    pub pty_root_rss_bytes: u64,
    pub pty_total_tree_rss_bytes: u64,
    pub tracked_unique_rss_bytes: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProcessMemoryDiagnostics {
    pub collected_at: String,
    pub sidecar: ProcessMemoryNode,
    pub plugin_host: Option<PluginHostMemoryDiagnostics>,
    pub pty_process_trees: Vec<PtyProcessTreeMemoryDiagnostics>,
    pub github_response_cache: crate::github_client::GitHubResponseCacheDiagnostics,
    pub totals: ProcessMemoryTotals,
}

fn classify_plugin_host_runtime_diagnostics(
    result: Result<Option<crate::plugin_host::PluginHostRuntimeDiagnostics>, String>,
) -> (
    Option<crate::plugin_host::PluginHostRuntimeDiagnostics>,
    PluginHostRuntimeMetricsStatus,
) {
    match result {
        Ok(Some(diagnostics)) => (Some(diagnostics), PluginHostRuntimeMetricsStatus::Available),
        Ok(None) => (None, PluginHostRuntimeMetricsStatus::Unavailable),
        Err(_) => (None, PluginHostRuntimeMetricsStatus::Error),
    }
}

pub async fn collect_process_memory_diagnostics(
    db: Arc<Mutex<crate::db::Database>>,
    pty_manager: Option<PtyManager>,
    plugin_host: Option<PluginHost>,
    github_response_cache: crate::github_client::GitHubResponseCacheDiagnostics,
) -> Result<ProcessMemoryDiagnostics, String> {
    let processes = read_process_table()?;
    let sidecar_pid = std::process::id();
    let sidecar = build_process_tree(sidecar_pid, &processes).ok_or_else(|| {
        format!("current sidecar process {sidecar_pid} was not found in process table")
    })?;

    let plugin_host = match plugin_host {
        Some(host) => {
            let runtime = host.runtime_process_diagnostics()?;
            let (host_runtime, runtime_metrics_status) =
                classify_plugin_host_runtime_diagnostics(host.process_diagnostics().await);
            Some(plugin_host_memory_diagnostics(
                runtime,
                host_runtime,
                runtime_metrics_status,
                &processes,
            ))
        }
        None => None,
    };

    let pty_sessions = match pty_manager {
        Some(manager) => manager.process_diagnostic_sessions().await,
        None => Vec::new(),
    };
    let task_ids: Vec<String> = pty_sessions
        .iter()
        .map(|session| session.task_id.clone())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    let agent_sessions = {
        let db = db.lock().map_err(|_| {
            "database lock poisoned while collecting process memory diagnostics".to_string()
        })?;
        db.get_agent_sessions_for_tickets(&task_ids)
            .map_err(|e| format!("loading agent sessions for process memory diagnostics: {e}"))?
    };
    let pty_process_trees = pty_memory_diagnostics(&pty_sessions, &agent_sessions, &processes);
    let totals = build_totals(&sidecar, plugin_host.as_ref(), &pty_process_trees);

    Ok(ProcessMemoryDiagnostics {
        collected_at: chrono::Utc::now().to_rfc3339(),
        sidecar,
        plugin_host,
        pty_process_trees,
        github_response_cache,
        totals,
    })
}

fn plugin_host_memory_diagnostics(
    runtime: crate::plugin_host::PluginHostProcessDiagnostics,
    host_runtime: Option<crate::plugin_host::PluginHostRuntimeDiagnostics>,
    runtime_metrics_status: PluginHostRuntimeMetricsStatus,
    processes: &HashMap<u32, ProcessInfo>,
) -> PluginHostMemoryDiagnostics {
    let root_process = runtime
        .pid
        .and_then(|pid| build_process_tree(pid, processes));
    let helper_processes = root_process
        .as_ref()
        .map(flatten_descendants)
        .unwrap_or_default();
    let (v8_memory_usage, plugins, plugin_count, plugins_truncated) = match host_runtime {
        Some(diagnostics) => (
            Some(diagnostics.memory_usage),
            diagnostics.plugins,
            diagnostics.plugin_count,
            diagnostics.plugins_truncated,
        ),
        None => (None, Vec::new(), 0, false),
    };

    PluginHostMemoryDiagnostics {
        state: runtime.state,
        root_pid: runtime.pid,
        root_rss_bytes: root_process
            .as_ref()
            .map(|node| node.rss_bytes)
            .unwrap_or(0),
        total_tree_rss_bytes: root_process
            .as_ref()
            .map(|node| node.total_tree_rss_bytes)
            .unwrap_or(0),
        root_process,
        helper_processes,
        runtime_metrics_status,
        v8_memory_usage,
        plugins,
        plugin_count,
        plugins_truncated,
    }
}

fn pty_memory_diagnostics(
    pty_sessions: &[crate::pty_manager::PtyProcessDiagnosticSession],
    agent_sessions: &[AgentSessionRow],
    processes: &HashMap<u32, ProcessInfo>,
) -> Vec<PtyProcessTreeMemoryDiagnostics> {
    let mut latest_by_task: HashMap<&str, &AgentSessionRow> = HashMap::new();
    for session in agent_sessions {
        latest_by_task.entry(&session.ticket_id).or_insert(session);
    }

    let mut result = Vec::new();
    for pty in pty_sessions {
        let matched_session = if pty.session_kind == "agent" {
            agent_sessions
                .iter()
                .find(|session| {
                    session.ticket_id == pty.task_id
                        && session.pty_instance_id == Some(pty.pty_instance_id)
                })
                .or_else(|| latest_by_task.get(pty.task_id.as_str()).copied())
        } else {
            None
        };
        let root_process = pty.pid.and_then(|pid| build_process_tree(pid, processes));
        let helper_processes = root_process
            .as_ref()
            .map(flatten_descendants)
            .unwrap_or_default();

        result.push(PtyProcessTreeMemoryDiagnostics {
            task_id: pty.task_id.clone(),
            provider: matched_session.map(|session| session.provider.clone()),
            agent_session_id: matched_session.map(|session| session.id.clone()),
            agent_session_status: matched_session.map(|session| session.status.clone()),
            pty_instance_id: pty.pty_instance_id,
            session_key: pty.session_key.clone(),
            session_kind: pty.session_kind.clone(),
            lifecycle_state: pty.lifecycle_state,
            root_pid: pty.pid,
            pid_file_name: pty.pid_file_name.clone(),
            root_rss_bytes: root_process
                .as_ref()
                .map(|node| node.rss_bytes)
                .unwrap_or(0),
            total_tree_rss_bytes: root_process
                .as_ref()
                .map(|node| node.total_tree_rss_bytes)
                .unwrap_or(0),
            root_process,
            helper_processes,
        });
    }

    result.sort_by(|left, right| {
        left.task_id
            .cmp(&right.task_id)
            .then_with(|| left.session_key.cmp(&right.session_key))
            .then_with(|| left.pty_instance_id.cmp(&right.pty_instance_id))
    });
    result
}

fn build_totals(
    sidecar: &ProcessMemoryNode,
    plugin_host: Option<&PluginHostMemoryDiagnostics>,
    pty_process_trees: &[PtyProcessTreeMemoryDiagnostics],
) -> ProcessMemoryTotals {
    let mut unique_pids = HashSet::new();
    let mut tracked_unique_rss_bytes = 0;
    collect_unique_rss(sidecar, &mut unique_pids, &mut tracked_unique_rss_bytes);
    if let Some(plugin_host) = plugin_host.and_then(|diagnostics| diagnostics.root_process.as_ref())
    {
        collect_unique_rss(plugin_host, &mut unique_pids, &mut tracked_unique_rss_bytes);
    }
    for pty in pty_process_trees {
        if let Some(root) = pty.root_process.as_ref() {
            collect_unique_rss(root, &mut unique_pids, &mut tracked_unique_rss_bytes);
        }
    }

    ProcessMemoryTotals {
        sidecar_rss_bytes: sidecar.rss_bytes,
        sidecar_total_tree_rss_bytes: sidecar.total_tree_rss_bytes,
        plugin_host_rss_bytes: plugin_host
            .map(|diagnostics| diagnostics.root_rss_bytes)
            .unwrap_or(0),
        plugin_host_total_tree_rss_bytes: plugin_host
            .map(|diagnostics| diagnostics.total_tree_rss_bytes)
            .unwrap_or(0),
        pty_root_rss_bytes: pty_process_trees
            .iter()
            .map(|diagnostics| diagnostics.root_rss_bytes)
            .sum(),
        pty_total_tree_rss_bytes: pty_process_trees
            .iter()
            .map(|diagnostics| diagnostics.total_tree_rss_bytes)
            .sum(),
        tracked_unique_rss_bytes,
    }
}

fn collect_unique_rss(node: &ProcessMemoryNode, seen: &mut HashSet<u32>, total: &mut u64) {
    if seen.insert(node.pid) {
        *total = total.saturating_add(node.rss_bytes);
    }
    for child in &node.children {
        collect_unique_rss(child, seen, total);
    }
}

fn build_process_tree(
    root_pid: u32,
    processes: &HashMap<u32, ProcessInfo>,
) -> Option<ProcessMemoryNode> {
    let mut child_pids_by_parent: HashMap<u32, Vec<u32>> = HashMap::new();
    for process in processes.values() {
        if let Some(parent_pid) = process.parent_pid {
            child_pids_by_parent
                .entry(parent_pid)
                .or_default()
                .push(process.pid);
        }
    }
    for child_pids in child_pids_by_parent.values_mut() {
        child_pids.sort_unstable();
    }

    let mut visited = HashSet::new();
    build_process_tree_from_children(root_pid, processes, &child_pids_by_parent, &mut visited)
}

fn build_process_tree_from_children(
    root_pid: u32,
    processes: &HashMap<u32, ProcessInfo>,
    child_pids_by_parent: &HashMap<u32, Vec<u32>>,
    visited: &mut HashSet<u32>,
) -> Option<ProcessMemoryNode> {
    if !visited.insert(root_pid) {
        return None;
    }

    let process = processes.get(&root_pid)?;
    let children: Vec<ProcessMemoryNode> = child_pids_by_parent
        .get(&root_pid)
        .into_iter()
        .flat_map(|child_pids| child_pids.iter())
        .filter_map(|child_pid| {
            build_process_tree_from_children(*child_pid, processes, child_pids_by_parent, visited)
        })
        .collect();
    let children_rss = children
        .iter()
        .map(|child| child.total_tree_rss_bytes)
        .sum::<u64>();

    Some(ProcessMemoryNode {
        pid: process.pid,
        parent_pid: process.parent_pid,
        rss_bytes: process.rss_bytes,
        total_tree_rss_bytes: process.rss_bytes.saturating_add(children_rss),
        command: process.command.clone(),
        children,
    })
}

fn flatten_descendants(root: &ProcessMemoryNode) -> Vec<ProcessMemoryNode> {
    let mut descendants = Vec::new();
    for child in &root.children {
        descendants.push(child.clone());
        descendants.extend(flatten_descendants(child));
    }
    descendants
}

#[cfg(test)]
fn parse_ps_output(output: &str) -> HashMap<u32, ProcessInfo> {
    let mut processes = HashMap::new();
    for line in output.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 3 {
            continue;
        }
        let Some(pid) = parts.first().and_then(|part| part.parse::<u32>().ok()) else {
            continue;
        };
        let parent_pid = parts
            .get(1)
            .and_then(|part| part.parse::<u32>().ok())
            .filter(|pid| *pid != 0);
        let rss_bytes = parts
            .get(2)
            .and_then(|part| part.parse::<u64>().ok())
            .unwrap_or(0)
            .saturating_mul(1024);
        let command = parts.get(3..).unwrap_or(&[]).join(" ");
        processes.insert(
            pid,
            ProcessInfo {
                pid,
                parent_pid,
                rss_bytes,
                command,
            },
        );
    }
    processes
}

fn read_process_table() -> Result<HashMap<u32, ProcessInfo>, String> {
    let mut system = System::new_all();
    system.refresh_processes(ProcessesToUpdate::All, true);

    let processes: HashMap<u32, ProcessInfo> = system
        .processes()
        .iter()
        .map(|(pid, process)| {
            let command = process
                .cmd()
                .iter()
                .map(|part| part.to_string_lossy())
                .collect::<Vec<_>>()
                .join(" ");
            let command = if command.is_empty() {
                process.name().to_string_lossy().into_owned()
            } else {
                command
            };

            (
                pid.as_u32(),
                ProcessInfo {
                    pid: pid.as_u32(),
                    parent_pid: process
                        .parent()
                        .map(|parent| parent.as_u32())
                        .filter(|pid| *pid != 0),
                    rss_bytes: process.memory(),
                    command,
                },
            )
        })
        .collect();

    if processes.is_empty() {
        Err("process memory diagnostics could not read any process metadata".to_string())
    } else {
        Ok(processes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pty_manager::PtyProcessDiagnosticSession;

    fn session(
        id: &str,
        task_id: &str,
        provider: &str,
        status: &str,
        pty_instance_id: Option<u64>,
    ) -> AgentSessionRow {
        AgentSessionRow {
            id: id.to_string(),
            ticket_id: task_id.to_string(),
            opencode_session_id: None,
            stage: "implementation".to_string(),
            status: status.to_string(),
            checkpoint_data: None,
            pty_instance_id,
            error_message: None,
            created_at: 1,
            updated_at: 1,
            provider: provider.to_string(),
            claude_session_id: None,
            pi_session_id: None,
            grok_session_id: None,
        }
    }

    #[test]
    fn parse_ps_output_preserves_commands_with_spaces_and_converts_rss_to_bytes() {
        let processes = parse_ps_output(
            "  10   1  2048 /Applications/OpenForge.app/sidecar --serve\n  11  10   512 node helper with spaces\n",
        );

        assert_eq!(processes[&10].parent_pid, Some(1));
        assert_eq!(processes[&10].rss_bytes, 2_097_152);
        assert_eq!(
            processes[&10].command,
            "/Applications/OpenForge.app/sidecar --serve"
        );
        assert_eq!(processes[&11].command, "node helper with spaces");
    }

    #[test]
    fn build_process_tree_totals_root_and_helper_children() {
        let processes = parse_ps_output(
            "10 1 100 sidecar\n11 10 25 pi\n12 11 5 context-helper\n13 10 30 plugin-host\n",
        );

        let tree = build_process_tree(10, &processes).expect("tree");
        assert_eq!(tree.rss_bytes, 102_400);
        assert_eq!(tree.total_tree_rss_bytes, 160 * 1024);
        let helpers = flatten_descendants(&tree);
        assert_eq!(
            helpers
                .iter()
                .map(|process| process.pid)
                .collect::<Vec<_>>(),
            vec![11, 12, 13]
        );
    }

    #[test]
    fn pty_memory_diagnostics_matches_provider_and_status_by_pty_instance() {
        let processes = parse_ps_output("10 1 100 sidecar\n20 10 25 pi\n21 20 5 context-helper\n");
        let pty_sessions = vec![PtyProcessDiagnosticSession {
            session_key: "KVG-1".to_string(),
            task_id: "KVG-1".to_string(),
            session_kind: "agent".to_string(),
            lifecycle_state: TerminalSessionLifecycleState::Live,
            pid: Some(20),
            pty_instance_id: 7,
            pid_file_name: "KVG-1-pty.pid".to_string(),
        }];
        let agent_sessions = vec![
            session("old", "KVG-1", "claude-code", "completed", Some(6)),
            session("current", "KVG-1", "pi", "running", Some(7)),
        ];

        let diagnostics = pty_memory_diagnostics(&pty_sessions, &agent_sessions, &processes);

        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].provider.as_deref(), Some("pi"));
        assert_eq!(diagnostics[0].agent_session_id.as_deref(), Some("current"));
        assert_eq!(
            diagnostics[0].agent_session_status.as_deref(),
            Some("running")
        );
        assert_eq!(diagnostics[0].root_rss_bytes, 25 * 1024);
        assert_eq!(diagnostics[0].total_tree_rss_bytes, 30 * 1024);
        assert_eq!(diagnostics[0].helper_processes[0].pid, 21);
    }

    #[test]
    fn totals_deduplicate_processes_that_appear_under_multiple_roots() {
        let processes = parse_ps_output("10 1 100 sidecar\n20 10 25 pi\n21 20 5 helper\n");
        let sidecar = build_process_tree(10, &processes).expect("sidecar");
        let pty_root = build_process_tree(20, &processes).expect("pty");
        let pty = PtyProcessTreeMemoryDiagnostics {
            task_id: "KVG-1".to_string(),
            provider: Some("pi".to_string()),
            agent_session_id: Some("ses".to_string()),
            agent_session_status: Some("running".to_string()),
            pty_instance_id: 1,
            session_key: "KVG-1".to_string(),
            session_kind: "agent".to_string(),
            lifecycle_state: TerminalSessionLifecycleState::Live,
            root_pid: Some(20),
            pid_file_name: "KVG-1-pty.pid".to_string(),
            root_process: Some(pty_root),
            root_rss_bytes: 25 * 1024,
            total_tree_rss_bytes: 30 * 1024,
            helper_processes: Vec::new(),
        };

        let totals = build_totals(&sidecar, None, &[pty]);

        assert_eq!(totals.sidecar_total_tree_rss_bytes, 130 * 1024);
        assert_eq!(totals.pty_total_tree_rss_bytes, 30 * 1024);
        assert_eq!(totals.tracked_unique_rss_bytes, 130 * 1024);
    }

    #[test]
    fn pty_memory_diagnostics_does_not_attribute_shell_pty_to_latest_agent_session() {
        let processes = parse_ps_output("10 1 100 sidecar\n20 10 25 shell\n21 20 5 helper\n");
        let pty_sessions = vec![PtyProcessDiagnosticSession {
            session_key: "KVG-1-shell-0".to_string(),
            task_id: "KVG-1".to_string(),
            session_kind: "shell".to_string(),
            lifecycle_state: TerminalSessionLifecycleState::Live,
            pid: Some(20),
            pty_instance_id: 99,
            pid_file_name: "KVG-1-shell-0.pid".to_string(),
        }];
        let agent_sessions = vec![session("latest-agent", "KVG-1", "pi", "running", Some(7))];

        let diagnostics = pty_memory_diagnostics(&pty_sessions, &agent_sessions, &processes);

        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].session_kind, "shell");
        assert_eq!(diagnostics[0].provider, None);
        assert_eq!(diagnostics[0].agent_session_id, None);
        assert_eq!(diagnostics[0].agent_session_status, None);
    }

    #[test]
    fn plugin_host_memory_diagnostics_exposes_v8_and_lifecycle_attribution() {
        let processes = parse_ps_output("30 10 120 plugin-host\n31 30 5 helper\n");
        let runtime = crate::plugin_host::PluginHostProcessDiagnostics {
            state: "Running".to_string(),
            pid: Some(30),
        };
        let host_runtime = crate::plugin_host::PluginHostRuntimeDiagnostics {
            memory_usage: crate::plugin_host::PluginHostV8MemoryUsage {
                rss_bytes: 100_000,
                heap_total_bytes: 80_000,
                heap_used_bytes: 60_000,
                external_bytes: 20_000,
                array_buffers_bytes: 10_000,
            },
            plugins: vec![crate::plugin_host::PluginLifecycleDiagnostics {
                plugin_id: "com.example.memory".to_string(),
                state: crate::plugin_host::PluginBackendReadyState::Missing,
                active: false,
                activation_count: 2,
                reload_count: 1,
            }],
            plugin_count: 1,
            plugins_truncated: false,
        };

        let diagnostics = plugin_host_memory_diagnostics(
            runtime,
            Some(host_runtime),
            PluginHostRuntimeMetricsStatus::Available,
            &processes,
        );

        assert_eq!(diagnostics.root_rss_bytes, 120 * 1024);
        assert_eq!(
            diagnostics.runtime_metrics_status,
            PluginHostRuntimeMetricsStatus::Available
        );
        assert_eq!(
            diagnostics
                .v8_memory_usage
                .as_ref()
                .expect("V8 memory should be present")
                .heap_used_bytes,
            60_000
        );
        assert_eq!(diagnostics.plugins[0].plugin_id, "com.example.memory");
        assert!(!diagnostics.plugins[0].active);
        assert_eq!(diagnostics.plugins[0].reload_count, 1);
        assert_eq!(diagnostics.plugin_count, 1);
        assert!(!diagnostics.plugins_truncated);
        let json = serde_json::to_value(&diagnostics).expect("diagnostics should serialize");
        assert_eq!(json["v8MemoryUsage"]["heapUsedBytes"], 60_000);
        assert_eq!(json["plugins"][0]["activationCount"], 2);
        assert!(json["plugins"][0].get("backendPath").is_none());
    }

    #[test]
    fn plugin_host_diagnostics_failure_is_explicit_without_error_content() {
        let (runtime, status) = classify_plugin_host_runtime_diagnostics(Err(
            "contract failure with plugin payload".to_string(),
        ));

        assert!(runtime.is_none());
        assert_eq!(status, PluginHostRuntimeMetricsStatus::Error);
        assert_eq!(
            serde_json::to_value(status).expect("status should serialize"),
            "error"
        );
    }
}
