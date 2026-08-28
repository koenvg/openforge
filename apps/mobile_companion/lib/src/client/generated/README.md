# Generated Companion v1 client

The checked-in Dart models and transport client are in
`apps/mobile_companion/lib/src/generated/companion_v1_client.dart`. This directory
contains only this boundary note; generated output does not belong under
`lib/src/client/generated/`.

The generator reads `docs/contracts/companion-v1.openapi.json`; shared response
examples live in `docs/contracts/companion-v1-fixtures.json`. The generated artifact is
committed so Flutter builds do not generate API code during dependency installation
or compilation.

Use this source-first workflow for contract changes:

1. Update the OpenAPI document first, plus any affected shared fixtures.
2. Run `pnpm mobile:contract:generate`. This invokes
   `scripts/generate-companion-dart-client.mjs` and overwrites the checked-in Dart
   artifact, including its embedded contract SHA-256.
3. Review and commit the contract, affected fixtures, and generated artifact together.
4. Run:

```sh
pnpm mobile:contract:check
./scripts/mobile-companion check
```

`pnpm mobile:contract:check` runs the generator in memory and compares its output
byte for byte with the checked-in Dart artifact. `./scripts/mobile-companion check`
includes the same drift check before its lockfile, formatting, analysis, and test
checks. Generated output must not be edited independently of the source contract.

## Implemented boundary

`CompanionV1Client` implements the current Companion v1 HTTP API surface. Pairing request submission creates only a short-lived pending approval; authenticated reads remain desktop-authoritative. The same paired-device credential authorizes prompt-only backlog Task Create, identity-only Task Start, backlog Task Delete, and Task Complete mutations plus the separate interactive Agent-terminal WebSocket, where terminal input runs as the desktop user:

- pairing request submission and approval polling;
- authenticated host status;
- authenticated Project catalog and four-lane Project Board snapshots;
- authenticated attention snapshots and task-detail domain reads;
- authenticated, read-only Task prompt catalogs whose provider trigger and ordered skill and command suggestions match desktop Task Creation;
- authenticated ordered Action Palette descriptors whose labels, keywords, confirmation flags, destructive treatment, and semantic icons are desktop-authoritative;
- authenticated prompt-only backlog Task Create in a visible Project that pins the effective provider and never retries automatically;
- authenticated identity-only Companion Task Start without automatic mutation retry;
- authenticated backlog Task Delete without automatic mutation retry;
- authenticated Task-scoped Complete through the shared terminal Task lifecycle; and
- the authenticated event-stream request, with typed Project-catalog, Project Board,
  attention, and Task invalidation decoding in `lib/src/client/companion_live_events.dart`.

Interactive Agent terminal traffic is intentionally outside this generated HTTP client. `lib/src/terminal/companion_terminal_client.dart` owns the dedicated authenticated WebSocket boundary, which permits typed attach/resize controls plus validated UTF-8 binary terminal input only after `ready`; the channel cannot directly start, stop, or replace Agent Sessions. Task Complete closes the mobile attachment normally and lets the desktop-owned lifecycle stop the Agent and Task shells.

`GeneratedCompanionClient` in `lib/src/client/companion_client.dart` adapts reads and Create/Start/Delete operations behind the application's `CompanionClient` seam, and Complete behind `CompanionTaskActionClient`. Reads own pinned endpoint failover; Create, Start, Delete, and Complete each deliberately make one request to the established endpoint and are never retried or failed over automatically. The HTTP boundary exposes no broader Task/domain mutations, project or repository mutations, generic command dispatch, or offline domain cache.
