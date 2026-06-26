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

**Task Attention Pane**:
A compact task detail area that prioritizes current signals requiring user attention before long-form task documents.
_Avoid_: Status cockpit, right sidebar, document reader

**Reviewed File**:
A changed file the user has explicitly marked as already inspected during review; it remains visible in the review flow and stops counting as reviewed when the file's content identity changes.
_Avoid_: Hidden file, dismissed file, permanently ignored file

**Reviewed File Snapshot**:
The file version the user last accepted when marking a **Reviewed File**; it lets the review flow show what changed since that review.
_Avoid_: Latest commit, branch head, base branch

**Review File Tree**:
The navigation list of changed files in a review flow.
_Avoid_: Reviewed-files bucket, hidden-files list

**Diff File Section**:
The per-file review area that contains a changed file's header and diff content.
_Avoid_: File tree row, reviewed-files group

**Project Handoff Notes Template**:
A project-owned format that defines what **Handoff Notes** must contain for that project.
_Avoid_: Global summary format, additional instructions

**Project Agent Settings**:
The project-owned choice of provider, agent, and permission mode for new **Implementation Runs**.
_Avoid_: Plugin run options, per-call agent override

**Trusted Plugin**:
An installed OpenForge extension that may act across tasks when using explicit host capabilities.
_Avoid_: Sandboxed widget, project-only script

**Plugin-owned Domain**:
A product area whose language, contracts, and workflows belong to a **Trusted Plugin** rather than OpenForge core.
_Avoid_: Core capability, host feature

**Rust Sidecar**:
The supervised Rust process that owns OpenForge backend domain logic for the Electron desktop app.
_Avoid_: Tauri backend, `src-tauri`, backend service

**Backend Crate**:
The Rust package that contains the **Rust Sidecar** implementation and build metadata.
_Avoid_: `src-tauri`, generic backend folder

**Terminal Runtime**:
The shared OpenForge runtime that owns terminal session lifecycle for **Terminal Surfaces**.
_Avoid_: Terminal plugin internals, ordinary plugin dependency, private terminal pool, private forwarding package

**Terminal Surface**:
A plugin or core UI area that presents an interactive terminal through the **Terminal Runtime**.
_Avoid_: PTY owner, terminal backend, shell manager

**Shell Session Key**:
The OpenForge identifier for one concrete terminal shell tab/session.
_Avoid_: Task ID, terminal index, PID filename

**Task Creation**:
Recording a new project-owned backlog **Task** from a prompt, without choosing how an agent will run it.
_Avoid_: Run scheduling, agent configuration, global task creation, status selection

**Task Schedule**:
A project-owned recurring rule that performs **Task Creation** from a prompt and may also request a new **Implementation Run** for the created **Task**.
_Avoid_: Cronjob, task reuse, implementation input schedule

**Scheduled Fire**:
One due occurrence of a **Task Schedule**, including an on-time occurrence while OpenForge is open or a single catch-up occurrence after OpenForge restarts.
_Avoid_: Job run, background daemon run, reused task

**Schedule Preset**:
A simple user-facing cadence choice for a **Task Schedule**, such as daily, weekly, monthly, or custom cron.
_Avoid_: Timezone policy, provider automation type, project selector

**Task Branch**:
A PR-visible Git branch OpenForge creates for a **Task** workspace.
_Avoid_: Prompt branch, run branch, title branch

**Marketing Site**:
A public web presence that explains OpenForge and guides people toward installation or documentation.
_Avoid_: Web app, hosted dashboard, web companion

**Marketing Site Primary Visitor**:
An AI-assisted individual developer or tech lead who wants local, calm control over coding-agent workflow.
_Avoid_: AI beginner, enterprise buyer, plugin author

**Marketing Site Primary Conversion**:
The main action the **Marketing Site** asks visitors to take: install OpenForge locally.
_Avoid_: Waitlist signup, hosted app launch, sales contact

**Marketing Site Promise**:
The core claim of the **Marketing Site**: run AI coding agents without losing control of the work.
_Avoid_: Autonomous software factory, AI developer replacement, productivity dashboard

**Marketing Site Plugin Customization Pillar**:
A top-level **Marketing Site** reason to use OpenForge: the task-based operator console stays stable while **Trusted Plugins** let users shape the workspace around their own workflow, shown as both a top-reason card and a small concrete section.
_Avoid_: Arbitrary untrusted extensions, hosted marketplace promise, plugin-only product

**Marketing Site Top Reasons**:
The three primary reasons the **Marketing Site** gives for using OpenForge, presented with control first: stay in control of agent work, let agents manage OpenForge **Tasks** through the CLI, and customize OpenForge to your workflow with **Trusted Plugins**.
_Avoid_: Generic productivity claims, enterprise collaboration claims, review-only positioning, full-app agent control claims

