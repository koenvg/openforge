use base64::Engine;
use libghostty_vt::{
    fmt::{Format, Formatter, FormatterOptions},
    selection::Selection,
    snapshot::Decoder,
    terminal::{Point, PointCoordinate},
    Terminal,
};
use serde_json::{json, Value};
use std::{error::Error, time::Instant};

type ExportResult<T> = Result<T, Box<dyn Error>>;
const COLS: u16 = 48;
const ROWS: u16 = 8;

fn screen(terminal: &Terminal<'_, '_>) -> ExportResult<String> {
    let selection = Selection::new(
        terminal.grid_ref(Point::Active(PointCoordinate { x: 0, y: 0 }))?,
        terminal.grid_ref(Point::Active(PointCoordinate {
            x: COLS - 1,
            y: u32::from(ROWS - 1),
        }))?,
        true,
    );
    let mut formatter = Formatter::new(
        terminal,
        FormatterOptions::new()
            .with_format(Format::Vt)
            .with_cursor(true)
            .with_style(true)
            .with_trim(true)
            .with_selection(&selection),
    )?;
    Ok(String::from_utf8(
        formatter.format_alloc(None)?.as_ref().to_vec(),
    )?)
}

fn history_row(terminal: &Terminal<'_, '_>, y: usize) -> ExportResult<String> {
    let y = u32::try_from(y)?;
    let selection = Selection::new(
        terminal.grid_ref(Point::History(PointCoordinate { x: 0, y }))?,
        terminal.grid_ref(Point::History(PointCoordinate { x: COLS - 1, y }))?,
        true,
    );
    let mut formatter = Formatter::new(
        terminal,
        FormatterOptions::new()
            .with_format(Format::Plain)
            .with_trim(true)
            .with_selection(&selection),
    )?;
    let row = String::from_utf8(formatter.format_alloc(None)?.as_ref().to_vec())?;
    if row.len() > usize::from(COLS) || !row.bytes().all(|byte| (32..=126).contains(&byte)) {
        return Err("no-go: history exporter requires unwrapped physical ASCII rows".into());
    }
    Ok(row)
}

fn export() -> ExportResult<Value> {
    let start = Instant::now();
    let mut input = String::new();
    for i in 1..=16 {
        input.push_str(&format!("OLDER HISTORY {i:02}\r\n"));
    }
    input.push_str("\x1b[32mFINAL CORRECT SCREEN\x1b[0m\r\nGhostty owns terminal state\r\nHistory is paused\r\nFixture only, no PTY\r\nFixed 48 x 8 cells\r\nInput: k\r\nLive output lands here\r\nready> ");
    let mut authority = Terminal::new(COLS, ROWS)?;
    authority.set_scrollback_max_bytes(Some(1024 * 1024))?;
    authority.set_scrollback_max_lines(Some(64))?;
    authority.vt_write(input.as_bytes());
    let parse_ms = start.elapsed().as_secs_f64() * 1000.0;
    let start = Instant::now();
    let snapshot = authority
        .encode_snapshot_alloc(None)?
        .ok_or("empty snapshot")?;
    let encode_ms = start.elapsed().as_secs_f64() * 1000.0;
    let start = Instant::now();
    let mut decoder = Decoder::new_buf(snapshot.as_ref())?.ready()?;
    let ready_ms = start.elapsed().as_secs_f64() * 1000.0;
    let start = Instant::now();
    let screen_vt = screen(decoder.terminal())?;
    let screen_export_ms = start.elapsed().as_secs_f64() * 1000.0;
    if screen_vt != screen(&authority)? {
        return Err("no-go: READY screen differs from authority".into());
    }
    let start = Instant::now();
    let mut pages = Vec::new();
    // Small snapshots keep some history in the READY active page. Withhold it
    // from the frontend just like later native HISTORY records.
    let ready_history_rows = decoder.terminal().scrollback_rows()?;
    if ready_history_rows > 0 {
        let mut rows = Vec::new();
        for y in 0..ready_history_rows {
            rows.push(history_row(decoder.terminal(), y)?);
        }
        pages.push(json!({ "index": 0, "rows": rows }));
    }
    while let Some(progress) = decoder.next()? {
        let count = progress.rows()?;
        if count == 0 {
            continue;
        }
        let mut rows = Vec::new();
        for y in 0..count {
            rows.push(history_row(decoder.terminal(), y)?);
        }
        pages.push(json!({ "index": pages.len(), "rows": rows }));
    }
    let history_rows = decoder.terminal().scrollback_rows()?;
    if history_rows != 16
        || pages
            .iter()
            .map(|page| page["rows"].as_array().map_or(0, Vec::len))
            .sum::<usize>()
            != history_rows
    {
        return Err("no-go: incomplete or unexpected retained history".into());
    }
    if screen(decoder.terminal())? != screen_vt {
        return Err("history changed the current screen".into());
    }
    let export_ms = start.elapsed().as_secs_f64() * 1000.0;
    let live_vt = "\r\x1b[2KLIVE OUTPUT 1";
    authority.vt_write(live_vt.as_bytes());
    let after_live = screen(&authority)?;
    authority.vt_write(b"k");
    Ok(json!({
        "schemaVersion": 1,
        "label": "Frozen Ghostty fixture, not an agent or PTY integration test",
        "geometry": { "cols": COLS, "rows": ROWS }, "retention": 64,
        "watermark": 1, "historyRows": history_rows,
        "screenVt": screen_vt, "pages": pages, "inputVt": input,
        "liveVt": live_vt, "afterLiveScreenVt": after_live, "afterInputScreenVt": screen(&authority)?,
        "snapshotBase64": base64::engine::general_purpose::STANDARD.encode(snapshot.as_ref()),
        "snapshotBytes": snapshot.as_ref().len(),
        "readyHistoryRows": ready_history_rows,
        "costsMs": { "parse": parse_ms, "encode": encode_ms, "ready": ready_ms, "screenExport": screen_export_ms, "historyExport": export_ms }
    }))
}

fn main() -> ExportResult<()> {
    println!("{}", serde_json::to_string_pretty(&export()?)?);
    Ok(())
}
