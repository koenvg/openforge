# Angry Oracle Code-Change Process Diagram

```mermaid
flowchart TD
    A[Start /call request] --> B[Map project context and quality gates]
    B --> C[Implement requested change with TDD]
    C --> D[Inventory git changes]
    D --> E[Run verification commands]
    E --> F[Angry principal engineer oracle review]
    F --> G{Approved and score >= target?}
    G -- Yes --> H[Complete successfully]
    G -- No --> I{Iterations remaining?}
    I -- Yes --> J[Fix oracle blockers and required feedback]
    J --> D
    I -- No --> K[Manual breakpoint with oracle feedback]
    K --> L[Complete as not approved unless user takes over]
```
