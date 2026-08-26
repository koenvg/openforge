# OpenForge

OpenForge is a desktop command center for coordinating task work and AI coding agents while keeping the user focused on one active thing at a time.

## Language

**Task**:
A unit of work tracked by OpenForge for a project.
_Avoid_: Ticket, issue, job

**Completed Task**:
A **Task** whose work is finished but remains available as reference for agents while staying out of normal active-task flows.
_Avoid_: Deleted Task, old task, hidden task

**Focus**:
The board view of **Tasks** that need user attention now.
_Avoid_: All current work, in-flight queue

**Set Aside**:
A manual holding place for **Tasks** the user intentionally removes from **Focus** without changing their backlog or completion state.
_Avoid_: Low-Fire, done, archive, low-priority status

**Out of Focus**:
The board tab for **Tasks** the user intentionally removed from the normal **Focus** and **In-Flight Task** flow.
_Avoid_: Low-Fire, archive, backlog

**Task Display Title**:
A short, memorable human label shown for a **Task**, stored separately from the Task's prompt text.
_Avoid_: Prompt title, thread title, branch title

**Task Label**:
A reusable colored marker that can be assigned to one or more **Tasks** within a project to categorize or filter work.
_Avoid_: Tag when referring to the OpenForge task marker

**Implementation Run**:
An agent-driven attempt to work on a **Task** in a task workspace, identified to plugins by task, session, and workspace.
_Avoid_: Agent run when referring to the task-scoped OpenForge concept, provider port

**Agent Session**:
The provider-specific conversation or PTY process attached to an **Implementation Run**.
_Avoid_: Run, task

**In-Flight Task**:
A **Task** with active agent work that does not currently need user attention.
_Avoid_: In-flight session, running session

**Session Reattachment**:
Reconnecting OpenForge to an existing **Agent Session** without changing the provider, agent, or permission mode.
_Avoid_: Restart, start, continue with prompt

**Implementation Input**:
A message sent into an existing **Agent Session** to continue or redirect work.
_Avoid_: Resume, restart

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

**Rich Diff View**:
A supported **Diff File Section** presentation that previews how the changed file will appear after its changes are applied.
_Avoid_: Before-and-after preview, rendered source diff

**Review Feedback Prompt**:
The compiled bundle of inline, general, and PR review comments sent as an **Implementation Input** when the user sends collected feedback to the agent.
_Avoid_: Send-to-agent message, fix-and-push instruction, commit prompt

**Addressed Pull Request Comment**:
A pull request comment the user has marked as handled in OpenForge's local review workflow; it remains a GitHub comment and does not imply that its GitHub conversation was resolved.
_Avoid_: Resolved GitHub comment, dismissed comment
**Project Agent Settings**:
The project-owned choice of provider, agent, and permission mode for new **Implementation Runs**.
_Avoid_: Plugin run options, per-call agent override

**Project Task Creation Settings**:
Project-owned defaults used when starting **Task Creation**, such as the default workspace choice for new **Tasks**.
_Avoid_: Agent run settings, global task defaults, plugin task policy

**Mobile Project Board**:
The companion view of one selected **Project**, whose **Tasks** are partitioned into the canonical Focus, In Flight, Out of Focus, and Backlog lanes for the entire view.
_Avoid_: All-project board, cross-project task list

**Selected Project**:
The **Project** whose **Mobile Project Board** the companion currently presents.
_Avoid_: Active Project, all-project scope, Project filter

**Companion Task Start**:
A request from a **Paired Companion Device** to begin an **Implementation Run** for a backlog **Task** using its existing Project and Task defaults.
_Avoid_: Move to In Flight, change Board Status, configure run

**Trusted Plugin**:
An installed OpenForge extension that may act across tasks when using explicit host capabilities.
_Avoid_: Sandboxed widget, project-only script

**Task Link**:
An HTTP(S) URL activation associated with one **Task**, eligible for handling inside OpenForge while retaining external-browser fallback.
_Avoid_: External URL, browser command, global link

**Host-local URL**:
An HTTP(S) URL emitted by a desktop tool whose loopback host refers to the OpenForge desktop rather than the paired phone.
_Avoid_: Mobile localhost, public URL, Task Link

**Task Link Handler**:
The one active **Trusted Plugin** integration that may claim or decline **Task Links** for in-app presentation.
_Avoid_: URL interceptor, browser command handler, link priority

**Task Browser Surface**:
A browser presentation owned by a **Trusted Plugin** for one **Task** in one OpenForge window, identified within that window, plugin, and Task by a stable local surface identifier.
_Avoid_: Webview, browser tab, raw WebContentsView

**Task Browser DevTools**:
The full Chromium inspection interface for one **Task Browser Surface**, including page elements, console output, network activity, sources, and site storage.
_Avoid_: Chrome debugger, console panel, app DevTools

**Plugin Browser Session**:
The durable browsing identity and site data shared by all of a **Trusted Plugin's** browser surfaces, spanning every **Task** and project, isolated from every other plugin.
_Avoid_: Task Browser Session, per-task login, surface state

**Plugin Browser Permission**:
A user-approved site privilege scoped to one requesting origin and **Plugin Browser Session**. Its identity includes security-relevant request details, such as the exact requested media types.
_Avoid_: Task Browser Permission, plugin permission, automatic permission

