# agent-generation-diagnostics Specification

## Purpose

Defines the failure information and diagnostic outcome recorded for every headless agent generation attempt.

## Requirements

### Requirement: Structured generations report provider failures
The system SHALL inspect the provider result envelope for every structured-output generation, regardless of whether the provider process exits successfully. When the envelope reports an error, the system SHALL return the provider's error reason to the caller. When a non-zero process exit has no recognizable result envelope, the system SHALL report the exit status and SHALL include non-empty provider error output.

#### Scenario: Provider error accompanies a non-zero exit
- **WHEN** a structured-output generation returns a result envelope marked as an error and the provider process exits non-zero
- **THEN** the generation fails with the reason carried in the envelope instead of a generic exit-status error

#### Scenario: Provider error accompanies a zero exit
- **WHEN** a structured-output generation returns a result envelope marked as an error and the provider process exits successfully
- **THEN** the generation fails with the reason carried in the envelope

#### Scenario: Non-zero exit has no result envelope
- **WHEN** a structured-output generation exits non-zero without a recognizable result envelope
- **THEN** the generation fails with the process exit status and includes non-empty provider error output

### Requirement: Text generations retain process failure diagnostics
The system SHALL treat text-format output as raw text and SHALL NOT interpret it as a provider result envelope. A successful text-format generation SHALL return its standard output unchanged. A non-zero text-format exit SHALL report the process exit status and SHALL include non-empty provider error output, or the exit status alone when provider error output is empty.

#### Scenario: Successful text generation
- **WHEN** a text-format generation exits successfully
- **THEN** the generation returns its standard output unchanged

#### Scenario: Failed text generation with provider error output
- **WHEN** a text-format generation exits non-zero with non-empty provider error output
- **THEN** the generation fails with the exit status and the provider error output

#### Scenario: Failed text generation without provider error output
- **WHEN** a text-format generation exits non-zero with empty provider error output
- **THEN** the generation fails with the exit status and no empty trailing detail delimiter

### Requirement: Generation failures have distinct reported outcomes
The system SHALL report a provider-reported error, a timeout, an abort, and unusable structured output as distinct outcomes. Structured output SHALL be unusable when a successful provider process does not return a recognizable successful result envelope containing model result text.

#### Scenario: Provider reports an error
- **WHEN** a recognizable result envelope marks the generation as an error
- **THEN** the caller receives a provider-error message containing the envelope's reason

#### Scenario: Generation times out
- **WHEN** the provider process does not finish before the configured generation deadline
- **THEN** the caller receives a timeout message that identifies the configured deadline

#### Scenario: Generation is aborted
- **WHEN** the generation receives an abort request before the provider process finishes
- **THEN** the caller receives an abort message distinct from timeout and provider-error messages

#### Scenario: Structured output is unusable
- **WHEN** a structured-output generation exits successfully without a recognizable successful result envelope containing model result text
- **THEN** the caller receives an unusable-output message distinct from provider-error, timeout, and abort messages

### Requirement: Every generation attempt records its classified outcome
The system SHALL write one sidecar diagnostic for each completed generation attempt. The diagnostic SHALL identify the provider, output mode, and classified outcome without recording prompts or provider output. Diagnostic field names SHALL remain visible after the sidecar's existing log redaction.

#### Scenario: Successful generation is logged
- **WHEN** a generation attempt succeeds
- **THEN** the sidecar records the outcome as success with its provider and output mode

#### Scenario: Failed generation is logged
- **WHEN** a generation attempt ends in a provider error, timeout, abort, unusable output, or process failure
- **THEN** the sidecar records the matching classified outcome with its provider and output mode

#### Scenario: Diagnostic passes through log redaction
- **WHEN** the sidecar log redactor formats a generation outcome diagnostic
- **THEN** the provider, output mode, and classified outcome field values remain present
