## ADDED Requirements

### Requirement: Complete sharded visual execution

The visual test system SHALL support deterministic, non-overlapping partitions of declared case identities. Each assigned case SHALL receive baseline comparison and a second independently initialized capture on the same shard under the canonical environment. Shard selection SHALL NOT bypass validation of the complete manifest, story catalog, or approved baseline inventory. Invalid shard inputs SHALL fail explicitly.

#### Scenario: Matrix is partitioned
- **WHEN** all shards for the same manifest execute successfully
- **THEN** their union covers every declared case exactly once for baseline and repeatability verification
- **AND** all existing capture, diagnostic, tolerance, and failure-evidence rules remain in force

#### Scenario: Invalid baseline lies outside a selected shard
- **WHEN** the complete baseline inventory contains a missing, obsolete, or unexpected image outside the selected partition
- **THEN** global validation fails rather than hiding the invalid inventory through shard selection

#### Scenario: Invalid shard is requested
- **WHEN** the shard index or count is invalid
- **THEN** execution fails before capture rather than silently running a partial or empty substitute

### Requirement: Aggregate visual evidence and single probe execution

The sharded workflow SHALL run the existing targeted regression and bounded runner probes once per workflow, separately from case shards. Aggregate success SHALL require all expected case results and all required probes. Evidence SHALL identify its revision, manifest, shard assignment, environment, and phase outcomes. Duplicate, missing, or incompatible evidence SHALL fail aggregation.

#### Scenario: Incomplete or incompatible reports
- **WHEN** a shard is missing, a case is duplicated, or reports originate from different revisions or manifests
- **THEN** the aggregate fails and identifies the evidence mismatch

#### Scenario: Probe failure
- **WHEN** all case shards succeed but a required regression probe fails
- **THEN** the visual aggregate fails and retains the probe's diagnostic evidence

#### Scenario: Full local validation
- **WHEN** a developer runs the canonical unsharded visual test command
- **THEN** it still validates every declared baseline and repeatability pair and runs all required probes
- **AND** concurrent CI jobs do not overwrite one another's capture reports