**Task Browser Attachment**:
The temporary binding between a **Task Browser Surface** and the visible plugin-owned UI region where OpenForge presents it.
_Avoid_: Raw bounds, WebContentsView mount, permanent surface placement

**Plugin Installation**:
Recording a **Trusted Plugin** as available app-wide in OpenForge without activating it.
_Avoid_: Project plugin install, Plugin Enablement

**Project Plugin Enablement**:
A project-owned choice that makes an installed **Trusted Plugin** active or inactive for one **Project**.
_Avoid_: Plugin installation, global plugin toggle

**App Plugin Enablement**:
An app-owned choice that makes an installed **Trusted Plugin** active throughout OpenForge, independent of the active **Project**.
_Avoid_: Plugin Installation, global project default, sentinel Project

**Agent-facing Plugin Management**:
A host-mediated way for an **Agent Session** to request **Plugin Installation**, **App Plugin Enablement**, or **Project Plugin Enablement** without relying on settings UI navigation.
_Avoid_: UI automation, install-and-enable shortcut, agent-owned plugin policy

**Plugin Reload**:
An explicit request to deactivate and reactivate an installed plugin from its current installed artifacts.
_Avoid_: Source watcher, automatic rebuild, reinstall

**Local Plugin Source**:
A filesystem path to an already-built plugin package used as the package source for **Plugin Installation** during plugin development.
_Avoid_: npm package source, git package source, unbuilt source folder

**GitHub Sync**:
OpenForge's local-first process for refreshing GitHub pull request, comment, CI, review, and merge-readiness signals into the desktop app.
_Avoid_: Webhook service, hosted sync, GitHub polling when referring to the product capability

**Plugin-owned Domain**:
A product area whose language, contracts, and workflows belong to a **Trusted Plugin** rather than OpenForge core.
_Avoid_: Core capability, host feature

**Rust Sidecar**:
The supervised Rust process that owns OpenForge backend domain logic for the Electron desktop app.
_Avoid_: Tauri backend, `src-tauri`, backend service

**Backend Crate**:
The Rust package that contains the **Rust Sidecar** implementation and build metadata.
_Avoid_: `src-tauri`, generic backend folder

**App Update**:
A user-initiated in-app flow for moving the installed OpenForge desktop app to a newer trusted published version.
_Avoid_: CLI update, reinstall script, Codex update

**App Update Indicator**:
A subtle global signal that a newer OpenForge desktop version is available without interrupting the user's current task.
_Avoid_: modal prompt, forced update banner, always-visible update button

**Terminal Runtime**:
The shared OpenForge runtime that owns terminal session lifecycle for **Terminal Surfaces**.
_Avoid_: Terminal plugin internals, ordinary plugin dependency, private terminal pool, private forwarding package

**Terminal Session**:
A desktop-owned terminal identity that combines a live PTY with its current terminal state independently of any **Terminal Surface**.
_Avoid_: xterm instance, terminal DOM, renderer session

**Terminal View Attachment**:
A temporary presentation of one **Terminal Session** within a **Terminal Surface**, without ownership of the session's lifecycle.
_Avoid_: Terminal Session, PTY owner, terminal instance

**Terminal Snapshot**:
A complete renderable view of a **Terminal Session** at one output boundary. OpenForge's current xterm-authoritative mode does not expose **Terminal Snapshots**; it recovers views from bounded PTY byte replay.
_Avoid_: raw replay buffer, terminal transcript, durable terminal history

**Terminal Geometry Lease**:
The exclusive, revocable right of one **Terminal View Attachment** to set the row and column dimensions of its **Terminal Session**.
_Avoid_: shared resize control, viewport size, permanent geometry owner

**Terminal Surface**:
A plugin or core UI area that presents an interactive terminal through the **Terminal Runtime**.
_Avoid_: PTY owner, terminal backend, shell manager

**Companion Terminal**:
A mobile **Terminal Surface** through which a paired device interacts with a desktop-owned terminal session.
_Avoid_: Terminal output viewer, mobile shell, remote desktop

**Companion Agent Terminal**:
The first **Companion Terminal** capability, limited to the **Agent Session** attached to a **Task**.
_Avoid_: General Companion Terminal, shell tab, agent chat

**Companion Terminal Attachment**:
A paired device's temporary interactive connection to an existing desktop-owned terminal session, without ownership of that session's lifecycle.
_Avoid_: Mobile Agent Session, remote session, spawned terminal

**Companion Terminal Channel**:
The authenticated, bidirectional connection that carries terminal interaction for one **Companion Terminal Attachment**.
_Avoid_: Companion event stream, generic command socket, terminal API

**Terminal Replay**:
Retained terminal output sent when a **Companion Terminal Attachment** begins, before live output continues.
_Avoid_: Exact screen snapshot, durable terminal history, session transcript

**Paired Companion Device**:
A mobile device explicitly approved by the desktop to connect to that trusted OpenForge host.
_Avoid_: Authenticated client, discovered device, terminal-only device

**Companion Task Authority**:
The narrow authority of a **Paired Companion Device** to perform explicitly available core Task lifecycle, focus, pull-request, and workspace-run actions, plus app-wide **GitHub Sync**.
_Avoid_: General command access, plugin command execution, unrestricted Task editing

**Mobile Action Palette**:
The companion's context-sensitive picker for currently available core Task actions and a small set of native Project-level actions.
_Avoid_: Mobile Command Palette, Task search, plugin command picker

