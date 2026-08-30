use super::Database;

pub(super) const COMPLETED_TASK_HISTORY_SIZE: i64 = 20_000;
pub(super) const ACTIVE_TASK_COUNT: i64 = 20;

pub(super) fn seed_project_task_history(db: &Database, project_id: &str) {
    let connection = db.connection();
    let mut conn = connection.lock().expect("lock connection");
    let transaction = conn.transaction().expect("start fixture transaction");

    transaction
        .execute(
            "WITH RECURSIVE sequence(value) AS (
                 SELECT 0
                 UNION ALL
                 SELECT value + 1 FROM sequence WHERE value + 1 < ?1
             )
             INSERT INTO tasks
                (id, initial_prompt, status, created_at, updated_at, project_id, prompt)
             SELECT printf('done-%05d', value), 'Completed task', 'done',
                    value, value, ?2, 'Completed task'
             FROM sequence",
            rusqlite::params![COMPLETED_TASK_HISTORY_SIZE, project_id],
        )
        .expect("insert completed task history");
    transaction
        .execute(
            "WITH RECURSIVE sequence(value) AS (
                 SELECT 0
                 UNION ALL
                 SELECT value + 1 FROM sequence WHERE value + 1 < ?1
             )
             INSERT INTO tasks
                (id, initial_prompt, status, created_at, updated_at, project_id, prompt)
             SELECT printf('active-%02d', value), 'Active task', 'backlog',
                    ?2 + value, ?2 + value, ?3, 'Active task'
             FROM sequence",
            rusqlite::params![ACTIVE_TASK_COUNT, COMPLETED_TASK_HISTORY_SIZE, project_id],
        )
        .expect("insert active tasks");
    transaction
        .execute(
            "WITH RECURSIVE sequence(value) AS (
                 SELECT 0
                 UNION ALL
                 SELECT value + 1 FROM sequence WHERE value + 1 < 10
             )
             INSERT INTO task_dependencies (task_id, depends_on_task_id, created_at)
             SELECT printf('active-%02d', value), printf('done-%05d', value), 1
             FROM sequence",
            [],
        )
        .expect("insert task dependencies");
    transaction.commit().expect("commit fixture transaction");
    conn.execute_batch("ANALYZE tasks;")
        .expect("analyze task indexes");
}