**Marketing Site Workspace**:
The repository location for website implementation: an Astro monorepo workspace app at `apps/website`.
_Avoid_: Desktop renderer, docs folder site, separate repository

**Marketing Site First Milestone**:
The first website implementation target: a small static one-page **Marketing Site** ordered as hero with a concrete task → agent → handoff → review workflow visual, top reasons, product screenshot proof, a small plugin customization section, install/GitHub call-to-action block, and footer links.
_Avoid_: Blog, hosted docs system, plugin marketplace, analytics, mailing list, interactive demo, standalone workflow section, standalone local-first trust section

**Marketing Site Visual Direction**:
A developer-tool aesthetic for the **Marketing Site** that uses a concrete workflow hero visual and product screenshots rather than generic AI imagery; a vibrant block/bento hero is acceptable when it still makes the task → agent → handoff → review path clear.
_Avoid_: AI SaaS hype visuals, metric-heavy dashboard aesthetic, abstract robot art

## Relationships

- **Task Creation** creates a project-owned backlog **Task**, not an **Implementation Run**.
- A **Task Schedule** creates a new normal board **Task** for each **Scheduled Fire** rather than mutating or reusing an existing **Task**.
- A **Task Schedule** belongs to the active project context where it is configured; it is not selected globally from inside the schedule composer.
- A **Task Schedule** may request an **Implementation Run** only after the scheduled **Task Creation** succeeds.
- If multiple **Scheduled Fires** are missed while OpenForge is closed, they collapse into at most one catch-up **Scheduled Fire** after OpenForge restarts.
- A **Task Schedule** skips a due **Scheduled Fire** when its previously created **Task** is still not done.
- A **Schedule Preset** may compile to simple five-field cron syntax for custom cadence without making cron syntax the primary user-facing path.
- A **Task Schedule** uses plain prompt text rather than template variables, scripts, loops, conditionals, or starter prompt templates.
- A **Task Schedule** can be manually fired for testing, using the same behavior and overlap rules as a due **Scheduled Fire**.
- A **Task Schedule** keeps a minimal history of its five most recent outcomes for diagnosis.
- **Scheduled Fires** do not create a separate automation inbox, auto-archive workflow, or scheduler-specific notification flow; resulting **Tasks** follow the normal OpenForge board and review lifecycle.
- A **Task** may have zero or more **Implementation Runs** over time.
- An **Implementation Run** uses exactly one **Agent Session** at a time.
- A new **Implementation Run** uses the **Project Agent Settings** rather than plugin-supplied provider or agent overrides.
- A **Trusted Plugin** may start an **Implementation Run** for any **Task** when using the host-provided task capability.
- A **Trusted Plugin** may own a **Plugin-owned Domain** when the concept is not shared across plugins or core workflows.
- The **Backend Crate** builds the **Rust Sidecar**.
- Electron main supervises the **Rust Sidecar** rather than embedding backend domain logic in the renderer or relying on a Tauri shell.
- A **Terminal Surface** uses the **Terminal Runtime** and does not own shell process state.
- The **Terminal Runtime** is shared across **Terminal Surfaces** when they need one terminal lifecycle owner.
- The **Terminal Runtime** uses **Shell Session Keys** to distinguish terminal shell tabs/sessions.
- A **Shell Session Key** is not a **Task** id, even when it belongs to a **Task** terminal.
- A **Task** with unmet dependencies cannot start an **Implementation Run**.
- A **Task** with an active **Agent Session** cannot start another **Implementation Run**.
- **Session Reattachment** preserves the existing **Agent Session** identity.
- **Implementation Input** targets an existing **Agent Session** and does not choose a new provider or agent.
- **Handoff Notes** belong to a **Task** and are updated to reflect the current review state rather than appended per **Implementation Run**.
- A **Task Attention Pane** surfaces the most time-sensitive Task signals before lower-priority long-form context such as **Handoff Notes** or the initial prompt.
- A **Reviewed File** can belong to self-review or pull request review; it remains reviewed only while its content identity is unchanged.
- A **Reviewed File Snapshot** records the accepted file version for a **Reviewed File**, not the latest commit on the branch.
- A **Review File Tree** keeps **Reviewed Files** in their original location as navigation items.
- A **Diff File Section** may collapse after its file becomes a **Reviewed File**, while remaining available to reopen.
- A **Project Handoff Notes Template** defines the required shape of **Handoff Notes** for Tasks in one project.
- Existing Tasks may have unstructured historical summaries; **Handoff Notes** are the forward-looking reviewer brief, not a migration requirement.
- A **Task Branch** identifies the **Task**; human-readable context belongs in the **Task**, **Handoff Notes**, PR title, or PR body rather than in prompt-derived branch text.
- The **Marketing Site** presents the desktop product; it does not host **Tasks**, **Implementation Runs**, or **Agent Sessions**.
- The **Marketing Site Primary Visitor** already understands coding agents and needs help coordinating the workflow around them.
- The **Marketing Site Primary Conversion** is supported by source-code credibility, documentation, and philosophy rather than replacing them.
- The **Marketing Site Promise** emphasizes human control over coding-agent workflow, not autonomous replacement.
- The **Marketing Site Plugin Customization Pillar** depends on **Trusted Plugins** and explicit host capabilities rather than implying unrestricted sandboxed code.
- **Marketing Site Top Reasons** frame CLI task management as agent-facing task coordination, not unrestricted app control.
- **Marketing Site Top Reasons** frame PR review and self-review as part of staying in control, not as the sole product category.
- The **Marketing Site Workspace** keeps website implementation separate from the desktop renderer while staying version-aligned with product language and assets.
- The **Marketing Site First Milestone** validates positioning before adding standalone workflow education, standalone local-first trust messaging, multi-page content, analytics, or marketplace-like surfaces.
- The **Marketing Site Visual Direction** should make OpenForge feel precise, grounded, and calm rather than autonomous or noisy.

