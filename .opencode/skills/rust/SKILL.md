---
name: rust
description: Idiomatic Rust conventions, ownership patterns, error handling, naming, clippy, and common AI pitfalls based on the Rust API Guidelines and Effective Rust. Use when writing, reviewing, or refactoring Rust code (.rs files). Do NOT use for Go, TypeScript, or other languages.
---

## When to use this skill

Load when writing, reviewing, or refactoring Rust code (`.rs` files), creating new Rust modules, or answering questions about Rust idioms and best practices.

---

## Naming (RFC 430)

| Item | Convention | Example |
|------|-----------|---------|
| Types, Traits, Enum variants | `UpperCamelCase` | `HttpClient`, `ParseError` |
| Functions, methods, modules | `snake_case` | `parse_url`, `is_valid` |
| Constants, statics | `SCREAMING_SNAKE_CASE` | `MAX_RETRIES` |
| Type parameters | Single uppercase or short CamelCase | `T`, `E`, `Rhs` |
| Lifetimes | Short lowercase | `'a`, `'de`, `'src` |
| Macros | `snake_case!` | `vec!`, `assert_eq!` |
| Crate/feature names | `snake_case` | Never `-rs` or `-rust` suffix |

**Acronyms are one word**: `Uuid` not `UUID`, `Stdin` not `StdIn`, `HttpError` not `HTTPError`.

### Conversion method prefixes

The prefix encodes cost and ownership:

```rust
// as_ -> free, borrowed -> borrowed
fn as_bytes(&self) -> &[u8]

// to_ -> expensive, borrowed -> owned
fn to_string(&self) -> String

// into_ -> consumes self, owned -> owned
fn into_bytes(self) -> Vec<u8>
```

### Getters — no `get_` prefix

```rust
// Correct
pub fn name(&self) -> &str { &self.name }
pub fn name_mut(&mut self) -> &mut String { &mut self.name }

// Wrong — Java-style
pub fn get_name(&self) -> &str { &self.name }
```

### Iterator methods

```rust
fn iter(&self) -> Iter         // yields &U
fn iter_mut(&mut self) -> IterMut  // yields &mut U
fn into_iter(self) -> IntoIter    // yields U (consumes)
```

### Constructor patterns

```rust
Self::new()               // primary constructor
Self::with_capacity(n)    // extended constructor
Self::from_bytes(b)       // conversion constructor
Self::try_from(v)         // fallible conversion
```

---

## Error handling

### `thiserror` vs `anyhow`

| Context | Use | Why |
|---------|-----|-----|
| Library / public API | `thiserror` | Callers can match on typed variants |
| Application / binary | `anyhow` | Ergonomic context chaining |
| Internal module | `thiserror` | Structured, matchable within crate |

### Error type pattern

```rust
use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("not found: {resource} with id {id}")]
    NotFound { resource: &'static str, id: u64 },

    #[error(transparent)]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, AppError>;
```

### Error message style

- Lowercase, no trailing punctuation.
- Allows clean composition: `format!("reading config: {err}")`.

### `unwrap()` and `expect()` rules

```rust
// NEVER in library code or production paths
let val = data.unwrap();  // will panic

// ACCEPTABLE: truly impossible states with documented invariant
let val = data.expect("parser guarantees non-empty after validation");

// PREFERRED: propagate with ?
let val = data.ok_or(AppError::MissingField("name"))?;
```

### `panic!` — never in library code

- `panic!` is for programmer bugs (violated invariants), never for expected errors.
- Library functions must return `Result` or `Option`.

---

## Ownership and borrowing

### Function parameter rules

```rust
// CORRECT — &str accepts String, &str, &String
fn greet(name: &str) { println!("Hello, {name}!"); }

// WRONG — forces callers to have &String
fn greet(name: &String) { ... }

// CORRECT — &[T] accepts Vec, arrays, slices
fn sum(values: &[i32]) -> i32 { values.iter().sum() }

// WRONG — unnecessarily restrictive
fn sum(values: &Vec<i32>) -> i32 { ... }
```

**Rule**: Use `&str` not `&String`. Use `&[T]` not `&Vec<T>`. Accept the most general borrow.

### When to take ownership vs borrow

- Take `&T` when you only need to read.
- Take `T` when the caller is done with it and you need to store/move it.
- Never clone inside a function when you could accept owned data.

