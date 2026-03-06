# Async Rust Patterns

## Send + Sync requirements

Tokio's multi-threaded runtime requires futures to be `Send`. This means no `Rc`, no `RefCell`, no raw pointers across `.await` points.

```rust
// WRONG — MutexGuard held across await (clippy::await_holding_lock)
async fn bad(state: &std::sync::Mutex<Data>) {
    let guard = state.lock().unwrap();
    network_call().await;  // guard held — deadlock risk
    drop(guard);
}

// CORRECT — release lock before await
async fn good(state: &std::sync::Mutex<Data>) {
    {
        let guard = state.lock().unwrap();
        // use guard
    } // dropped
    network_call().await;
}

// CORRECT — use tokio::sync::Mutex for async contexts
use tokio::sync::Mutex;
async fn also_good(state: &Mutex<Data>) {
    let guard = state.lock().await;
    network_call().await;  // OK — tokio Mutex is designed for this
}
```

## Blocking code in async context

```rust
// WRONG — blocks the executor thread
async fn read_file(path: &Path) -> Result<String> {
    std::fs::read_to_string(path)?  // blocking!
}

// CORRECT — offload to blocking thread pool
async fn read_file(path: PathBuf) -> Result<String> {
    tokio::task::spawn_blocking(move || std::fs::read_to_string(&path))
        .await
        .map_err(|e| Error::Join(e))?
}

// CORRECT — use tokio's async fs
async fn read_file(path: &Path) -> Result<String> {
    tokio::fs::read_to_string(path).await.map_err(Into::into)
}
```

## Shared state in async

```rust
// Read-heavy: Arc<RwLock<T>> — use tokio::sync::RwLock
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Clone)]
pub struct AppState {
    inner: Arc<RwLock<StateInner>>,
}

// Simple counters: atomics — no lock needed
use std::sync::atomic::{AtomicUsize, Ordering};
let counter = Arc::new(AtomicUsize::new(0));
counter.fetch_add(1, Ordering::Relaxed);

// Message passing: prefer channels over shared state
use tokio::sync::mpsc;
let (tx, mut rx) = mpsc::channel(32);
```

## Structured concurrency with JoinSet

```rust
use tokio::task::JoinSet;

async fn process_all(items: Vec<Item>) -> Vec<Result<Output>> {
    let mut set = JoinSet::new();
    for item in items {
        set.spawn(async move { process_item(item).await });
    }

    let mut results = Vec::new();
    while let Some(res) = set.join_next().await {
        results.push(res.expect("task panicked"));
    }
    results
}
```

## Async traits

```rust
// Rust 1.75+: native async in traits (RPITIT)
trait DataStore {
    async fn fetch(&self, id: u64) -> Result<Record>;
    async fn save(&self, record: Record) -> Result<()>;
}

// Pre-1.75 or when dyn dispatch is needed: async-trait crate
use async_trait::async_trait;

#[async_trait]
trait DataStore: Send + Sync {
    async fn fetch(&self, id: u64) -> Result<Record>;
}
```

## Cancellation safety

Functions called in `tokio::select!` must be cancellation-safe. If a future is dropped mid-execution, any partial work is lost.

```rust
// DANGEROUS in select! — partial read lost on cancellation
async fn read_message(stream: &mut TcpStream) -> Result<Message> {
    let len = stream.read_u32().await?;  // if cancelled here...
    let mut buf = vec![0u8; len as usize];
    stream.read_exact(&mut buf).await?;  // ...len is lost
    Ok(Message::from(buf))
}

// SAFE — use a stateful reader that tracks progress
// Or use tokio::sync::mpsc which is cancellation-safe for recv()
tokio::select! {
    msg = rx.recv() => { /* cancellation-safe */ }
    _ = shutdown.recv() => { break; }
}
```

## Graceful shutdown pattern

```rust
use tokio::signal;
use tokio::sync::watch;

async fn main() {
    let (shutdown_tx, shutdown_rx) = watch::channel(false);

    let server = tokio::spawn(run_server(shutdown_rx.clone()));

    signal::ctrl_c().await.expect("failed to listen for ctrl+c");
    let _ = shutdown_tx.send(true);

    server.await.expect("server task panicked");
}

async fn run_server(mut shutdown: watch::Receiver<bool>) {
    loop {
        tokio::select! {
            conn = accept_connection() => { handle(conn); }
            _ = shutdown.changed() => { break; }
        }
    }
    // cleanup
}
```
