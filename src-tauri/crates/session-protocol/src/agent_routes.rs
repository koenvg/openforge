//! Transport allowlist, not domain dispatch. Hooks and controller routes are deliberately absent.
pub fn agent_route_allowed(method: &str, path: &str) -> bool {
    let segments: Vec<_> = path.strip_prefix('/').unwrap_or("").split('/').collect();
    if !path.starts_with('/')
        || segments.iter().any(|s| {
            s.is_empty()
                || !s
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        })
    {
        return false;
    }
    match method {
        "POST" => matches!(
            path,
            "/create_task"
                | "/start_task"
                | "/update_task"
                | "/delete_task"
                | "/hard_delete_task"
                | "/set_task_dependencies"
                | "/add_task_dependency"
                | "/link_task_chain"
                | "/add_task_label"
                | "/remove_task_label"
                | "/install_plugin_from_local"
                | "/set_plugin_enabled"
                | "/set_app_plugin_enabled"
                | "/reload_plugin"
                | "/plugin_commands/list"
                | "/plugin_commands/describe"
                | "/plugin_commands/invoke"
                | "/review_threads/list"
                | "/review_threads/create"
                | "/review_threads/reply"
                | "/review_threads/status"
        ),
        "GET" => matches!(
            segments.as_slice(),
            ["projects"]
                | ["tasks"]
                | ["task", _]
                | ["task", _, "labels"]
                | ["project", _, "labels"]
                | ["project", _, "attention"]
                | ["v2", "projects", _, "tasks", _]
                | ["debug", "process-memory"]
                | ["debug", "process-memory", "history"]
        ),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::agent_route_allowed;

    #[test]
    fn the_review_thread_write_and_read_routes_are_reachable_by_an_agent() {
        for path in [
            "/review_threads/list",
            "/review_threads/create",
            "/review_threads/reply",
            "/review_threads/status",
        ] {
            assert!(agent_route_allowed("POST", path), "{path}");
        }
    }

    #[test]
    fn a_review_thread_route_that_is_not_listed_is_refused() {
        for (method, path) in [
            ("POST", "/review_threads/delete"),
            ("POST", "/review_threads"),
            ("POST", "/review_threads/list/all"),
            ("GET", "/review_threads/list"),
            ("DELETE", "/review_threads/create"),
        ] {
            assert!(!agent_route_allowed(method, path), "{method} {path}");
        }
    }
}