**Shell Session Key**:
The stable OpenForge identifier for one terminal shell tab, which selects that tab's current concrete **Terminal Session**.
_Avoid_: Task ID, terminal index, PID filename

**Task Creation**:
Recording a new project-owned backlog **Task** from a prompt, without choosing how an agent will run it.
_Avoid_: Run scheduling, agent configuration, global task creation, status selection

**Task Schedule**:
A project-owned one-off or recurring rule that performs **Task Creation** from a prompt and may also request a new **Implementation Run** for the created **Task**.
_Avoid_: Cronjob, task reuse, implementation input schedule

**Scheduled Fire**:
One due or manually requested occurrence of a **Task Schedule**. A due fire may happen at a one-off schedule's exact time, at a recurring schedule's cadence, or as a catch-up after OpenForge restarts.
_Avoid_: Job run, background daemon run, reused task

**Schedule Preset**:
A simple user-facing cadence choice for a recurring **Task Schedule**, such as daily, weekly, monthly, or custom cron.
_Avoid_: One-off timestamp, timezone policy, provider automation type, project selector

**Task Branch**:
A PR-visible Git branch OpenForge creates for a **Task** workspace.
_Avoid_: Prompt branch, run branch, title branch

**Pull Request Merge Method**:
The GitHub-approved way a pull request enters its base branch: merge commit, squash, or rebase. OpenForge follows the authenticated GitHub identity's default while limiting choices to methods GitHub permits for the target branch.
_Avoid_: Merge mode, merge strategy

**Merge Readiness**:
OpenForge's strict assessment that a pull request has a currently valid merge or enqueue action according to known GitHub requirements.
_Avoid_: Review readiness, mergeable state, ready for review

**Ready to Merge**:
A **Merge Readiness** outcome where a pull request can be merged directly without known required blockers.
_Avoid_: Clean, approved, checks passed

**Ready to Enqueue**:
A **Merge Readiness** outcome where a pull request satisfies known pre-queue requirements but must enter a merge queue instead of direct merge.
_Avoid_: Ready to merge, queued

**Queued Pull Request**:
A pull request accepted by GitHub's merge queue where OpenForge should stay quiet unless GitHub reports failed validation, dequeueing, or required input.
_Avoid_: Ready to merge, auto-merge, CI running

**Closed Pull Request**:
A pull request that GitHub closed without merging and that does not by itself mean the **Task** is done.
_Avoid_: Merged, done, completed PR

**Readiness Unknown**:
A temporary **Merge Readiness** condition where GitHub has not provided authoritative readiness for the current pull request state.
_Avoid_: Blocked, ready, failed

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
The first website implementation target: a small static one-page **Marketing Site** ordered as hero with a concrete task → agent → changes → review workflow visual, top reasons, product screenshot proof, a small plugin customization section, install/GitHub call-to-action block, and footer links.
_Avoid_: Blog, hosted docs system, plugin marketplace, analytics, mailing list, interactive demo, standalone workflow section, standalone local-first trust section

**Marketing Site Visual Direction**:
A developer-tool aesthetic for the **Marketing Site** that uses a concrete workflow hero visual and product screenshots rather than generic AI imagery; a vibrant block/bento hero is acceptable when it still makes the task → agent → changes → review path clear.
_Avoid_: AI SaaS hype visuals, metric-heavy dashboard aesthetic, abstract robot art

## Relationships

