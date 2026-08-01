# Generated Companion v1 client

The checked-in Dart models and transport client are in
`apps/mobile_companion/lib/src/generated/companion_v1_client.dart`. This directory
contains only this boundary note; generated output does not belong under
`lib/src/client/generated/`.

The source contract is `docs/contracts/companion-v1.openapi.json`, with shared
response examples in `docs/contracts/companion-v1-fixtures.json`. The generated
artifact is committed so Flutter builds do not generate API code during dependency
installation or compilation. No standalone generator command is currently checked
in. Contract changes therefore use a source-first lockstep workflow: update the
OpenAPI document and fixtures, update the checked-in Dart artifact at the location
above (including its embedded contract SHA-256), commit those changes together, and
run:

```sh
pnpm mobile:contract:check
./scripts/mobile-companion check
```

The contract check verifies that the generated file embeds the exact OpenAPI SHA-256
and contains every operation ID and every field listed directly in a component
schema's top-level `required` array. It is a drift guard, not full generator or
schema-conformance verification. Generated output must not be edited independently
of the source contract.

## Implemented boundary

`CompanionV1Client` implements the current Companion v1 read-only API surface:

- pairing request submission and approval polling;
- authenticated host status;
- authenticated attention snapshots and task-detail domain reads; and
- the authenticated event-stream request, with typed SSE decoding in
  `lib/src/client/companion_live_events.dart`.

`GeneratedCompanionClient` in `lib/src/client/companion_client.dart` adapts those
generated calls behind the application's `CompanionClient` seam and owns pinned
endpoint failover. The boundary does not implement mutations, broad project,
repository, or terminal APIs, or an offline domain cache.