### Avoid unnecessary cloning

```rust
// WRONG — clones to satisfy borrow checker
fn process(user: &User) {
    log(&user.name.clone());  // if log takes &str, clone is wrong
}

// CORRECT
fn process(user: &User) {
    log(&user.name);
}
```

### `Cow<str>` for conditional allocation

```rust
use std::borrow::Cow;

fn normalize(s: &str) -> Cow<'_, str> {
    if s.contains(' ') {
        Cow::Owned(s.replace(' ', "_"))  // allocates only when needed
    } else {
        Cow::Borrowed(s)  // zero-copy
    }
}
```

### Smart pointer hierarchy

| Type | Use when |
|------|----------|
| `Box<T>` | Heap allocation, recursive types, trait objects |
| `Rc<T>` | Shared ownership, single-threaded |
| `Arc<T>` | Shared ownership, multi-threaded |
| `Cell<T>` | Interior mutability for Copy types, single-threaded |
| `RefCell<T>` | Interior mutability for non-Copy, single-threaded |
| `Mutex<T>` | Interior mutability, multi-threaded |
| `RwLock<T>` | Read-heavy multi-threaded access |

Do NOT reach for `Arc<Mutex<T>>` by default. Consider channels, atomics, or redesigning to avoid shared state.

---

## Type safety

### Newtypes to prevent misuse

```rust
struct UserId(pub u64);
struct PostId(pub u64);

// get_user_posts(UserId(1), PostId(5)) — can't swap by accident
fn get_user_posts(user: UserId, post: PostId) -> Vec<Post> { ... }
```

### Enums over booleans

```rust
// WRONG — what does (true, false) mean?
let w = Widget::new(true, false);

// CORRECT — self-documenting
let w = Widget::new(Size::Small, Shape::Round);
```

### Parse, don't validate

```rust
// WRONG — validation scattered, easy to forget
fn send_email(email: &str) -> Result<()> {
    if !is_valid(email) { return Err(...); }
    ...
}

// CORRECT — invalid state is unrepresentable
pub struct Email(String);
impl Email {
    pub fn parse(s: &str) -> Result<Self, EmailError> { ... }
}
fn send_email(email: &Email) -> Result<()> { /* guaranteed valid */ }
```

---

## Traits

### Implement `From`, never `Into`

```rust
// CORRECT — Into is auto-derived from From
impl From<MyType> for u32 {
    fn from(t: MyType) -> u32 { t.0 }
}

// WRONG — breaks blanket impl
impl Into<u32> for MyType { ... }
```

### Eagerly implement common traits

Due to the orphan rule, downstream crates cannot add trait impls. Always derive where applicable:

```rust
#[derive(Debug, Clone, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
pub struct Config { ... }
```

Priority: `Debug` (always) > `Clone` > `PartialEq`/`Eq` > `Hash` > `Display` > `Default` > `Serialize`/`Deserialize`.

### Generics vs trait objects

```rust
// GENERICS (static dispatch) — prefer when:
// performance critical, types known at compile time
fn process<T: Handler>(handler: &T) { ... }

// TRAIT OBJECTS (dynamic dispatch) — use when:
// heterogeneous collections, plugin-style architecture
let handlers: Vec<Box<dyn Handler>> = vec![...];
```

### No redundant bounds on structs

```rust
// WRONG — breaking change hazard
struct Cache<K: Hash + Eq, V: Clone> { ... }

// CORRECT — bounds only on impl blocks that need them
struct Cache<K, V> { ... }
impl<K: Hash + Eq, V> Cache<K, V> { ... }
```

---

## Module organization

### Visibility

```rust
pub struct Client { ... }           // public API
pub(crate) fn helper() { ... }     // crate-internal
fn private() { ... }               // module-private (default)
pub(super) fn sibling() { ... }    // parent module only
```

### Re-export public API from crate root

```rust
// lib.rs
pub use crate::client::Client;
pub use crate::error::{Error, Result};
// Users write: use mycrate::Client;
```

### File structure

```
src/
  lib.rs          // crate root
  config.rs       // module (no submodules → single file)
  database/
    mod.rs        // only when submodules exist
    queries.rs
    migrations.rs
```

---

## Async Rust

For async patterns, Tokio conventions, and `Send + Sync` rules, see [async-patterns.md](async-patterns.md).

