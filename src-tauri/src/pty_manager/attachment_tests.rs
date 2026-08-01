use super::attachment::{AgentTerminalEvent, PtyAttachmentHub};
use super::PtyManager;

#[tokio::test]
async fn agent_terminal_availability_requires_a_concrete_running_agent_pty() {
    let manager = PtyManager::new();
    assert!(!manager.agent_terminal_available("missing-task").await);
    assert!(manager.attach_agent_terminal("missing-task").await.is_err());
}

#[tokio::test]
async fn attachment_replay_and_live_subscription_have_one_atomic_boundary() {
    let hub = PtyAttachmentHub::new(7, 1024, 8);
    hub.publish_output(b"before");

    let (replay, mut receiver) = hub.attach();
    hub.publish_output(b"after");

    assert_eq!(replay, b"before");
    assert_eq!(
        receiver.recv().await.expect("live output"),
        AgentTerminalEvent::Output(b"after".to_vec())
    );
}

#[test]
fn attachment_replay_is_bounded_valid_utf8() {
    let hub = PtyAttachmentHub::new(8, 5, 8);
    hub.publish_output("ééé".as_bytes());

    let (replay, _) = hub.attach();

    assert!(replay.len() <= 5);
    assert_eq!(std::str::from_utf8(&replay).expect("UTF-8 replay"), "éé");
}

#[tokio::test]
async fn attachment_detects_a_slow_consumer_instead_of_dropping_silently() {
    let hub = PtyAttachmentHub::new(10, 1024, 2);
    let (_, mut receiver) = hub.attach();
    hub.publish_output(b"one");
    hub.publish_output(b"two");
    hub.publish_output(b"three");

    assert!(matches!(
        receiver.recv().await,
        Err(tokio::sync::broadcast::error::RecvError::Lagged(_))
    ));
}

#[test]
fn attachment_replaces_chunked_iterm_images_without_affecting_surrounding_output() {
    let hub = PtyAttachmentHub::new(11, 1024, 8);
    hub.publish_output(b"before\x1b]1337;Fi");
    hub.publish_output(b"le=size=4;inline=1:AAAA");
    hub.publish_output(b"\x1b");
    hub.publish_output(b"\\after");

    let (replay, _) = hub.attach();
    assert_eq!(
        std::str::from_utf8(&replay).expect("filtered replay"),
        "before\r\n[Image unavailable on mobile]\r\nafter"
    );
}

#[test]
fn attachment_filter_bounds_large_and_unterminated_image_payloads() {
    let hub = PtyAttachmentHub::new(12, 1024, 8);
    hub.publish_output(b"\x1b]1337;File=size=2097152;inline=1:");
    hub.publish_output(&vec![b'A'; 2 * 1024 * 1024]);
    assert!(hub.attach().0.is_empty());

    hub.publish_exit(12);
    let (replay, _) = hub.attach();
    assert_eq!(
        std::str::from_utf8(&replay).expect("filtered replay"),
        "\r\n[Image unavailable on mobile]\r\n"
    );
}

#[tokio::test]
async fn attachment_exit_is_bound_to_the_resolved_instance() {
    let hub = PtyAttachmentHub::new(9, 1024, 8);
    let (_, mut receiver) = hub.attach();

    hub.publish_exit(8);
    hub.publish_exit(9);

    assert_eq!(
        receiver.recv().await.expect("matching exit"),
        AgentTerminalEvent::Exited
    );
}
