## Purpose

Provide trusted consumers with explicitly requested PDF bytes from authorized project and task workspaces, without changing metadata-only preview contracts or exposing filesystem URLs.

## ADDED Requirements

### Requirement: Document bytes are a separate additive capability

The system SHALL provide explicit document reads for project and task workspace paths through both frontend and backend Plugin SDK filesystem interfaces. Existing file reads SHALL continue returning PDF document metadata with empty content. Document reads SHALL return either a ready PDF with base64 bytes, raw byte size, MIME type, byte revision, and modification timestamp, or an unavailable result with a reason and no bytes. Callers SHALL NOT supply a root path, URL, MIME override, or limit override.

#### Scenario: Existing consumer reads PDF metadata
- **WHEN** a consumer reads a PDF through the existing file-preview interface
- **THEN** its type remains `document`, its MIME type remains `application/pdf`, and its content remains empty regardless of eligibility for the new byte capability

#### Scenario: Consumer explicitly reads a PDF
- **WHEN** an admitted consumer requests an authorized supported PDF within the document limit
- **THEN** the result identifies base64 encoding, contains bytes that decode to the reported raw size, and includes a revision identifying those returned bytes

#### Scenario: Frontend and backend consumers use the same contract
- **WHEN** frontend and backend plugins request the same unchanged project or task PDF
- **THEN** they receive equivalent document results and policy failures with correctly mapped camelCase scope identifiers

### Requirement: File authority comes from the host-resolved workspace

The system SHALL resolve project and task roots from host-owned records for each document read and retain existing trusted-renderer and trusted-plugin admission. Task reads SHALL fail when the live workspace cannot be resolved, without falling back to the project checkout. The capability SHALL accept only nonempty workspace-relative file paths and SHALL reject absolute, drive, UNC, URL, NUL-containing, and parent-traversal inputs. It SHALL reject descendant symlinks and reparse points, including links within the root, and SHALL NOT expose a direct file URL or add an unauthenticated document endpoint.

#### Scenario: Task and project contain different PDFs at the same path
- **WHEN** a consumer requests that relative path using the task document capability
- **THEN** only the PDF from the task's resolved workspace is returned

#### Scenario: Task workspace is missing
- **WHEN** a task has no available live workspace
- **THEN** its document read fails without reading the project checkout or a caller-selected replacement root

#### Scenario: Caller attempts a path escape
- **WHEN** a request uses an absolute path, drive path, UNC path, URL, parent traversal, or descendant symlink
- **THEN** the request fails without returning document bytes from that path

#### Scenario: Path changes between validation and opening
- **WHEN** a descendant component is replaced with a link during a document read
- **THEN** the operation fails or reads only its already authorized file object and never follows the replacement outside the authorized root

#### Scenario: Untrusted renderer requests document bytes
- **WHEN** an untrusted renderer or unauthenticated caller attempts the new document command
- **THEN** existing host admission denies access without exposing document bytes

### Requirement: Reads are bounded by size, concurrency, and time

The system SHALL admit at most two concurrent document reads across its project/task and frontend/backend adapters, without an unbounded wait queue. Each admitted read SHALL enforce a 16,777,216-byte maximum against the opened regular file and the actual bytes read, with at most one additional byte to detect growth. It SHALL finish or time out within 15 seconds and release its resources on every exit. Empty or invalid PDF headers SHALL return `invalid-document`; unsupported extensions SHALL return `unsupported-format`; over-limit files SHALL return `too-large`, with no document bytes. Extensions SHALL be matched case-insensitively.

#### Scenario: PDF reaches the byte limit exactly
- **WHEN** an otherwise valid PDF contains exactly 16,777,216 bytes
- **THEN** it remains eligible and its full bounded result can cross both supported transports

#### Scenario: PDF exceeds the limit
- **WHEN** the opened file exceeds the limit initially or grows beyond it while reading
- **THEN** the result is `too-large`, contains no document bytes, and the operation does not continue reading the entire file

#### Scenario: Nonregular file is selected
- **WHEN** the requested path identifies a directory, device, FIFO, or other nonregular file
- **THEN** the capability rejects it without blocking indefinitely or consuming its contents

#### Scenario: Too many reads arrive
- **WHEN** two document reads are in flight and another request arrives
- **THEN** the new request receives a busy failure without queued file I/O or allocation of another document buffer

#### Scenario: Read stalls or is cancelled
- **WHEN** a read reaches its deadline or the host cancels the request
- **THEN** its handles and admission slot are released, and a later valid read can proceed

#### Scenario: File is empty or misidentified
- **WHEN** a `.pdf` file is empty or lacks a PDF header in its first 1,024 bytes
- **THEN** the result is `invalid-document` and contains no bytes for rendering

### Requirement: Results have explicit failure and ownership semantics

The capability SHALL return no persistent file handle or URL. It SHALL reject detected file modification during a read and a changed or removed workspace identity before publishing bytes. It SHALL use documented failure categories for bad request, not found, forbidden, changed, busy, timeout, I/O, and unavailable host, without disclosing absolute host paths. Consumers SHALL NOT treat a revision or previous metadata read as authorization. Existing text, image, video, binary, and large-file read semantics SHALL remain unchanged.

#### Scenario: File changes during a bounded read
- **WHEN** the opened file's observed size or modification metadata changes before the result is published
- **THEN** the capability reports a changed-file failure rather than returning a ready result, unless the size limit already requires a too-large result

#### Scenario: Task root changes during reading
- **WHEN** the task workspace identity changes before a pending result is published
- **THEN** the old workspace's bytes are not published as the new workspace's document

#### Scenario: Caller retries
- **WHEN** a consumer retries after any failed document read
- **THEN** the host reauthorizes the request and reads the current file rather than reusing a failed buffer or an old authorization

#### Scenario: Older host lacks document reads
- **WHEN** the plugin cannot use the new capability on its current host
- **THEN** it receives or detects an unavailable capability and does not fall back to direct filesystem access

#### Scenario: Caller already received bytes
- **WHEN** a successful one-shot read finishes
- **THEN** the host retains no document session to revoke, and the trusted caller is responsible for releasing its copy when its preview ends