Key rules:
- Never hold `std::sync::MutexGuard` across `.await` — use `tokio::sync::Mutex`.
- Wrap blocking I/O in `tokio::task::spawn_blocking`.
- Prefer `JoinSet` over manual `tokio::spawn` for structured concurrency.

---

## API design

For builder patterns, serde conventions, trait design, and documentation rules, see [api-design.md](api-design.md).

Key rules:
- Document `# Errors`, `# Panics`, `# Safety` sections where applicable.
- Gate serde behind a feature flag in library crates.
- Use `impl AsRef<Path>` / `impl Into<String>` to accept diverse input types.

---

## Testing

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_valid_input() {
        assert_eq!(parse("42"), Ok(42));
    }

    #[test]
    fn rejects_empty_input() {
        assert!(parse("").is_err());
    }
}
```

- Unit tests in `#[cfg(test)] mod tests` at end of file.
- Integration tests in `tests/` directory (public API only).
- Use `#[tokio::test]` for async tests.
- Test **business logic only** — never assert on CSS classes or visual styling.
- Use `tempfile::tempdir()` for filesystem tests.
- Use table-driven tests for multiple input/output cases.

---

## Clippy

### Recommended lint configuration

```rust
// lib.rs or main.rs
#![deny(clippy::correctness)]   // outright bugs — always
#![warn(clippy::suspicious)]    // likely bugs
#![warn(clippy::perf)]          // easy performance wins
#![warn(clippy::style)]         // idiomatic code
#![warn(clippy::complexity)]    // simplification opportunities
```

### Key lints to always fix

- `clippy::unwrap_used` — use `?` or `expect` with reason
- `clippy::clone_on_ref_ptr` — don't `Arc::clone(&x)`, use `x.clone()`... actually DO use `Arc::clone(&x)` to be explicit
- `clippy::large_enum_variant` — box large variants
- `clippy::await_holding_lock` — release lock before `.await`
- `clippy::needless_pass_by_value` — take `&T` unless ownership needed
- `clippy::manual_let_else` — use `let ... else { return }` pattern

---

## Unsafe code

- Only for FFI, performance-critical low-level ops, or OS primitives.
- Every `unsafe` block MUST have a `// SAFETY:` comment explaining the invariant.
- Every `unsafe fn` MUST have a `# Safety` doc section listing caller obligations.
- Minimize the unsafe surface — wrap in safe public API.

```rust
// CORRECT
let value = unsafe {
    // SAFETY: index is bounds-checked by the caller via get() returning Some
    slice.get_unchecked(index)
};

// WRONG — no justification
let value = unsafe { slice.get_unchecked(index) };
```

---

## Common AI anti-patterns

| Anti-pattern | Fix |
|---|---|
| `&String` / `&Vec<T>` parameters | Use `&str` / `&[T]` |
| `.clone()` to satisfy borrow checker | Restructure code — split borrows, use entry API |
| `Arc<Mutex<T>>` everywhere | Use channels, atomics, or redesign |
| `String` in all struct fields | `&str` when borrowing is appropriate |
| `.unwrap()` in production code | `?` operator, `expect` with reason, or `match` |
| `impl Into<T>` instead of `From<T>` | Always implement `From` — `Into` is auto-derived |
| `get_name()` getter style | `name()` — no `get_` prefix in Rust |
| `panic!` in library code | Return `Result` or `Option` |
| Unnecessary lifetime annotations | Trust lifetime elision; annotate only when compiler asks |
| `as` for numeric casts | `TryFrom`/`TryInto` for checked conversions |
| Fighting the borrow checker | Redesign: collect then mutate, split borrows, entry API |
| Ignoring clippy warnings | Every warning is a code smell; `#[allow]` requires a reason |

---

## Tooling quick reference

```bash
# Format
cargo fmt
cargo fmt -- --check  # CI: verify formatting

# Build
cargo build
cargo build --release

# Test
cargo test
cargo test -- --nocapture        # see println output
cargo test specific_test_name    # run one test

# Lint
cargo clippy
cargo clippy --all-targets --all-features -- -D warnings  # CI

# Check (fast compile check, no codegen)
cargo check

# Documentation
cargo doc --open
cargo doc --no-deps

# Audit dependencies
cargo audit
```
