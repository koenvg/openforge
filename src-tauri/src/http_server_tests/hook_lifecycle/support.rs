use super::*;

pub(super) struct AgentSessionFixture<'a> {
    pub(super) task_title: &'a str,
    pub(super) session_id: &'a str,
    pub(super) status: &'a str,
    pub(super) provider: &'a str,
    pub(super) pty_instance_id: u64,
}

pub(super) fn create_agent_session_fixture(
    state: &AppState,
    fixture: AgentSessionFixture<'_>,
) -> String {
    let db = state.db.lock().expect("lock db");
    let task = db
        .create_task(fixture.task_title, "doing", None, None, None)
        .expect("create task");
    db.create_agent_session(
        fixture.session_id,
        &task.id,
        None,
        "implementing",
        fixture.status,
        fixture.provider,
    )
    .expect("create agent session");
    db.set_agent_session_pty_instance_id(fixture.session_id, fixture.pty_instance_id)
        .expect("store pty instance");
    task.id
}
