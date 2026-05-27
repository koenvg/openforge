# OpenForge

OpenForge is a desktop command center for coordinating task work and AI coding agents while keeping the user focused on one active thing at a time.

## Language

**Task**:
A unit of work tracked by OpenForge for a project.
_Avoid_: Ticket, issue, job

**Implementation Run**:
An agent-driven attempt to work on a **Task** in a task workspace, identified to plugins by task, session, and workspace.
_Avoid_: Agent run when referring to the task-scoped OpenForge concept, provider port

**Agent Session**:
The provider-specific conversation or PTY process attached to an **Implementation Run**.
_Avoid_: Run, task

**Session Reattachment**:
Reconnecting OpenForge to an existing **Agent Session** without changing the provider, agent, or permission mode.
_Avoid_: Restart, start, continue with prompt

**Implementation Input**:
A message sent into an existing **Agent Session** to continue or redirect work.
_Avoid_: Resume, restart

**Handoff Notes**:
A living reviewer-facing brief on a **Task** that summarizes what needs inspection after agent work.
_Avoid_: Completion log, run history, random comments

**Project Handoff Notes Template**:
A project-owned format that defines what **Handoff Notes** must contain for that project.
_Avoid_: Global summary format, additional instructions

**Project Agent Settings**:
The project-owned choice of provider, agent, and permission mode for new **Implementation Runs**.
_Avoid_: Plugin run options, per-call agent override

**Trusted Plugin**:
An installed OpenForge extension that may act across tasks when using explicit host capabilities.
_Avoid_: Sandboxed widget, project-only script

**Task Creation**:
Recording a new project-owned backlog **Task** from a prompt, without choosing how an agent will run it.
_Avoid_: Run scheduling, agent configuration, global task creation, status selection

**Task Branch**:
A PR-visible Git branch OpenForge creates for a **Task** workspace.
_Avoid_: Prompt branch, run branch, title branch

## Relationships

- **Task Creation** creates a project-owned backlog **Task**, not an **Implementation Run**.
- A **Task** may have zero or more **Implementation Runs** over time.
- An **Implementation Run** uses exactly one **Agent Session** at a time.
- A new **Implementation Run** uses the **Project Agent Settings** rather than plugin-supplied provider or agent overrides.
- A **Trusted Plugin** may start an **Implementation Run** for any **Task** when using the host-provided task capability.
- A **Task** with unmet dependencies cannot start an **Implementation Run**.
- A **Task** with an active **Agent Session** cannot start another **Implementation Run**.
- **Session Reattachment** preserves the existing **Agent Session** identity.
- **Implementation Input** targets an existing **Agent Session** and does not choose a new provider or agent.
- **Handoff Notes** belong to a **Task** and are updated to reflect the current review state rather than appended per **Implementation Run**.
- A **Project Handoff Notes Template** defines the required shape of **Handoff Notes** for Tasks in one project.
- Existing Tasks may have unstructured historical summaries; **Handoff Notes** are the forward-looking reviewer brief, not a migration requirement.
- A **Task Branch** identifies the **Task**; human-readable context belongs in the **Task**, **Handoff Notes**, PR title, or PR body rather than in prompt-derived branch text.

## Example dialogue

> **Dev:** "Should the scheduler resume this task with the worker agent?"
> **Domain expert:** "No — if there is already an agent session, resuming only reattaches to it. To ask it to do work, send implementation input. New implementation runs use the project agent settings, not plugin-supplied overrides."

## Flagged ambiguities

- "Resume" was used to mean both reattaching a detached session and sending a new prompt to an active session — resolved: **Session Reattachment** means reconnect only, while **Implementation Input** is the prompt/message.
- `agent` and `permissionMode` were considered for plugin **Task Creation** — resolved: task creation records work only; execution policy belongs to **Project Agent Settings**.
- Task status was considered for plugin **Task Creation** — resolved: plugin-created tasks always enter the backlog.
- "Handoff" could mean a per-run completion record or the current reviewer brief — resolved: **Handoff Notes** are the current Task-level review brief, not append-only run history.
- The handoff format could be hidden inside broad project instructions — resolved: use a dedicated **Project Handoff Notes Template** so the review contract is explicit.
- "Summary" and **Handoff Notes** overlapped — resolved: user-facing review language should say **Handoff Notes**, while existing unstructured summaries remain valid legacy content.
- Worktree branch names were considered for prompt-derived descriptions — resolved: **Task Branches** should be stable task identifiers because they are visible as PR source branches.
