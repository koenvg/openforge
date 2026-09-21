use base64::Engine;
use libghostty_vt::{
    fmt::{Format, Formatter, FormatterOptions},
    snapshot::Decoder,
    Terminal,
};
use std::{error::Error, fs, time::Instant};

type ProbeResult<T> = Result<T, Box<dyn Error>>;

fn screen(terminal: &Terminal<'_, '_>) -> ProbeResult<Vec<u8>> {
    let mut formatter = Formatter::new(
        terminal,
        FormatterOptions::new()
            .with_format(Format::Vt)
            .with_cursor(true)
            .with_style(true),
    )?;
    Ok(formatter.format_alloc(None)?.as_ref().to_vec())
}

fn terminal(data: &[u8], cols: u16, rows: u16) -> ProbeResult<Terminal<'static, 'static>> {
    let mut terminal = Terminal::new(cols, rows)?;
    terminal.set_scrollback_max_bytes(Some(8 * 1024 * 1024))?;
    terminal.set_continuation_max_bytes(256 * 1024)?;
    terminal.vt_write(data);
    Ok(terminal)
}

fn main() -> ProbeResult<()> {
    let path = std::env::args()
        .nth(1)
        .ok_or("expected a benchmark fixture.json path")?;
    let cols = std::env::args()
        .nth(2)
        .unwrap_or_else(|| "110".into())
        .parse()?;
    let rows = std::env::args()
        .nth(3)
        .unwrap_or_else(|| "24".into())
        .parse()?;
    let start = Instant::now();
    let fixture: serde_json::Value = serde_json::from_slice(&fs::read(path)?)?;
    let data = base64::engine::general_purpose::STANDARD.decode(
        fixture["data"]
            .as_str()
            .ok_or("fixture data must be base64")?,
    )?;
    let read_decode_ms = start.elapsed().as_secs_f64() * 1000.0;
    let start = Instant::now();
    let original = terminal(&data, cols, rows)?;
    let parse_ms = start.elapsed().as_secs_f64() * 1000.0;
    let start = Instant::now();
    let snapshot = original
        .encode_snapshot_alloc(None)?
        .ok_or("empty snapshot")?;
    let encode_ms = start.elapsed().as_secs_f64() * 1000.0;
    let expected = screen(&original)?;
    let mut trials = Vec::new();
    for _ in 0..5 {
        let start = Instant::now();
        let complete = Decoder::new_buf(snapshot.as_ref())?.decode()?;
        let one_shot_ms = start.elapsed().as_secs_f64() * 1000.0;
        if screen(&complete)? != expected {
            return Err("one-shot screen mismatch".into());
        }
        drop(complete);
        let start = Instant::now();
        let mut incremental = Decoder::new_buf(snapshot.as_ref())?.ready()?;
        let ready_ms = start.elapsed().as_secs_f64() * 1000.0;
        let ready_screen = screen(incremental.terminal())?;
        let mut pages = 0;
        let mut prepended_rows = 0;
        let mut max_page_ms = 0.0_f64;
        loop {
            let page_start = Instant::now();
            let progress = incremental.next()?;
            max_page_ms = max_page_ms.max(page_start.elapsed().as_secs_f64() * 1000.0);
            let Some(progress) = progress else { break };
            pages += 1;
            prepended_rows += progress.rows()?;
        }
        let finish_ms = start.elapsed().as_secs_f64() * 1000.0;
        let final_screen = screen(incremental.terminal())?;
        trials.push(serde_json::json!({
            "readyMs": ready_ms, "finishMs": finish_ms, "oneShotMs": one_shot_ms,
            "maxPageMs": max_page_ms, "pages": pages, "prependedRows": prepended_rows,
            "readyContainsFinalScreen": String::from_utf8_lossy(&ready_screen).contains("FINAL CORRECT SCREEN"),
            "finishMatchesOriginal": final_screen == expected,
        }));
    }
    println!(
        "{}",
        serde_json::json!({
            "fixtureBytes": data.len(), "geometry": { "cols": cols, "rows": rows },
            "snapshotBytes": snapshot.as_ref().len(), "readAndBase64DecodeMs": read_decode_ms,
            "vtParseMs": parse_ms, "snapshotEncodeMs": encode_ms, "trials": trials,
            "limitations": ["Native model availability, not xterm presentation latency.", "Images are not verified by the VT formatter.", "FINISH timing includes READY screen formatting.", "RSS is recorded externally for the complete probe, not per phase."]
        })
    );
    Ok(())
}

#[cfg(test)]
mod probes;
