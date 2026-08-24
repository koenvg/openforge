use super::*;

#[tokio::test]
async fn task_label_domain_errors_keep_the_existing_bad_request_contract() {
    let (state, _temp_dir) = test_state("app_invoke_task_label_domain_errors");
    let (project, projectless_task) = {
        let db = crate::db::acquire_db(&state.db);
        let project = db
            .create_project("Labels", "/tmp/app-invoke-labels")
            .expect("create project");
        let projectless_task = db
            .create_task("Projectless", "backlog", None, None, None)
            .expect("create projectless task");
        (project, projectless_task)
    };

    for (command, payload, expected_message) in [
        (
            "create_task_label",
            json!({ "projectId": project.id, "name": "   " }),
            "Failed to create task label: label name is required",
        ),
        (
            "create_task_label",
            json!({ "projectId": project.id, "name": "x".repeat(41) }),
            "Failed to create task label: label names must be 40 characters or fewer",
        ),
        (
            "add_task_label",
            json!({ "taskId": "T-missing", "name": "bug" }),
            "Failed to add task label: task T-missing does not exist",
        ),
        (
            "add_task_label",
            json!({ "taskId": projectless_task.id, "name": "bug" }),
            &format!(
                "Failed to add task label: task {} must belong to a project before labels can be assigned",
                projectless_task.id
            ),
        ),
    ] {
        let error = invoke(&state, command, payload)
            .await
            .expect_err("Task Label domain failure should be rejected");

        assert_eq!(error.0, StatusCode::BAD_REQUEST);
        assert_eq!(error.1, expected_message);
    }
}
