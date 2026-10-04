//! Export a fixture with OpenForge's production-pinned codec for the native host test.
use libghostty_vt::Terminal;
use std::{error::Error, fs, path::PathBuf};

fn main() -> Result<(), Box<dyn Error>> {
    let destination = PathBuf::from(std::env::args().nth(1).ok_or("expected output path")?);
    let mut terminal = Terminal::new(80, 20)?;
    terminal.set_scrollback_max_bytes(Some(8 * 1024 * 1024))?;
    terminal.set_continuation_max_bytes(64 * 1024)?;
    for _ in 0..2000 {
        terminal.vt_write("backend history café 日本語\r\n".as_bytes());
    }
    terminal.vt_write(b"READY-BACKEND\x1b[31");
    let snapshot = terminal
        .encode_snapshot_alloc(None)?
        .ok_or("empty snapshot")?;
    fs::write(&destination, snapshot.as_ref())?;
    println!(
        "exported {} bytes at 80x20 to {}",
        snapshot.as_ref().len(),
        destination.display()
    );
    Ok(())
}