- The **Mobile Action Palette** mirrors the desktop action model, not Task or plugin-command search; native mobile navigation remains outside the palette.
- The **Mobile Action Palette** presents only actions currently granted by **Companion Task Authority** and available for its Task or **Selected Project** context.
- **GitHub Sync** remains app-wide when invoked from a **Selected Project** context; the **Selected Project** determines where the action appears, not what OpenForge refreshes.
- **Task Creation** creates a project-owned backlog **Task**, not an **Implementation Run**.
- A **Task Display Title** belongs to a **Task** and does not change its initial or mutable prompt.
- Automatic **Task Display Title** generation is an experimental opt-in feature; when enabled, it happens at most once early in **Agent Session** activity and only when the user has not manually set a title.
- A **Task Label** may be created while assigning labels to a **Task**; removing a label from one **Task** is separate from deleting the reusable **Task Label** from the project.
- **Project Task Creation Settings** provide defaults for **Task Creation** while still allowing a specific new **Task** to override them before it is saved.
- A **Task Schedule** creates a new normal board **Task** for each **Scheduled Fire** rather than mutating or reusing an existing **Task**.
- A **Task Schedule** has either one exact future fire time or a recurring cadence. Agent-facing scheduling commands support both kinds; the desktop composer provides recurring presets and custom five-field cron.
- A **Task Schedule** belongs to one project. The desktop composer uses the active project, while agent-facing commands use their host-resolved project context and do not add a dependency on the invoking **Task**.
- A **Task Schedule** may request an **Implementation Run** only after the scheduled **Task Creation** succeeds.
- A one-off **Task Schedule** has one due **Scheduled Fire**. If OpenForge is closed at its fire time, it gets one catch-up fire after restart, then remains stored as a completed record. The Task Schedules UI shows completed and cancelled one-off records for seven days after completion or cancellation.
- If a recurring **Task Schedule** misses multiple **Scheduled Fires** while OpenForge is closed, they collapse into at most one catch-up fire after OpenForge restarts.
- A recurring **Task Schedule** skips a due **Scheduled Fire** when its previously created **Task** is still not done.
- A **Schedule Preset** may compile to simple five-field cron syntax for custom cadence without making cron syntax the primary user-facing path.
- A **Task Schedule** uses plain prompt text rather than template variables, scripts, loops, conditionals, or starter prompt templates.
- A **Task Schedule** can be manually fired for testing, using the same behavior and overlap rules as a due **Scheduled Fire**. A completed or cancelled one-off schedule cannot fire again, and a manual fire that creates a **Task** consumes its one occurrence.
- A **Task Schedule** keeps a minimal history of its five most recent outcomes for diagnosis. Completed and cancelled schedules remain stored rather than being deleted. For one-off schedules, the seven-day Task Schedules UI window changes only visibility, not storage.
- **Scheduled Fires** do not create a separate automation inbox, auto-archive workflow, or scheduler-specific notification flow; resulting **Tasks** follow the normal OpenForge board and review lifecycle.
- The normal board tab order is **Focus**, **In-Flight Tasks**, **Out of Focus**, then backlog, keeping started/current work together before not-started work.
- **Focus** contains **Tasks** needing user attention now unless they are **Out of Focus**.
- **In-Flight Tasks** have their own board tab beside **Focus**, **Out of Focus**, and backlog.
- User-configured focus settings decide which Task states count as needing attention; **In-Flight Tasks** are all non-attention current work left after applying those settings, not only Tasks with an active **Agent Session**.
- Starting a backlog **Task** puts it into the normal board flow; a started/current **Task** may then be **Set Aside** when the user wants it moved **Out of Focus** until they explicitly bring it back.
- **Set Aside** and **Return to Board** are the user-facing action labels; they do not need to repeat the **Out of Focus** tab name.
- **Return to Board** moves an **Out of Focus** **Task** back into the normal board flow, where the user's focus settings decide whether it appears in **Focus** or with **In-Flight Tasks**.
- **Out of Focus** can contain both attention-needing **Tasks** and **In-Flight Tasks**, grouped by their current state when shown.
- An **Out of Focus** **In-Flight Task** stays **Out of Focus** when it later needs user attention; only the user can bring it back into **Focus**.
- Board tab counts for **Focus**, **In-Flight Tasks**, and **Out of Focus** count **Tasks** that need user attention, not total visible Tasks.
- **Out of Focus** uses the same board-tab styling as **Focus**, **In-Flight Tasks**, and backlog; its meaning comes from placement and action language, not special visual treatment.
- **Out of Focus** is part of the core **Task** board because it protects the default attention-only **Focus** promise; custom board workflows may later belong to **Trusted Plugins** when OpenForge exposes explicit capabilities for them.
- An **Implementation Run** uses exactly one **Agent Session** at a time.
- The **Companion Agent Terminal** is the first delivery slice of the **Companion Terminal**; later slices may include ordinary shell sessions.
- A **Companion Terminal Attachment** connects to an existing terminal session without creating, resuming, aborting, replacing, or otherwise owning that session.
- Ending a **Companion Terminal Attachment** does not end its desktop-owned terminal session.
- A **Companion Agent Terminal** is addressed by **Task**; the desktop resolves the Task's current **Agent Session** without exposing provider-specific session identifiers to the paired device.
- A **Companion Agent Terminal** is the same product concept across all supported Agent providers.
- A **Companion Terminal Attachment** remains bound to the **Agent Session** resolved when it began; it ends with that session and never switches automatically to a later session for the same **Task**.
- A **Paired Companion Device** may hold one **Companion Terminal Attachment** at a time; beginning another replaces that device's previous attachment without affecting attachments from other paired devices.
- A new **Implementation Run** uses the **Project Agent Settings** rather than plugin-supplied provider or agent overrides.
- A **Trusted Plugin** may start an **Implementation Run** for any **Task** when using the host-provided task capability.
- A **Task Link** is offered to the active **Task Link Handler**; when no handler exists or it declines, OpenForge opens the URL externally.
- A **Host-local URL** refers to the desktop host even when it is presented on a paired phone; it is not a **Task Link** or a URL on the phone's loopback interface.
- A failed **Task Link Handler** does not also trigger external fallback because it may already have partially handled the link.
- A live **Task Browser Surface** is uniquely identified by its owning OpenForge window, **Trusted Plugin**, **Task**, and plugin-local surface identifier.
- Every **Task Browser Surface** owned by the same **Trusted Plugin** shares one **Plugin Browser Session** regardless of **Task** or project, so a login performed in one Task is available in every other; no browser session data is shared across plugins.
- Detaching a **Task Browser Surface** hides it while preserving its live, background-throttled page state; destroying it releases that live page without deleting its **Plugin Browser Session**.
- OpenForge destroys live **Task Browser Surfaces** when their owning plugin deactivates, reloads, or is uninstalled; when their owning **Task** is permanently deleted; or when their OpenForge window closes, even if the plugin omitted cleanup.
- A **Plugin Browser Session** survives surface destruction, app restart, plugin disablement or reload, and permanent **Task** deletion; OpenForge purges it only when its plugin is uninstalled, and clears it on explicit session reset.
- OpenForge mediates every **Plugin Browser Permission** request; plugins cannot grant permissions, unknown permissions are denied, and approved permissions are limited to the requesting origin, **Plugin Browser Session**, and exact permission descriptor.
- A user may remember an allow or block decision for one origin and exact permission descriptor in a **Plugin Browser Session**; a remembered decision therefore applies in every **Task**, unremembered decisions apply only to the current request, and resetting the session clears remembered decisions.
- Resetting a **Plugin Browser Session** destroys that plugin's live surfaces and popups across every **Task** and clears site data, cache, service workers, and remembered permissions without deleting plugin-owned task storage; there is no way to reset one **Task's** browsing identity alone.
- HTTP(S) popups requested by a **Task Browser Surface** are host-owned child windows that share its **Plugin Browser Session** and security policies; plugins cannot access the child window directly, and unsupported schemes or window options are rejected.
- A **Task Browser Surface** permits only HTTP(S) top-level navigation, with `about:blank` reserved for host startup; filesystem, executable, app-internal, custom, malformed, and other schemes are blocked.
- A **Plugin Browser Session** persists site data only; its plugin persists each surface's last committed URL in task-scoped plugin storage and supplies that URL when recreating the surface, so browsing history and open pages stay per-**Task** while the login does not.
- A plugin creates a **Task Browser Attachment** by giving OpenForge a visible DOM element; OpenForge tracks and clamps that element's bounds and detaches the surface when the element is hidden, disconnected, or explicitly released.
- A **Task Browser Attachment** reports bounds in renderer CSS pixels; Electron main converts them with the owning window's renderer zoom factor before clamping them against the window content bounds, so a zoomed UI still places the surface over its plugin-owned region.
- A **Task Browser Surface** reports URL, title, loading, history availability, and navigation failure as one current state snapshot so plugins do not reconcile independently ordered event fragments.
- Downloads from a **Task Browser Surface** require a host-owned save prompt for each file; plugins cannot choose download paths, auto-accept downloads, or access Electron download handles.
- Every **Task Browser Surface** and host-owned child window uses a non-configurable sandboxed browser configuration with no Node integration, preload script, webview embedding, insecure-content override, or drag-drop navigation.
- **Task Browser DevTools** are available in development and packaged builds, use right-docked presentation only as the initial default, remember the user's Chromium dock preference across surfaces and restarts, and retain Chromium's native bottom-dock and undock controls.
- Opening **Task Browser DevTools** cancels an active visual-feedback region selection without removing saved annotations or review markers.
- Opening **Task Browser DevTools** only after an explicit user action is a **Trusted Plugin** UX contract; host authorization enforces surface ownership rather than attempting to prove renderer gesture provenance.
- The open state of **Task Browser DevTools** belongs to its live **Task Browser Surface**: it survives detachment, docked tools hide and return with the surface, deliberately undocked tools remain visible, and destruction, session reset, or OpenForge window closure ends them.
- Open **Task Browser DevTools** state is not restored after surface recreation or app restart.
- A host-owned browser popup has its own **Task Browser DevTools** target: Inspect and standard shortcuts act on the focused popup, while the Browser-tab toolbar continues to act on the main **Task Browser Surface**.
- Each OpenForge window keeps at most four detached **Task Browser Surfaces** alive; when capacity is exceeded, OpenForge destroys the least-recently-used detached surface while preserving its **Plugin Browser Session** and restorable URL.
- The frontend-only browser-surface capability qualifies the owning plugin, requires a valid Task and plugin-local surface identifier, and returns typed controls—including **Task Browser DevTools** controls—only for that plugin's own surfaces after verifying the plugin is enabled for the Task's project.
- Plugin uninstall durably schedules its **Plugin Browser Session** purge until Electron completes and acknowledges it; permanent **Task** deletion schedules no browser purge.
- On first launch after adopting **Plugin Browser Sessions**, OpenForge clears every legacy per-**Task** browser partition in its registry so no site data remains that no surface can reach and no reset can clear.
- A plugin may omit a surface's initial URL; newly created surfaces start at `about:blank` until the plugin navigates them.
- `getOrCreate` communicates that requesting an existing **Task Browser Surface** returns control of that live surface; an initial URL applies only when no live surface exists.
- Attaching a **Task Browser Surface** to a new element atomically replaces its previous attachment; releasing an older attachment cannot detach a newer one.
- A **Trusted Plugin** may own a **Plugin-owned Domain** when the concept is not shared across plugins or core workflows.
- **Plugin Installation** makes a **Trusted Plugin** available without activating it.
- A **Trusted Plugin** uses either **App Plugin Enablement** or **Project Plugin Enablement** as declared by its package.
- A project-enabled **Trusted Plugin** runtime follows **Project Plugin Enablement** across **Selected Project** changes. It remains active when both Projects enable it, receives the new Project context, stops when the destination disables it or no Project is selected, and starts when the destination newly enables it.
- An app-enabled **Trusted Plugin** runtime remains active across visible Project changes. OpenForge updates its current Project context without restarting the runtime.
- **Plugin Installation** does not automatically imply either form of enablement.
- Newly installed non-built-in **Trusted Plugins** start disabled until explicitly enabled.
- Built-in project-enabled **Trusted Plugins** may be enabled by default for projects, while still allowing explicit **Project Plugin Enablement** disablement.
- Global plugin settings manage the **Plugin Installation** inventory and **App Plugin Enablement**; project plugin settings manage **Project Plugin Enablement** for the active project.
- A completed **Plugin Installation** may offer the matching enablement action, but enablement remains explicit.
- The agent-facing plugin management surface keeps **Plugin Installation**, **App Plugin Enablement**, and **Project Plugin Enablement** as separate requests and does not provide an install-and-enable shortcut.
- **Plugin Reload** uses the artifacts already recorded by **Plugin Installation**; rebuilding a plugin package is external development work that must happen before the reload request.
- Initial agent-facing **Plugin Installation** accepts local plugin sources only; npm and git plugin package sources remain outside the initial agent-facing plugin management surface.
- Moving plugin management UI between global and project settings does not require migrating existing **Plugin Installation**, **App Plugin Enablement**, or **Project Plugin Enablement** data when the persisted model already separates them.
- The **Backend Crate** builds the **Rust Sidecar**.
- An **App Update** updates the whole OpenForge desktop app rather than only updating the OpenForge CLI.
- An **App Update** may be discovered quietly, but installing it is user-initiated.
- An **App Update** is offered only for trusted stable published releases that satisfy the project's release security bar.
- An **App Update** must warn before quitting OpenForge while active **Agent Sessions** or **Terminal Surfaces** could be interrupted.
- An **App Update Indicator** appears only when an **App Update** is available and points to the primary Settings action.
- Electron main owns **App Update** orchestration because replacing and relaunching the app bundle is shell-level work.
- An **App Update** preserves the current installed app if download, verification, staging, or replacement fails.
- After explicit confirmation, an **App Update** completes the download, verification, app replacement, CLI payload refresh, and relaunch without requiring manual Finder steps.
- **App Update** availability is determined by comparing the current packaged app version with the latest trusted stable published release.
- **App Update** v1 does not provide automatic rollback after a successful replacement; users can manually reinstall a prior trusted release if needed.
- **App Update** UI links to release notes rather than embedding a changelog in the Settings card.
- Electron main supervises the **Rust Sidecar** rather than embedding backend domain logic in the renderer or relying on a Tauri shell.
- A **Terminal Surface** uses the **Terminal Runtime** and does not own shell process state.
- The **Terminal Runtime** owns **Terminal Session** lifecycle and its xterm-authoritative parsed state, while the **Rust Sidecar** owns each PTY and bounded raw-byte replay.
- A **Terminal View Attachment** mounts the one xterm view for its **Terminal Session**. Initial acquisition and reconnect apply PTY byte replay for the current PTY instance before later live output.
- The current xterm-authoritative mode has no production **Terminal Snapshot** route. A future snapshot owner requires an explicit authority-contract transition.
- The active desktop **Terminal View Attachment** holds the **Terminal Geometry Lease**; one companion may hold it only while no desktop attachment exists.
- xterm is the sole authority for terminal-generated protocol replies. **Terminal Runtime** sends each reply through a separate Shell Session Key and PTY-instance-scoped write boundary.
- A reconnect requests bounded PTY byte replay. **Terminal Runtime** rejects replay, output, exits, and generated replies from a replaced PTY instance.
- Replacing, hiding, or ending a **Terminal View Attachment** does not end its **Terminal Session** or accumulate an unbounded hidden-view output queue.
- Explicit termination, PTY exit, applicable permanent **Task** deletion, or app shutdown ends a **Terminal Session**; ordinary view and renderer lifecycle events do not.
- The **Terminal Runtime** is shared across **Terminal Surfaces** when they need one terminal lifecycle owner.
- The **Terminal Runtime** uses **Shell Session Keys** to distinguish terminal shell tabs/sessions.
- A **Shell Session Key** is not a **Task** id, even when it belongs to a **Task** terminal.
- A **Shell Session Key** may select a succession of distinct **Terminal Sessions** over time; replacing the current session ends it and creates another under the same key.
- A **Task** with unmet dependencies cannot start an **Implementation Run**.
- A **Task** with an active **Agent Session** cannot start another **Implementation Run**.
- **Session Reattachment** preserves the existing **Agent Session** identity.
- **Implementation Input** targets an existing **Agent Session** and does not choose a new provider or agent.
- A **Task Attention Pane** surfaces the most time-sensitive Task signals before lower-priority long-form context such as the initial prompt.
- A **Reviewed File** can belong to self-review or pull request review; it remains reviewed only while its content identity is unchanged.
- A **Reviewed File Snapshot** records the accepted file version for a **Reviewed File**, not the latest commit on the branch.
- A **Review File Tree** keeps **Reviewed Files** in their original location as navigation items.
- A **Diff File Section** may collapse after its file becomes a **Reviewed File**, while remaining available to reopen.
- A supported **Diff File Section** defaults to its source diff and may switch independently to a **Rich Diff View** of the post-change result.
- A **Review Feedback Prompt** instructs the agent to evaluate and fix the feedback only; it never instructs version-control actions (commit, push, PR) — those decisions stay with the user.
- A **Task Branch** identifies the **Task**; human-readable context belongs in the **Task**, PR title, or PR body rather than in prompt-derived branch text.
- A direct merge uses an explicitly selected **Pull Request Merge Method**. OpenForge places the authenticated GitHub identity's default first, never substitutes another method after confirmation, and limits choices to methods GitHub permits for the target branch.
- **Merge Readiness** is stricter than review readiness; it should not mark a pull request ready only because a human could start reviewing it.
- **Ready to Merge** and **Ready to Enqueue** are distinct first-class **Merge Readiness** outcomes because merge queues replace direct merge action with queue entry.
- **Ready to Enqueue** remains a first-class handoff even before OpenForge can perform the enqueue action itself.
- **Ready to Enqueue** implies OpenForge should eventually provide an enqueue action; lacking that action is temporary product debt, not the target workflow.
- When GitHub requires a merge queue, **Merge Readiness** uses **Ready to Enqueue** rather than **Ready to Merge**.
- A **Queued Pull Request** is not done until GitHub merges it, but it should stay low-noise while GitHub owns progress.
- A **Queued Pull Request** stops being a user-action handoff until GitHub reports failed validation, dequeueing, or required input.
- **Readiness Unknown** should appear as pull request detail rather than a board-level handoff unless another definitive signal exists.
- Unaddressed pull request comments block **Merge Readiness** only when GitHub or repository policy requires conversation resolution.
- A pull request being behind its base branch blocks **Merge Readiness** only when GitHub requires the branch to be up to date.
- Unknown repository merge policy prevents first-class **Merge Readiness** handoffs when the repository appears protected, but simple unprotected repositories may use legacy mergeability signals as a fallback.
- Active changes-requested reviews block **Merge Readiness** unless GitHub's current authoritative review decision says they no longer block the pull request.
- Auto-merge being enabled is pull request detail only; it is not **Ready to Merge**, **Ready to Enqueue**, **Queued Pull Request**, or done.
- Draft pull requests block **Merge Readiness** even when checks pass or reviews are approved.
- A **Closed Pull Request** is distinct from a merged pull request and does not make a **Task** done unless another completion signal exists.
- The **Rust Sidecar** owns persisted **Merge Readiness** so board state, actions, plugins, and future CLI surfaces share one source of truth.
- **GitHub Sync** is local-first by default and may use polling, conditional requests, caches, and backoff without requiring a hosted webhook receiver.
- **GitHub Sync** may refresh active attention surfaces faster than inactive project or global pull request data, while manual refresh remains available for explicit full freshness.
- **GitHub Sync** prioritizes **Task**-linked **Merge Readiness** freshness over lower-attention pull request review list freshness when rate-limit budget is constrained.
- **GitHub Sync** spends its fastest refresh budget on Focus-column **Tasks** in the active project, then other active-project task-linked pull requests, then inactive projects, then global review-list data.
- **GitHub Sync** may temporarily increase refresh frequency for Focus-column **Tasks** whose task-linked pull request has pending CI, then slow down after CI settles or GitHub reports a definitive readiness outcome.
- **Merge Readiness** is scoped to the GitHub identity OpenForge will use for merge or enqueue actions, not to an arbitrary administrator.
- When multiple pull requests belong to one **Task**, OpenForge should evaluate each pull request independently and surface the most attention-worthy pull request rather than the first open pull request.
- An immediately actionable **Merge Readiness** outcome is more attention-worthy than a blocked pull request; definitive blockers are more attention-worthy than passive waiting or queued states.
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
>
> **Dev:** "The PR is approved and checks passed — should the task say it's ready?"
> **Domain expert:** "Only if **Merge Readiness** says GitHub has a valid merge or enqueue action now; otherwise show review details without creating a ready handoff."

