## Context

See `proposal.md` for the failure being addressed. Before every Codex Task launch, the Rust sidecar regenerates an OpenForge-owned profile and starts Codex with `--profile openforge-lifecycle`. The profile currently owns sandbox, approval, and lifecycle-hook settings, and its regeneration path preserves Codex's hook trust state.

Codex supports a top-level `check_for_update_on_startup` boolean. Setting it in the OpenForge profile changes only launches that select this profile. The user's base Codex configuration and direct CLI launches remain untouched.

## Goals / Non-Goals

**Goals:**

- Make the no-startup-update rule part of the OpenForge-owned Codex launch configuration.
- Apply the rule to fresh, resumed, and continued Task sessions through their shared profile preparation path.
- Preserve the existing hook trust-state migration behavior when the profile is regenerated.

**Non-Goals:**

- Detect, download, or install Codex releases.
- Change the user's base Codex configuration.
- Interpret updater output or retry a Task launch after an updater exits.
- Add renderer, IPC, database, or settings controls.

## Decisions

### Put the update setting in the OpenForge Codex profile

The generated profile will include `check_for_update_on_startup = false` beside the existing top-level sandbox and approval settings. Profile generation is already mandatory preparation for every OpenForge Codex launch, so one change covers new, resumed, and continued sessions.

Passing an extra `-c` argument on every launch was considered. The profile is the better owner because the setting describes OpenForge's Codex runtime policy, keeps provider launch arguments focused on session selection, and makes the effective configuration inspectable in one file.

Editing the user's base `config.toml` was rejected because it would also change direct Codex launches. OpenForge does not own that behavior.

### Preserve the existing regeneration boundary

Profile regeneration will continue to replace OpenForge-owned configuration and append the retained `[hooks.state]` section. The new setting belongs to the regenerated portion, so existing profiles adopt it automatically on the next Task launch without a separate migration.

Adding a second migration path was rejected because it could drift from normal profile rendering and would add file-state cases for no user-visible benefit.

### Prove the behavior at profile generation

Rust unit tests will assert that fresh and regenerated profiles contain the top-level update setting and that regeneration still retains hook trust state. The launch adapter already selects the OpenForge profile for every Codex Task path, so its existing adapter test remains the boundary check.

A test that invokes the real updater was rejected because it would depend on network access, mutate the developer's Codex installation, and test Codex rather than OpenForge's contract.

## Risks / Trade-offs

- [Codex changes or removes the configuration key] -> Keep the setting isolated in profile generation and rely on affected Rust checks plus release testing when upgrading supported Codex versions.
- [Users who launch Codex only through OpenForge no longer receive startup updates] -> Keep update management outside this change and leave direct Codex launches unchanged.

## Migration Plan

The next Codex Task launch regenerates the existing OpenForge profile with startup update checks disabled. Running sessions are unaffected. Rollback removes the setting from profile generation, and the following launch regenerates the prior profile shape.
