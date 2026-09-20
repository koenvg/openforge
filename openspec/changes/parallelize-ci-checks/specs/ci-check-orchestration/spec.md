## Purpose

Provide faster CI feedback through independent jobs and complete test shards without allowing partial execution or missing diagnostics to appear successful.

## ADDED Requirements

### Requirement: Complete frontend test sharding

Frontend test execution SHALL partition all suites selected by the existing full test configuration into non-overlapping shards. The aggregate frontend status SHALL require successful build, type, lint, and every expected test-shard result. Existing package contract checks SHALL remain required in their existing validation scope.

#### Scenario: All shards complete
- **WHEN** all expected shards and static checks succeed
- **THEN** the frontend aggregate reports success with the same test selection as the unsharded command

#### Scenario: A shard does not succeed
- **WHEN** any expected shard fails, is cancelled, is skipped unexpectedly, or has no result
- **THEN** the frontend aggregate does not report success
- **AND** available shard diagnostics remain accessible

### Requirement: Independent desktop job scheduling

Packaged Electron smoke and live terminal invariant checks SHALL be eligible to start without waiting for unrelated check results when they prepare their own build inputs. Their existing test behavior and failure conditions SHALL remain unchanged.

#### Scenario: Frontend checks are still running
- **WHEN** the workflow starts and runner capacity is available
- **THEN** desktop smoke and invariant jobs can prepare and test their own inputs while frontend checks run

### Requirement: Compatible CI evidence

Sharded checks SHALL provide collision-free failure artifacts and aggregate results consumable by existing review reporting. Missing or malformed results SHALL NOT be interpreted as successful execution. Required status identities SHALL be preserved or explicitly migrated before rollout.

#### Scenario: A frontend shard fails
- **WHEN** review reporting consumes the completed workflow
- **THEN** it identifies the frontend failure and exposes that shard's diagnostics without overwriting other shards' logs

#### Scenario: Execution cost is compared
- **WHEN** a complete sharded workflow is evaluated against its serial baseline
- **THEN** evidence reports elapsed time and runner consumption separately without treating concurrency as a reduction in executed coverage
