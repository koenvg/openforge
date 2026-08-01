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
fn attachment_replaces_complete_iterm_images_across_arbitrary_chunks() {
    for terminator in [b"\x07".as_slice(), b"\x1b\\".as_slice()] {
        let hub = PtyAttachmentHub::new(11, 1024, 256);
        let sequence = [
            b"before\x1b]1337;File=size=4;inline=1:AAAA".as_slice(),
            terminator,
            b"after".as_slice(),
        ]
        .concat();

        for byte in sequence {
            hub.publish_output(&[byte]);
        }

        let (replay, _) = hub.attach();
        assert_eq!(
            std::str::from_utf8(&replay).expect("filtered replay"),
            "before\r\n[Image unavailable on mobile]\r\nafter"
        );
    }
}

#[tokio::test]
async fn attachment_live_frames_are_valid_utf8_and_preserve_controls_and_links() {
    let hub = PtyAttachmentHub::new(12, 4096, 32);
    let (_, mut receiver) = hub.attach();

    hub.publish_output(&[0xc3]);
    assert!(receiver.try_recv().is_err());
    hub.publish_output(&[0xa9]);
    assert_eq!(
        receiver.recv().await.expect("complete UTF-8 output"),
        AgentTerminalEvent::Output("é".as_bytes().to_vec())
    );

    let links = b"\x1b[31mred\x1b[0m \x1b]8;;https://example.com\x1b\\selectable\x1b]8;;\x1b\\ https://example.org";
    hub.publish_output(links);
    assert_eq!(
        receiver.recv().await.expect("ANSI and link output"),
        AgentTerminalEvent::Output(links.to_vec())
    );
}

#[tokio::test]
async fn attachment_rejects_malformed_utf8_without_replaying_or_emitting_it() {
    let hub = PtyAttachmentHub::new(13, 1024, 8);
    let (_, mut receiver) = hub.attach();
    hub.publish_output(b"safe");
    hub.publish_output(&[0xff, b'x']);
    hub.publish_output(b"ignored after failure");

    assert_eq!(
        receiver.recv().await.expect("safe output"),
        AgentTerminalEvent::Output(b"safe".to_vec())
    );
    assert_eq!(
        receiver.recv().await.expect("protocol failure"),
        AgentTerminalEvent::ProtocolError
    );
    assert!(receiver.try_recv().is_err());
    assert_eq!(hub.attach().0, b"safe");
}

#[tokio::test]
async fn attachment_fails_oversized_image_without_buffering_or_emitting_payload() {
    use super::attachment::MAX_ITERM_IMAGE_SEQUENCE_BYTES;

    let hub = PtyAttachmentHub::new(14, 1024, 8);
    let (_, mut receiver) = hub.attach();
    hub.publish_output(b"before\x1b]1337;File=size=oversized;inline=1:");
    hub.publish_output(&vec![b'A'; MAX_ITERM_IMAGE_SEQUENCE_BYTES + 1]);
    hub.publish_output(b"\x07payload-must-not-escape");

    assert_eq!(
        receiver.recv().await.expect("safe prefix"),
        AgentTerminalEvent::Output(b"before".to_vec())
    );
    assert_eq!(
        receiver.recv().await.expect("bounded protocol failure"),
        AgentTerminalEvent::ProtocolError
    );
    assert!(receiver.try_recv().is_err());
    assert_eq!(hub.attach().0, b"before");
}

#[test]
fn attachment_accepts_an_image_sequence_at_the_exact_byte_limit() {
    use super::attachment::MAX_ITERM_IMAGE_SEQUENCE_BYTES;

    const PREFIX: &[u8] = b"\x1b]1337;File=";
    let mut sequence = Vec::with_capacity(MAX_ITERM_IMAGE_SEQUENCE_BYTES);
    sequence.extend_from_slice(PREFIX);
    sequence.resize(MAX_ITERM_IMAGE_SEQUENCE_BYTES - 1, b'A');
    sequence.push(0x07);

    let hub = PtyAttachmentHub::new(16, 1024, 8);
    hub.publish_output(&sequence);

    assert_eq!(hub.attach().0, b"\r\n[Image unavailable on mobile]\r\n");
}

#[tokio::test]
async fn attachment_fails_unterminated_image_on_exit_without_a_placeholder() {
    let hub = PtyAttachmentHub::new(15, 1024, 8);
    let (_, mut receiver) = hub.attach();
    hub.publish_output(b"before\x1b]1337;File=size=4;inline=1:AAAA");
    hub.publish_exit(15);

    assert_eq!(
        receiver.recv().await.expect("safe prefix"),
        AgentTerminalEvent::Output(b"before".to_vec())
    );
    assert_eq!(
        receiver
            .recv()
            .await
            .expect("unterminated protocol failure"),
        AgentTerminalEvent::ProtocolError
    );
    assert!(receiver.try_recv().is_err());
    assert_eq!(hub.attach().0, b"before");
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