## Flagged ambiguities

- "Cronjob" was used for scheduled task automation. Use **Task Schedule** for the project-owned one-off or recurring rule; cron syntax configures recurring schedules but is not the domain term.
- "Resume" was used to mean both reattaching a detached session and sending a new prompt to an active session — resolved: **Session Reattachment** means reconnect only, while **Implementation Input** is the prompt/message.
- `agent` and `permissionMode` were considered for plugin **Task Creation** — resolved: task creation records work only; execution policy belongs to **Project Agent Settings**.
- Task status was considered for plugin **Task Creation** — resolved: plugin-created tasks always enter the backlog.
- "Status cockpit" was used for the task detail sidebar redesign — resolved: use **Task Attention Pane** for the compact attention-first task detail area.
- Worktree branch names were considered for prompt-derived descriptions — resolved: **Task Branches** should be stable task identifiers because they are visible as PR source branches.
- "Codex thread title" was used for a short generated task label — resolved: use **Task Display Title** because the label belongs to the **Task** and may be generated from any provider's **Agent Session**.
- "Skill" was considered as a core OpenForge platform concept because one built-in plugin manages skills — resolved: skill discovery and editing are a **Plugin-owned Domain** unless multiple plugins need a shared platform contract.
- "Install plugin globally" could mean availability or activation — resolved: use **Plugin Installation** for availability, **App Plugin Enablement** for app-owned activation, and **Project Plugin Enablement** for per-project activation.
- "Agent installs a plugin" could mean only app-wide availability or also activation — resolved: **Agent-facing Plugin Management** may request **Plugin Installation**, **App Plugin Enablement**, and **Project Plugin Enablement**, but they remain separate actions with no install-and-enable shortcut.
- "Reload plugin" could mean watching source files, rebuilding, reinstalling, or reactivating — resolved: **Plugin Reload** means explicit reactivation of installed artifacts only; it does not watch source files or rebuild plugin packages.
- "Local plugin install" could mean project-scoped enablement or a local package source — resolved: use **Local Plugin Source** for filesystem package paths, and keep npm and git plugin package sources out of the initial agent-facing scope.
- Plugin defaults could make newly installed plugins active automatically — resolved: newly installed non-built-in **Trusted Plugins** start disabled; built-in project-enabled packages may keep their per-project default behavior.
- App-owned activation could have reused a sentinel Project — resolved: **App Plugin Enablement** is a separate choice from **Project Plugin Enablement**.
- `src-tauri` was used to describe both a historical directory and the active Rust process — resolved: use **Rust Sidecar** for the supervised runtime process and **Backend Crate** for the Rust package that builds it.
- "Codex update" was used as shorthand for a visible in-app app update button — resolved: use **App Update** for the OpenForge desktop update flow.
- "Terminal pooling" was used for plugin UI, shell process state, and reusable terminal lifecycle — resolved: **Terminal Surface** names the UI, while **Terminal Runtime** names the shared lifecycle owner.
- "Terminal API" could mean a host `openforge.terminal` capability, a normal package dependency, or the shared runtime — resolved: **Terminal Runtime** names the shared runtime; lower-level shell/event APIs remain capability primitives.
- "Latest hash" in self-review could mean branch HEAD, latest commit, or the last accepted file version — resolved: use **Reviewed File Snapshot** for the last accepted file version.
- "Website" could mean a hosted product surface or public promotion — resolved: the current website direction is a **Marketing Site**, not a web version of OpenForge.
- The **Marketing Site First Milestone** could mean a broad product tour or a smaller launch page. Resolved: keep the first implementation small and avoid standalone workflow and local-first trust sections.
- "Agent controls OpenForge through the CLI" could imply unrestricted app automation — resolved: the **Marketing Site Top Reasons** should say agents manage OpenForge **Tasks** through the CLI.
- The **Marketing Site Promise** could be inflated into agent autonomy claims — resolved: avoid promises of autonomous engineering teams, code-review replacement, one-click shipping, hosted control planes, universal provider support, or enterprise collaboration suites.
- "Ready" for pull requests could mean ready for human review, direct merge, or merge queue entry — resolved: use **Merge Readiness** only for strict GitHub-actionable merge or enqueue handoffs.
- "GitHub syncing" could mean local polling or an external webhook receiver — resolved: **GitHub Sync** stays local-first by default; webhook receivers are optional future integrations, not the core desktop path.
- "Fresh GitHub data" could mean every repository is equally current or only the active attention surface is current — resolved: **GitHub Sync** can be attention-scoped, with manual refresh for explicit freshness.
- "Refresh Pull Requests" sounded like review-list refresh only — resolved: user-facing manual refresh should say GitHub status when it refreshes **Task** pipeline and **Merge Readiness** signals.
- Closed pull requests were treated like merged pull requests — resolved: a **Closed Pull Request** is closed without merge and is not a completion signal by itself.
- "Focus" was used to mean both all in-progress work and work needing user attention — resolved: **Focus** means attention-needing **Tasks**, while in-flight work should stay quiet unless it needs attention.
- "Low-Fire" implied priority or a special status — resolved: use **Set Aside** for the manual action and **Out of Focus** for the board tab that holds intentionally removed **Tasks**.
- **Out of Focus** was considered as plugin-only customization — resolved: keep the attention-protection behavior in core, while leaving richer custom board workflows for future **Trusted Plugin** capabilities.
- **Out of Focus** Tasks that later become urgent could have been auto-returned to **Focus** — resolved: manual removal is a promise, so they stay **Out of Focus** until the user brings them back, even when passive work turns into review or intervention work.
- "In-flight session" was used for running work in board lists — resolved: use **In-Flight Task** because the board groups **Tasks**, not raw **Agent Sessions**.
- **Set Aside** and **In-Flight Task** were conflated as competing board tabs — resolved: **Set Aside** is the action that moves a **Task** **Out of Focus**, while **In-Flight Tasks** also have their own normal board tab.
- **Out of Focus** tab counts could have shown total parked work — resolved: counts stay consistent with the current board convention and show only **Tasks** needing attention.
- In-flight placement could have ignored user focus settings — resolved: the boundary between **Focus** and **In-Flight Tasks** follows the user's configured attention states.
- **In-Flight Task** could have meant only active agent/session work — resolved: it means any started current work that does not need user attention under the user's settings.
- Returning an **Out of Focus** **Task** could have required separate "Return to Focus" and "Return to In Flight" actions — resolved: use **Return to Board** and let current state/settings determine placement.
- Backlog **Tasks** could have been moved **Out of Focus** — resolved: keep backlog as the only place for not-started work, and reserve **Out of Focus** for started/current work the user intentionally hides from normal attention.
- Starting a backlog **Task** directly **Out of Focus** was considered — resolved: starting work should enter the normal board flow first; **Set Aside** is a separate explicit user action afterward.
- Board tab order could have placed backlog before **Out of Focus** — resolved: keep **Focus**, **In-Flight Tasks**, and **Out of Focus** adjacent because they are all started/current work, then put backlog last.
- **Out of Focus** could have been visually quieter than other tabs — resolved: give it the same tab styling as the others so it remains trusted and easy to return to.
- Out-of-focus actions could have repeated the tab name — resolved: use natural action labels, **Set Aside** and **Return to Board**, while the tab carries the **Out of Focus** name.
