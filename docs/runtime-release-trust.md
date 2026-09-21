# Runtime release signatures

Runtime publisher verification is a prerequisite for session-preserving updates, not an enabled updater. Source installation, production daemon replacement, and pending-update Sidecar launch remain blocked.

## Approved trust policy

Published releases require publisher signatures. Local source builds require separate explicit authorization tied to immutable artifact identities and the installation/update operation. Failed publisher verification must never select the local-build path automatically.

`ReleaseStore::stage` checks integrity only. `ReleaseStore::stage_published` additionally checks a detached Ed25519 signature against the installed host's pinned `PublisherTrust` keys. Both use the same manifest bytes throughout staging and verify every declared runtime file. Neither method authorizes app replacement or daemon activation. `ReleaseStore::preflight` continues to refuse production replacement.

The host must obtain its pinned keys from the trusted release process. Never construct its trust set from a downloaded manifest, an IPC request, or environment configuration. This change does not configure a production publisher key or issue local-build approvals.

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

## Remaining prerequisites

- Provision the publisher's public trust anchor through an authenticated release process and keep its private key in protected signing infrastructure.
- Bind the complete target, including the app and helper, to publisher trust or explicit local-build approval.
- Authenticate helper handoff and crash recovery, delegate source installs, and verify compatible daemon activation.
- Demonstrate install-to-relaunch continuity and failure recovery in isolated packaged builds before enabling updates.

Test keys in `session-client/tests/releases.rs` are public fixtures, never production trust anchors. The fixed signature vectors were generated independently with Node crypto and are checked by Rust's verifier.