## Example dialogue

> **Dev:** "Should the scheduler resume this task with the worker agent?"
> **Domain expert:** "No — if there is already an agent session, resuming only reattaches to it. To ask it to do work, send implementation input. New implementation runs use the project agent settings, not plugin-supplied overrides."
>
> **Dev:** "Can the terminal plugin own the shared terminal pool?"
> **Domain expert:** "No — the plugin may provide a Terminal Surface, but shared lifecycle belongs to the Terminal Runtime."

## Flagged ambiguities

- "Cronjob" was used for scheduled task automation — resolved: use **Task Schedule** for the project-owned recurring rule; cron syntax can be a configuration format, not the domain term.
- "Resume" was used to mean both reattaching a detached session and sending a new prompt to an active session — resolved: **Session Reattachment** means reconnect only, while **Implementation Input** is the prompt/message.
- `agent` and `permissionMode` were considered for plugin **Task Creation** — resolved: task creation records work only; execution policy belongs to **Project Agent Settings**.
- Task status was considered for plugin **Task Creation** — resolved: plugin-created tasks always enter the backlog.
- "Handoff" could mean a per-run completion record or the current reviewer brief — resolved: **Handoff Notes** are the current Task-level review brief, not append-only run history.
- The handoff format could be hidden inside broad project instructions — resolved: use a dedicated **Project Handoff Notes Template** so the review contract is explicit.
- "Summary" and **Handoff Notes** overlapped — resolved: user-facing review language should say **Handoff Notes**, while existing unstructured summaries remain valid legacy content.
- "Status cockpit" was used for the task detail sidebar redesign — resolved: use **Task Attention Pane** for the compact attention-first task detail area.
- Worktree branch names were considered for prompt-derived descriptions — resolved: **Task Branches** should be stable task identifiers because they are visible as PR source branches.
- "Skill" was considered as a core OpenForge platform concept because one built-in plugin manages skills — resolved: skill discovery and editing are a **Plugin-owned Domain** unless multiple plugins need a shared platform contract.
- `src-tauri` was used to describe both a historical directory and the active Rust process — resolved: use **Rust Sidecar** for the supervised runtime process and **Backend Crate** for the Rust package that builds it.
- "Terminal pooling" was used for plugin UI, shell process state, and reusable terminal lifecycle — resolved: **Terminal Surface** names the UI, while **Terminal Runtime** names the shared lifecycle owner.
- "Terminal API" could mean a host `openforge.terminal` capability, a normal package dependency, or the shared runtime — resolved: **Terminal Runtime** names the shared runtime; lower-level shell/event APIs remain capability primitives.
- "Latest hash" in self-review could mean branch HEAD, latest commit, or the last accepted file version — resolved: use **Reviewed File Snapshot** for the last accepted file version.
- "Website" could mean a hosted product surface or public promotion — resolved: the current website direction is a **Marketing Site**, not a web version of OpenForge.
- The **Marketing Site First Milestone** could mean the broader ADR 0003 section list or a smaller launch page — resolved: keep the first implementation small and avoid standalone workflow and local-first trust sections.
- "Agent controls OpenForge through the CLI" could imply unrestricted app automation — resolved: the **Marketing Site Top Reasons** should say agents manage OpenForge **Tasks** through the CLI.
- The **Marketing Site Promise** could be inflated into agent autonomy claims — resolved: avoid promises of autonomous engineering teams, code-review replacement, one-click shipping, hosted control planes, universal provider support, or enterprise collaboration suites.
