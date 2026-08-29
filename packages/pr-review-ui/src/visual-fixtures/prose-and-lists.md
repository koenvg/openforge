# Availability search proposal

The search keeps useful classes visible when a public schedule does not expose a definitive availability signal.

## What changes

- Include occurrences with `available`, `limited`, or `unknown` availability.
- Continue excluding waitlisted and sold-out occurrences.
- Preserve the canonical availability signal for every result.

## Capabilities

### New capabilities

None.

### Modified capabilities

- Broaden `availability: open` while preserving conservative reporting.

## Impact

The result set changes for searches that use `availability: open`.
