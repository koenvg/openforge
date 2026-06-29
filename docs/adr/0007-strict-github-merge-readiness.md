# Strict GitHub Merge Readiness

OpenForge will treat **Merge Readiness** as a strict GitHub-actionable handoff: a pull request is ready only when the GitHub identity OpenForge will use has a currently valid merge or enqueue action according to known repository requirements. This deliberately rejects a softer “ready for user review” meaning because GitHub readiness varies across merge queues, required reviews, status checks, rulesets, up-to-date branch requirements, conversation resolution, deployments, transient mergeability, and actor permissions.

## Consequences

- **Ready to Merge** means direct merge is the next valid action.
- **Ready to Enqueue** is a first-class outcome when GitHub requires a merge queue, even before OpenForge can perform the enqueue action itself.
- **Queued Pull Request** remains not done until GitHub merges it, but should stay low-noise while GitHub owns progress.
- Unknown or incomplete repository policy prevents first-class readiness on protected-looking repositories; uncertainty belongs in PR details rather than board-level ready states.
- OpenForge should not rely on REST `mergeable_state` alone as the readiness contract; richer GitHub policy and queue signals are needed.
