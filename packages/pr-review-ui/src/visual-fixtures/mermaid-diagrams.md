# System diagrams

Mermaid fences render as diagrams while ordinary code fences remain source code.

## Delivery flow

```mermaid
flowchart TD
  Draft[Draft change] --> Review{Review passed?}
  Review -->|Yes| Merge[Merge change]
  Review -->|No| Revise[Revise change]
  Revise --> Review
```

## Review sequence

```mermaid
sequenceDiagram
  actor Author
  participant OpenForge
  participant Reviewer
  Author->>OpenForge: Submit change
  OpenForge->>Reviewer: Request review
  Reviewer-->>OpenForge: Approve
  OpenForge-->>Author: Ready to merge
```

## Task lifecycle

```mermaid
stateDiagram-v2
  [*] --> Backlog
  Backlog --> InProgress
  InProgress --> Review
  Review --> Done
  Review --> InProgress: Retry
  Done --> [*]
```

## Unsafe resource fallback

```mermaid
stateDiagram-v2
  [*] --> A
  classDef leak fill:url(https://attacker.invalid/pixel),stroke:#333
  class A leak
```

## Invalid diagram fallback

```mermaid
this is not valid Mermaid syntax
```
