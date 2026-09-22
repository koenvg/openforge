# Runtime release signatures

Runtime publisher verification is a prerequisite for session-preserving updates, not an enabled updater. Source installation, production daemon replacement, and pending-update Sidecar launch remain blocked.

## Approved trust policy

Published releases require publisher signatures. Local source builds require separate explicit authorization tied to immutable artifact identities and the installation/update operation. Failed publisher verification must never select the local-build path automatically.

`ReleaseStore::stage` checks integrity only. `ReleaseStore::stage_published` additionally checks a detached Ed25519 signature against the installed host's pinned `PublisherTrust` keys. Both use the same manifest bytes throughout staging and verify every declared runtime file. Neither method authorizes app replacement or daemon activation. `ReleaseStore::preflight` continues to refuse production replacement.

The installed publisher key is pinned in `src/electron/updatePublisher.json`, shared by Electron and Rust's embedded `PublisherTrust::production()`. The owner generated and approved this key. Never construct the production trust set from a downloaded manifest, an IPC request, or environment configuration. The private signing key is not in the repository.

## Signing format

The signed message is the concatenation of:

1. UTF-8 `openforge-session-release-v1` followed by one zero byte.
2. The exact bytes of `manifest.json`, including whitespace and its final newline.

The detached `manifest.ed25519` file contains the raw 64-byte signature. Verification uses raw 32-byte Ed25519 public keys. The manifest remains format 1; signatures are separate from its content identity. The verifier permits up to 16 pinned keys for rotation, with no implicit trust of other keys.

Sign a prepared runtime release offline:

```sh
node scripts/sign-runtime-release.mjs /path/to/session-runtime /private/path/publisher.pem
```

The key must be an Ed25519 PKCS#8 PEM file owned by the current user, with no group or other permissions. Keep it outside all packaged artifacts. The signer refuses symlinks, hard-linked inputs, oversized inputs, keys inside the runtime directory, and replacement of an existing signature. It does not provision keys, upload artifacts, or modify the release workflow. It signs the supplied manifest; the publisher is responsible for reviewing and building its contents.

Pass the detached signature bytes and the independently pinned keys to `stage_published`. Do not regard the resulting staged handle as a durable approval record. Later authorization must reverify the selected artifacts and bind the complete app, Sidecar, daemon, CLI, and helper to the update operation.

## Complete app authorization

`UpdateBundleStore` copies the entire app into a private staging directory and measures resources, file permissions, framework symlinks, and executable identities. It rejects escaping links and missing required components. Source mutation does not change the staged copy; subsequent verification rejects changes to the copy. This does not yet prove platform compatibility or live daemon transition support.

Complete-app publisher signatures use `openforge-app-update-v1\0` followed by the canonical bytes from `updateManifestBytes`. Runtime signatures cannot authorize the whole app. `UpdateAuthorizationStore.authorizePublished` verifies the installed publisher key and never falls back to local approval.

Local authorization uses a native confirmation dialog with Cancel as the default. It shows the destination and exact build identity and does not grant first-adoption interruption approval. After confirmation, the store verifies the bytes again and writes an authenticated record bound to the installation, operation, destination, staged path, and manifest identity. The installation-private HMAC key is separate from the release signing key. Altered records and cross-operation or cross-installation replay are rejected.

These modules are not yet connected to a production installer or helper. Reading an authorization authenticates the record only; the consumer must reverify artifact bytes, enforce current-operation ownership, and serialize replacement. Partial or corrupt authorization files fail closed rather than granting authority.

The KVG-5206 internal native transaction library now consumes these authenticated records and rechecks complete bundle bytes. It is not packaged or connected to the coordinator/source installer. See [the implementation checkpoint and activation gates](update-helper-transaction.md).

## Runtime probe deadlines

On macOS, image probes allow up to 20 seconds for loader startup. A readiness marker or the first output starts the two-second execution deadline. State probes retain their five-second limit. Descriptor isolation, cleared environments, contract and byte-identity checks, and process-group teardown are unchanged.

The client's five-second initial readiness wait is unchanged. If a cold daemon is still starting, the client reports a timeout and allows attachment retry without killing or launching another owner. A longer probe allowance does not authorize replacement or enable production updates.

## Remaining prerequisites

- Back up the private signing key securely and configure protected release signing infrastructure.
- Connect complete-target authorization to the authenticated helper and the install/update coordinator.
- Authenticate helper handoff and crash recovery, delegate source installs, and verify compatible daemon activation.
- Demonstrate install-to-relaunch continuity and failure recovery in isolated packaged builds before enabling updates.

Test keys in `session-client/tests/releases.rs` are public fixtures, never production trust anchors. The fixed signature vectors were generated independently with Node crypto and are checked by Rust's verifier.
