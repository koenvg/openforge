use super::{
    migrations::TASK_QUERY_INDEXES_SQL,
    task_persistence_test_support::{seed_project_task_history, COMPLETED_TASK_HISTORY_SIZE},
    test_helpers::make_test_db,
    Database,
};
use std::{
    hint::black_box,
    time::{Duration, Instant},
};

const SAMPLE_COUNT: usize = 9;
const DROP_TASK_QUERY_INDEXES_SQL: &str = "DROP INDEX IF EXISTS idx_tasks_project_updated_at;
     DROP INDEX IF EXISTS idx_tasks_project_active_updated_at;
     DROP INDEX IF EXISTS idx_tasks_project_completed_updated_at;";

#[derive(Debug)]
struct RefreshTimings {
    active: Duration,
    completed: Duration,
    relationships: Duration,
}

fn set_task_query_indexes(db: &Database, enabled: bool) {
    let connection = db.connection();
    let conn = connection.lock().expect("lock connection");
    conn.execute_batch(if enabled {
        TASK_QUERY_INDEXES_SQL
    } else {
        DROP_TASK_QUERY_INDEXES_SQL
    })
    .expect("toggle task query indexes");
    conn.execute_batch("ANALYZE tasks;")
        .expect("analyze task indexes");
}

fn measure_refreshes(db: &Database, project_id: &str) -> RefreshTimings {
    let active_started = Instant::now();
    let active = db
        .get_compact_tasks_for_project_excluding_state(project_id, "done")
        .expect("refresh active tasks");
    let active_elapsed = active_started.elapsed();
    black_box(active.len());

    let completed_started = Instant::now();
    let completed = db
        .get_compact_tasks_for_project_by_state(project_id, "done")
        .expect("refresh completed tasks");
    let completed_elapsed = completed_started.elapsed();
    black_box(completed.len());

    let relationships_started = Instant::now();
    let relationships = db
        .get_task_relationship_references_for_project(project_id)
        .expect("refresh relationship references");
    let relationships_elapsed = relationships_started.elapsed();
    black_box(relationships.len());

    RefreshTimings {
        active: active_elapsed,
        completed: completed_elapsed,
        relationships: relationships_elapsed,
    }
}

fn median(samples: &[RefreshTimings], select: impl Fn(&RefreshTimings) -> Duration) -> Duration {
    let mut values = samples.iter().map(select).collect::<Vec<_>>();
    values.sort_unstable();
    values[values.len() / 2]
}

#[test]
#[ignore = "manual scale measurement"]
fn measure_project_refreshes_with_large_completed_history() {
    let (db, _temp_dir) = make_test_db("task_refresh_benchmark");
    let project = db
        .create_project("Benchmark project", "/tmp/task-refresh-benchmark")
        .expect("create project");
    seed_project_task_history(&db, &project.id);

    let mut indexed_samples = Vec::with_capacity(SAMPLE_COUNT);
    let mut unindexed_samples = Vec::with_capacity(SAMPLE_COUNT);
    for round in 0..SAMPLE_COUNT {
        let conditions = if round % 2 == 0 {
            [true, false]
        } else {
            [false, true]
        };
        for indexed in conditions {
            set_task_query_indexes(&db, indexed);
            black_box(measure_refreshes(&db, &project.id));
            let sample = measure_refreshes(&db, &project.id);
            if indexed {
                indexed_samples.push(sample);
            } else {
                unindexed_samples.push(sample);
            }
        }
    }

    eprintln!(
        "median of {SAMPLE_COUNT} warmed, interleaved samples with \
         {COMPLETED_TASK_HISTORY_SIZE} completed tasks:\n\
         indexed active={:?}, completed={:?}, relationships={:?}\n\
         no indexes active={:?}, completed={:?}, relationships={:?}",
        median(&indexed_samples, |sample| sample.active),
        median(&indexed_samples, |sample| sample.completed),
        median(&indexed_samples, |sample| sample.relationships),
        median(&unindexed_samples, |sample| sample.active),
        median(&unindexed_samples, |sample| sample.completed),
        median(&unindexed_samples, |sample| sample.relationships),
    );
}
