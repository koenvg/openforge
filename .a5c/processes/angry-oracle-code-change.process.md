# Angry Oracle Code-Change Process

Purpose: make `/call`-style implementation work pass through context-appropriate verification, one explicit architecture review gate, and then one project-local thermo-nuclear code quality review before completion.

## High-level flow

1. Map project context and conventions from `AGENTS.md`, `.a5c/project-profile.md`, and `.a5c/quality-gates.json`.
2. Implement the requested code change with TDD when it applies, or with lighter targeted verification for documentation-only, configuration-only, planning, metadata, process-only, or similarly low-risk changes.
3. Inventory the actual git changes.
4. Run verification commands, defaulting to:
   - `pnpm exec tsc --noEmit`
   - `pnpm test`
5. Decide whether running-app smoke validation applies based on the changed files.
   - If the change affects OpenForge UI, Electron shell, Rust sidecar/runtime, plugins, IPC, terminal, settings, navigation, or other running-app behavior, run the `openforge-app-operator` skill for read-only manual app verification.
   - If not applicable, record an explicit skip rationale so the oracle can review why manual verification was not run.
6. Run the `improve-codebase-architecture` skill once as an explicit architecture review gate against the completed changes, automated verification, and manual app verification result or skip rationale.
7. If the architecture gate reports any required fixes, critical/high findings, blockers, a non-approval verdict, or a score below the threshold, stop as unsuccessful with the architecture feedback recorded. Do not run an automatic fix task or re-review loop.
8. After the architecture gate approves, send the completed changes, automated verification, manual app verification result or skip rationale, and architecture review result to the project-local `review` skill for one **thermo-nuclear code quality review** and final architectural-fit review.
9. If the oracle reports any required fixes, critical/high findings, blockers, a missing/invalid/non-approval verdict, or a score below the threshold, stop as unsuccessful with the oracle feedback recorded. Do not run an automatic fix task, manual breakpoint, or re-review loop.
10. Stop as successful only when the architecture gate and oracle both approve and the oracle reaches the configured score.

## Key decisions

- The architecture gate runs **after code changes, automated verification, and the manual verification decision** and **before** the angry oracle review.
- The oracle runs only after the explicit architecture gate has approved; it still performs an adversarial final architecture sanity check rather than replacing the dedicated gate.
- Manual app verification is conditional rather than unconditional; process-only or documentation-only changes carry an explicit skipped result.
- Applicable manual verification uses the `openforge-app-operator` skill and stays read-only by default.
- The architecture gate uses the architecture-focused `improve-codebase-architecture` skill, not a generic reviewer prompt.
- The oracle uses the project-local `review` skill (`.agents/skills/review/SKILL.md`) and is intentionally adversarial: it must validate that the code makes architectural sense for this codebase and apply the thermo-nuclear review standards for structural simplification, code judo, spaghetti-condition growth, and boundary cleanliness.
- Required fixes, critical/high findings, and missing/invalid oracle verdicts are hard blockers, but they are reported as a failed run result rather than triggering automatic fixes.
- The process is generic: callers can override `verificationCommands` and `targetOracleScore` per task.
- The implementation step is still constrained by OpenForge project conventions: use TDD for feature, bugfix, business-logic, and product-behavior implementation, but do not invent failing product tests for docs/config/process-only work where targeted verification is more appropriate.

## Inputs

```json
{
  "request": "Implement the requested code change",
  "verificationCommands": ["pnpm exec tsc --noEmit", "pnpm test"],
  "targetOracleScore": 90
}
```

## Output

The process returns success state, architecture and oracle approval state, changed files, automated verification results, the manual verification result or skip rationale, final architecture review, final oracle review, and each architecture/oracle attempt for auditability.
