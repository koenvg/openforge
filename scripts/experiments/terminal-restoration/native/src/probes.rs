use super::*;

#[test]
fn ready_restores_parser_continuation_and_alternate_screen_before_history() -> ProbeResult<()> {
    let history = "history\r\n".repeat(20_000);
    for (prefix, suffix) in [
        (b"\x1b[2J\x1b[HBEFORE\x1b[31".as_slice(), b"mRED".as_slice()),
        (b"\x1b[2J\x1b[HBEFORE\xf0\x9f", b"\x98\x80END"),
        (b"\x1b[2J\x1b[HPRIMARY\x1b[?1049hALT", b"\x1b[?1049lAFTER"),
    ] {
        let mut data = history.as_bytes().to_vec();
        data.extend_from_slice(prefix);
        let mut original = terminal(&data, 80, 24)?;
        let snapshot = original
            .encode_snapshot_alloc(None)?
            .ok_or("empty snapshot")?;
        let mut restored = Decoder::new_buf(snapshot.as_ref())?.ready()?;
        original.vt_write(suffix);
        restored.terminal_mut().vt_write(suffix);
        let ready = screen(restored.terminal())?;
        assert!(
            String::from_utf8_lossy(&ready).contains(if suffix == b"mRED" {
                "RED"
            } else if suffix == b"\x98\x80END" {
                "END"
            } else {
                "AFTER"
            })
        );
        let mut pages = 0;
        while restored.next()?.is_some() {
            pages += 1;
        }
        assert!(pages > 0);
        assert_eq!(screen(restored.terminal())?, screen(&original)?);
    }
    Ok(())
}

#[test]
fn resize_and_live_output_between_history_pages_preserve_the_current_screen() -> ProbeResult<()> {
    let data = format!(
        "{}\x1b[2J\x1b[HSCREEN",
        "long-history-row-abcdefghijklmnopqrstuvwxyz\r\n".repeat(20_000)
    );
    let original = terminal(data.as_bytes(), 80, 24)?;
    let snapshot = original
        .encode_snapshot_alloc(None)?
        .ok_or("empty snapshot")?;
    let mut restored = Decoder::new_buf(snapshot.as_ref())?.ready()?;
    assert!(restored.next()?.is_some());
    restored.terminal_mut().resize(60, 30, 0, 0)?;
    restored.terminal_mut().vt_write(b"\r\nLIVE AFTER READY");
    let mut pages = 0;
    let mut skipped_rows = 0;
    while let Some(progress) = restored.next()? {
        pages += 1;
        if progress.rows()? == 0 {
            skipped_rows += 1;
        }
    }
    let final_screen = screen(restored.terminal())?;
    assert!(String::from_utf8_lossy(&final_screen).contains("LIVE AFTER READY"));
    assert!(pages > 0);
    println!("resize history pages={pages}, skipped pages={skipped_rows}");
    Ok(())
}

#[test]
fn cancelling_after_ready_keeps_the_terminal_usable() -> ProbeResult<()> {
    let original = terminal("history\r\n".repeat(20_000).as_bytes(), 80, 24)?;
    let snapshot = original
        .encode_snapshot_alloc(None)?
        .ok_or("empty snapshot")?;
    let mut restored = Decoder::new_buf(snapshot.as_ref())?
        .ready()?
        .into_terminal();
    restored.vt_write(b"\x1b[2J\x1b[HCANCELLED BUT LIVE");
    assert!(String::from_utf8_lossy(&screen(&restored)?).contains("CANCELLED BUT LIVE"));
    Ok(())
}

#[test]
fn truncated_finish_is_not_a_completed_snapshot() -> ProbeResult<()> {
    let original = terminal("history\r\n".repeat(20_000).as_bytes(), 80, 24)?;
    let snapshot = original
        .encode_snapshot_alloc(None)?
        .ok_or("empty snapshot")?;
    let bytes = snapshot.as_ref();
    let mut restored = Decoder::new_buf(&bytes[..bytes.len() - 1])?.ready()?;
    loop {
        match restored.next() {
            Ok(Some(_)) => {}
            Err(_) => break,
            Ok(None) => panic!("truncated FINISH was accepted"),
        }
    }
    Ok(())
}

#[test]
fn scrolling_during_history_loading_stays_detached_from_the_live_viewport() -> ProbeResult<()> {
    use libghostty_vt::terminal::ScrollViewport;
    let original = terminal("history\r\n".repeat(20_000).as_bytes(), 80, 24)?;
    let snapshot = original
        .encode_snapshot_alloc(None)?
        .ok_or("empty snapshot")?;
    let mut restored = Decoder::new_buf(snapshot.as_ref())?.ready()?;
    assert!(restored.next()?.is_some());
    let before = restored.terminal().total_rows()?;
    restored
        .terminal_mut()
        .scroll_viewport(ScrollViewport::Delta(-10));
    assert!(!restored.terminal().viewport_active()?);
    while restored.next()?.is_some() {}
    assert!(!restored.terminal().viewport_active()?);
    assert!(restored.terminal().total_rows()? > before);
    restored
        .terminal_mut()
        .scroll_viewport(ScrollViewport::Bottom);
    assert!(restored.terminal().viewport_active()?);
    Ok(())
}
