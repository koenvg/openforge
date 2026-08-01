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

async fn receive_output_containing(
    attachment: &mut super::attachment::AgentTerminalAttachment,
    expected: &str,
) -> String {
    let mut output = String::new();
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(2);
    while !output.contains(expected) && tokio::time::Instant::now() < deadline {
        let event =
            tokio::time::timeout(std::time::Duration::from_millis(250), attachment.recv()).await;
        if let Ok(Ok(AgentTerminalEvent::Output(bytes))) = event {
            output.push_str(std::str::from_utf8(&bytes).expect("valid UTF-8 PTY output"));
        }
    }
    assert!(
        output.contains(expected),
        "expected terminal output {expected:?}, got {output:?}"
    );
    output
}

#[tokio::test]
async fn attachment_writes_only_valid_utf8_to_the_bound_agent_pty() {
    let manager = PtyManager::new();
    let temp_dir = tempfile::tempdir().expect("terminal tempdir");
    manager
        .spawn_companion_test_agent_pty(
            "interactive-agent",
            temp_dir.path(),
            r#"stty -echo; IFS= read -r line; printf 'input:%s' "$line"; sleep 5"#,
        )
        .await
        .expect("test Agent PTY");
    let mut attachment = manager
        .attach_agent_terminal("interactive-agent")
        .await
        .expect("active Agent terminal");

    assert!(matches!(
        attachment.write_input(&[0xff]).await,
        Err(super::attachment::AgentTerminalAttachmentError::InvalidUtf8)
    ));
    attachment
        .write_input("héllo\n".as_bytes())
        .await
        .expect("valid UTF-8 input");
    receive_output_containing(&mut attachment, "input:héllo").await;

    manager
        .kill_pty("interactive-agent")
        .await
        .expect("PTY cleanup");
}

#[tokio::test]
async fn desktop_and_mobile_inputs_share_one_ordered_pty_stream() {
    let manager = PtyManager::new();
    let temp_dir = tempfile::tempdir().expect("terminal tempdir");
    manager
        .spawn_companion_test_agent_pty(
            "ordered-agent",
            temp_dir.path(),
            r#"stty -echo; IFS= read -r first; IFS= read -r second; printf 'ordered:%s,%s' "$first" "$second"; sleep 5"#,
        )
        .await
        .expect("test Agent PTY");
    let mut mobile = manager
        .attach_agent_terminal("ordered-agent")
        .await
        .expect("mobile attachment");

    manager
        .write_pty("ordered-agent", b"desktop\n")
        .await
        .expect("desktop input");
    mobile.write_input(b"mobile\n").await.expect("mobile input");
    receive_output_containing(&mut mobile, "ordered:desktop,mobile").await;

    manager
        .kill_pty("ordered-agent")
        .await
        .expect("PTY cleanup");
}

#[tokio::test]
async fn stale_attachment_cannot_write_or_resize_a_replacement_agent() {
    let manager = PtyManager::new();
    let temp_dir = tempfile::tempdir().expect("terminal tempdir");
    manager
        .spawn_companion_test_agent_pty("replacement-agent", temp_dir.path(), "sleep 5")
        .await
        .expect("first Agent PTY");
    let stale = manager
        .attach_agent_terminal("replacement-agent")
        .await
        .expect("first attachment");
    manager
        .kill_pty("replacement-agent")
        .await
        .expect("first PTY cleanup");
    manager
        .spawn_companion_test_agent_pty("replacement-agent", temp_dir.path(), "sleep 5")
        .await
        .expect("replacement Agent PTY");

    assert!(matches!(
        stale.write_input(b"must-not-cross\n").await,
        Err(super::attachment::AgentTerminalAttachmentError::StaleAttachment)
    ));
    assert!(matches!(
        stale.resize(100, 40).await,
        Err(super::attachment::AgentTerminalAttachmentError::StaleAttachment)
    ));

    manager
        .kill_pty("replacement-agent")
        .await
        .expect("replacement PTY cleanup");
}

#[tokio::test]
async fn latest_resize_wins_across_desktop_and_concurrent_mobile_attachments() {
    let manager = PtyManager::new();
    let temp_dir = tempfile::tempdir().expect("terminal tempdir");
    manager
        .spawn_companion_test_agent_pty(
            "shared-agent",
            temp_dir.path(),
            r#"stty -echo; while IFS= read -r line; do stty size; done"#,
        )
        .await
        .expect("test Agent PTY");
    let mut first_mobile = manager
        .attach_agent_terminal("shared-agent")
        .await
        .expect("first mobile attachment");
    let second_mobile = manager
        .attach_agent_terminal("shared-agent")
        .await
        .expect("second mobile attachment");

    manager
        .resize_pty("shared-agent", 120, 50)
        .await
        .expect("desktop resize");
    first_mobile
        .resize(100, 40)
        .await
        .expect("first mobile resize");
    second_mobile
        .resize(90, 30)
        .await
        .expect("latest mobile resize");
    second_mobile
        .write_input(b"mobile\n")
        .await
        .expect("mobile input");
    receive_output_containing(&mut first_mobile, "30 90").await;

    manager
        .resize_pty("shared-agent", 80, 20)
        .await
        .expect("latest desktop resize");
    first_mobile
        .write_input(b"desktop\n")
        .await
        .expect("desktop-shared input");
    receive_output_containing(&mut first_mobile, "20 80").await;

    manager.kill_pty("shared-agent").await.expect("PTY cleanup");
}
