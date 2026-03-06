# Rust API Design

## Builder pattern

Use when construction requires many inputs or optional configuration.

### Non-consuming builder (preferred)

```rust
pub struct RequestBuilder {
    url: String,
    timeout: Option<Duration>,
    headers: Vec<(String, String)>,
}

impl RequestBuilder {
    pub fn new(url: impl Into<String>) -> Self {
        Self { url: url.into(), timeout: None, headers: vec![] }
    }

    pub fn timeout(&mut self, d: Duration) -> &mut Self {
        self.timeout = Some(d);
        self
    }

    pub fn header(&mut self, k: impl Into<String>, v: impl Into<String>) -> &mut Self {
        self.headers.push((k.into(), v.into()));
        self
    }

    pub fn build(&self) -> Request { ... }
}

// One-liner
RequestBuilder::new("https://example.com").timeout(Duration::from_secs(5)).build();

// Complex
let mut b = RequestBuilder::new("https://example.com");
if needs_auth { b.header("Authorization", token); }
b.build()
```

## Serde patterns

### Standard derive usage

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]  // JSON: camelCase, Rust: snake_case
pub struct UserProfile {
    pub user_id: u64,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
    #[serde(default)]
    pub is_active: bool,
}
```

### Common serde attributes

```rust
#[serde(rename = "api_key")]              // rename single field
#[serde(skip_serializing_if = "Option::is_none")]  // omit None fields
#[serde(default = "default_retries")]     // default if missing
#[serde(flatten)]                         // flatten nested struct
#[serde(skip)]                            // skip entirely
#[serde(with = "module")]                 // custom ser/de
```

### Enum serialization

```rust
// Tagged: {"type": "Error", "data": {...}}
#[serde(tag = "type", content = "data")]
pub enum ApiResponse {
    Success(Data),
    Error(ErrorData),
}

// Untagged: tries each variant in order
#[serde(untagged)]
pub enum StringOrInt {
    String(String),
    Int(i64),
}

// Internally tagged: {"type": "success", ...fields}
#[serde(tag = "type")]
pub enum Event {
    #[serde(rename = "user_created")]
    UserCreated { id: u64, name: String },
    #[serde(rename = "user_deleted")]
    UserDeleted { id: u64 },
}
```

### Feature-gate serde in library crates

```toml
# Cargo.toml
[dependencies]
serde = { version = "1.0", optional = true, features = ["derive"] }

[features]
serde = ["dep:serde"]
```

```rust
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct MyType { ... }
```

## Documentation conventions (RFC 1574)

### Required sections

```rust
/// Brief one-line summary (imperative mood: "Returns", "Creates", "Parses").
///
/// Longer explanation if needed.
///
/// # Examples
///
/// ```rust
/// # use mycrate::Client;
/// # fn main() -> Result<(), Box<dyn std::error::Error>> {
/// let client = Client::new("https://api.example.com")?;
/// # Ok(())
/// # }
/// ```
///
/// # Errors
///
/// Returns [`Error::Network`] if the connection fails.
///
/// # Panics
///
/// Panics if `url` is empty.
///
/// # Safety  (unsafe fn only)
///
/// Caller must ensure `ptr` is non-null and valid for `len` bytes.
pub fn connect(url: &str) -> Result<Connection> { ... }
```

- `# Examples` — required for every public item. Use `?` not `unwrap()`.
- `# Errors` — required when function returns `Result`.
- `# Panics` — required when function can panic.
- `# Safety` — required for every `unsafe fn`.
- Error messages in Display: lowercase, no trailing punctuation.

## Trait design

### Sealed traits for non-extensible APIs

```rust
pub trait Driver: private::Sealed {
    fn execute(&self, query: &str) -> Result<Rows>;
}

mod private {
    pub trait Sealed {}
    impl Sealed for super::PostgresDriver {}
    impl Sealed for super::SqliteDriver {}
}
```

### Object safety

If a trait needs both generic methods and dyn dispatch, use `where Self: Sized`:

```rust
pub trait Processor {
    fn process(&self, data: &[u8]) -> Vec<u8>;  // object-safe

    fn process_typed<T: Serialize>(&self, value: &T) -> Vec<u8>
    where Self: Sized;  // excluded from vtable
}
```

### Generic function parameters — minimize assumptions

```rust
// Accept any iterable
fn sum_all<I: IntoIterator<Item = i64>>(iter: I) -> i64 {
    iter.into_iter().sum()
}

// Accept String, &str, Path, OsStr, etc.
fn open_file(path: impl AsRef<Path>) -> io::Result<File> {
    File::open(path.as_ref())
}
```

## Type state pattern

Encode state transitions in the type system — invalid sequences become compile errors:

```rust
use std::marker::PhantomData;

struct Locked;
struct Unlocked;

struct Door<State> {
    name: String,
    _state: PhantomData<State>,
}

impl Door<Locked> {
    pub fn new(name: &str) -> Self {
        Door { name: name.to_string(), _state: PhantomData }
    }
    pub fn unlock(self) -> Door<Unlocked> {
        Door { name: self.name, _state: PhantomData }
    }
}

impl Door<Unlocked> {
    pub fn open(&self) { println!("{} opened", self.name); }
    pub fn lock(self) -> Door<Locked> {
        Door { name: self.name, _state: PhantomData }
    }
}
// door.open() on Door<Locked> -> compile error
```

## Performance patterns

### `Vec::with_capacity` when size is known

```rust
let mut results = Vec::with_capacity(items.len());
for item in items { results.push(transform(item)); }
```

### `HashMap` entry API — avoid double-lookup

```rust
// WRONG — two lookups
if !map.contains_key(&key) {
    map.insert(key, default_value());
}

// CORRECT — one lookup
map.entry(key).or_insert_with(default_value);
```

### Iterator chains over manual loops

```rust
// Prefer — compiles to the same code
let sum: i32 = data.iter()
    .filter(|&&x| x > 0)
    .map(|&x| x * 2)
    .sum();
```

### Large enum variants — box them

```rust
// WRONG — all variants pay for the largest
enum Message {
    Small(u8),
    Large([u8; 1024]),  // wastes memory for Small
}

// CORRECT
enum Message {
    Small(u8),
    Large(Box<[u8; 1024]>),
}
```

## Cargo.toml conventions

### Feature flags

- Name features directly — no `use-`, `with-`, `enable-` prefixes.
- Features must be additive — enabling a feature must never remove functionality.
- Use `dep:` prefix for optional dependencies.

```toml
[features]
default = ["std"]
std = []
serde = ["dep:serde"]
```

### Release profile

```toml
[profile.release]
opt-level = 3
lto = "fat"
codegen-units = 1
panic = "abort"
strip = true
```

### Workspace dependencies

```toml
[workspace]
members = ["crates/*"]
resolver = "2"

[workspace.dependencies]
serde = { version = "1.0", features = ["derive"] }
tokio = { version = "1", features = ["full"] }
```
