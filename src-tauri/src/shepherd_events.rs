use std::time::{Duration, Instant};

use crate::shepherd_prompt::ShepherdEvent;

pub struct ShepherdEventCollector {
    events: Vec<ShepherdEvent>,
    last_flush: Instant,
    debounce_interval: Duration,
}

impl ShepherdEventCollector {
    pub fn new(debounce_interval: Duration) -> Self {
        Self {
            events: Vec::new(),
            last_flush: Instant::now(),
            debounce_interval,
        }
    }

    pub fn push(&mut self, event: ShepherdEvent) {
        self.events.push(event);
    }

    pub fn should_flush(&self) -> bool {
        !self.events.is_empty() && self.last_flush.elapsed() >= self.debounce_interval
    }

    pub fn flush(&mut self) -> Vec<ShepherdEvent> {
        self.last_flush = Instant::now();
        std::mem::take(&mut self.events)
    }

    pub fn len(&self) -> usize {
        self.events.len()
    }

    pub fn is_empty(&self) -> bool {
        self.events.is_empty()
    }

    pub fn debounce_remaining(&self) -> Duration {
        let elapsed = self.last_flush.elapsed();
        self.debounce_interval.saturating_sub(elapsed)
    }
}

pub fn map_ci_status_changed(payload: &serde_json::Value) -> Option<ShepherdEvent> {
    let task_id = payload.get("task_id")?.as_str()?.to_owned();
    let pr_id = payload.get("pr_id")?.as_i64()?;
    let status = payload.get("ci_status")?.as_str()?.to_owned();
    Some(ShepherdEvent::CiStatusChanged {
        task_id,
        pr_id,
        status,
    })
}

pub fn map_agent_completed(payload: &serde_json::Value) -> Option<ShepherdEvent> {
    let task_id = payload.get("task_id")?.as_str()?.to_owned();
    Some(ShepherdEvent::AgentCompleted { task_id })
}

pub fn map_review_status_changed(payload: &serde_json::Value) -> Option<ShepherdEvent> {
    let task_id = payload.get("task_id")?.as_str()?.to_owned();
    let pr_id = payload.get("pr_id")?.as_i64()?;
    let status = payload.get("review_status")?.as_str()?.to_owned();
    Some(ShepherdEvent::PrReviewChanged {
        task_id,
        pr_id,
        status,
    })
}

pub fn map_new_pr_comment(payload: &serde_json::Value) -> Option<ShepherdEvent> {
    let task_id = payload
        .get("ticket_id")
        .or_else(|| payload.get("task_id"))?
        .as_str()?
        .to_owned();
    let pr_id = payload.get("pr_id").and_then(|v| v.as_i64()).unwrap_or(0);
    Some(ShepherdEvent::NewPrComment { task_id, pr_id })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    #[test]
    fn test_shepherd_event_debounce() {
        let interval = Duration::from_millis(100);
        let mut collector = ShepherdEventCollector::new(interval);

        thread::sleep(Duration::from_millis(150));
        assert!(!collector.should_flush(), "empty buffer must not flush");

        collector.push(ShepherdEvent::AgentCompleted {
            task_id: "T-1".to_owned(),
        });
        assert!(
            collector.should_flush(),
            "non-empty buffer after interval must flush"
        );

        let events = collector.flush();
        assert_eq!(events.len(), 1);
        assert!(collector.is_empty());

        collector.push(ShepherdEvent::AgentCompleted {
            task_id: "T-2".to_owned(),
        });
        assert!(
            !collector.should_flush(),
            "should not flush before interval elapses"
        );

        thread::sleep(Duration::from_millis(150));
        assert!(collector.should_flush());
    }

    #[test]
    fn test_shepherd_event_debounce_no_flush_before_interval() {
        let interval = Duration::from_millis(500);
        let mut collector = ShepherdEventCollector::new(interval);

        collector.push(ShepherdEvent::AgentCompleted {
            task_id: "T-1".to_owned(),
        });
        assert!(!collector.should_flush());
        assert_eq!(collector.len(), 1);
    }

    #[test]
    fn test_shepherd_event_mapping_ci() {
        let payload = serde_json::json!({
            "task_id": "T-42",
            "pr_id": 7,
            "pr_title": "Fix the thing",
            "ci_status": "failure",
            "timestamp": 1234567890u64
        });

        let event = map_ci_status_changed(&payload).expect("should map");
        match event {
            ShepherdEvent::CiStatusChanged {
                task_id,
                pr_id,
                status,
            } => {
                assert_eq!(task_id, "T-42");
                assert_eq!(pr_id, 7);
                assert_eq!(status, "failure");
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn test_shepherd_event_mapping_ci_missing_field() {
        let payload = serde_json::json!({ "task_id": "T-42", "pr_id": 7 });
        assert!(map_ci_status_changed(&payload).is_none());
    }

    #[test]
    fn test_shepherd_event_mapping_agent_completed() {
        let payload = serde_json::json!({ "task_id": "T-99" });

        let event = map_agent_completed(&payload).expect("should map");
        match event {
            ShepherdEvent::AgentCompleted { task_id } => {
                assert_eq!(task_id, "T-99");
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn test_shepherd_event_mapping_agent_completed_missing_task_id() {
        let payload = serde_json::json!({ "status": "completed" });
        assert!(map_agent_completed(&payload).is_none());
    }

    #[test]
    fn test_shepherd_event_mapping_review_status() {
        let payload = serde_json::json!({
            "task_id": "T-10",
            "pr_id": 3,
            "review_status": "changes_requested",
            "timestamp": 111u64
        });

        let event = map_review_status_changed(&payload).expect("should map");
        match event {
            ShepherdEvent::PrReviewChanged {
                task_id,
                pr_id,
                status,
            } => {
                assert_eq!(task_id, "T-10");
                assert_eq!(pr_id, 3);
                assert_eq!(status, "changes_requested");
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn test_shepherd_event_mapping_new_pr_comment() {
        let payload = serde_json::json!({
            "ticket_id": "T-55",
            "comment_id": 456
        });

        let event = map_new_pr_comment(&payload).expect("should map");
        match event {
            ShepherdEvent::NewPrComment { task_id, pr_id } => {
                assert_eq!(task_id, "T-55");
                assert_eq!(pr_id, 0, "pr_id defaults to 0 when absent");
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn test_shepherd_event_mapping_new_pr_comment_with_task_id_fallback() {
        let payload = serde_json::json!({
            "task_id": "T-77",
            "pr_id": 12,
            "comment_id": 789
        });

        let event = map_new_pr_comment(&payload).expect("should map");
        match event {
            ShepherdEvent::NewPrComment { task_id, pr_id } => {
                assert_eq!(task_id, "T-77");
                assert_eq!(pr_id, 12);
            }
            _ => panic!("wrong variant"),
        }
    }
}
