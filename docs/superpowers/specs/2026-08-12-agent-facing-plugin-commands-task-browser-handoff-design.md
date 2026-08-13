## Problem Statement

When an Agent finishes browser-based work, it cannot currently leave the result open at the correct URL in the Task Browser for the user. The OpenForge CLI has a fixed set of core commands, so a Trusted Plugin cannot expose a Task-aware action to an Agent Session or explain how that action should be used. As a result, agents can start and verify a development server but cannot hand the running page back through the Browser plugin's existing Task Browser Surface and persistent Plugin Browser Session.

## Solution

Add a generic, explicitly agent-facing Plugin Command contract to OpenForge. Trusted Plugins can opt selected commands into CLI discovery and invocation by supplying structured agent guidance alongside their existing input and output schemas. The standard OpenForge skill teaches agents how to list, describe, and invoke those commands; plugins do not install arbitrary skill files.

Extend the OpenForge CLI with `plugin command list`, `plugin command describe`, and `plugin command invoke`. The CLI resolves Task context from an explicit flag or `OPENFORGE_TASK_ID`, verifies Project Plugin Enablement, and routes the request to the runtime where the command is registered. Backend Plugin Commands execute through the backend plugin host. Frontend Plugin Commands execute through a host-mediated request/response bridge to the active Electron renderer, with bounded acknowledgement and explicit availability errors.

The Task Browser plugin contributes an agent-facing `open` command. Given an HTTP(S) URL and Task invocation context, it gets or creates that Task's stable `main` Task Browser Surface and navigates it without changing OpenForge's visible Project, selected Task, active view, Browser tab, or window focus. The command succeeds when navigation is accepted, while a short-lived observer persists the first successful settled final URL for restoration. The Browser plugin also contributes concise project-scoped start-prompt guidance telling agents to use the command explicitly for browser-based work. Existing Plugin Browser Session persistence provides login-once authentication reuse.

## User Stories

1. As a developer using an Agent Session, I want enabled Trusted Plugins to expose selected actions through the OpenForge CLI, so that the agent can participate in plugin-owned workflows without UI automation.
2. As a plugin author, I want Plugin Command CLI exposure to use the existing command model, so that I do not maintain a second unrelated action system.
3. As a plugin author, I want CLI exposure to require explicit agent metadata, so that ordinary command-palette actions are not accidentally granted to agents.
4. As a plugin author, I want agent-facing discoverability to be independent from user-facing command-palette discoverability, so that each audience can receive the appropriate command catalog.
5. As an agent, I want to list agent-facing Plugin Commands enabled for my Task's project, so that I can discover available capabilities at runtime.
6. As an agent, I want command listings to contain stable qualified identifiers and concise descriptions, so that I can choose a command without guessing.
7. As an agent, I want to describe one Plugin Command, so that I can inspect its input schema, output schema, examples, runtime requirement, and usage guidance before invoking it.
8. As a plugin author, I want to provide structured examples for an agent-facing Plugin Command, so that agents can construct valid inputs reliably.
9. As an agent, I want to invoke a Plugin Command with JSON input, so that commands can accept typed plugin-owned data without core CLI flags for every plugin feature.
10. As a plugin author, I want command input and output schemas enforced during CLI invocation, so that malformed agent requests fail before producing ambiguous behavior.
11. As an agent, I want validation errors to identify the qualified command and invalid input, so that I can correct a request without inspecting plugin internals.
12. As an agent, I want the current Task to default from `OPENFORGE_TASK_ID`, so that the common Task-scoped invocation is concise inside an Implementation Run.
13. As an agent, I want to override Task context with `--task-id`, so that I can explicitly address another valid Task when the workflow requires it.
14. As an agent, I want project-scoped discovery when no Task is appropriate, so that non-Task Plugin Commands can still be listed, described, and invoked in the correct Project.
15. As a user, I want OpenForge to resolve the targeted Task's project and verify Project Plugin Enablement, so that an agent cannot invoke a plugin that is inactive for that Project.
16. As a user, I want commands from disabled or uninstalled plugins to fail explicitly, so that no stale capability appears to succeed.
17. As a plugin author, I want both frontend and backend Plugin Commands to be agent-facing, so that the generic mechanism is not tied to one runtime.
18. As an agent, I want backend Plugin Commands to execute through the backend plugin host, so that backend-owned actions do not depend on a visible renderer.
19. As an agent, I want frontend Plugin Commands to execute through the active Electron renderer, so that frontend-only capabilities such as Task Browser Surfaces remain usable through their proper runtime.
20. As an agent, I want frontend invocation to return the command's typed output or error, so that I can report a trustworthy outcome.
21. As an agent, I want frontend invocation to have a bounded timeout, so that a missing or unresponsive renderer does not hang the Implementation Run indefinitely.
22. As an agent, I want OpenForge to reject frontend invocation when the desktop app, renderer, or plugin frontend runtime is unavailable, so that commands are never silently queued for an unknown future state.
23. As a user, I want CLI-triggered frontend commands to run without changing OpenForge navigation unless the command explicitly owns such behavior, so that agent actions do not disrupt my current focus.
24. As a Browser plugin user, I want an agent to navigate the Task Browser to the completed feature, so that the result is ready when I inspect that Task later.
25. As an agent, I want the Browser plugin to expose a stable qualified `open` command, so that I do not need to know renderer APIs or Electron internals.
26. As an agent, I want the Browser command to accept the complete HTTP(S) URL, including route and port, so that the exact verified page is handed to the user.
27. As a Browser plugin user, I want invalid, malformed, and non-HTTP(S) URLs rejected, so that the command preserves the Task Browser Surface security policy.
28. As an agent, I want the Browser command to use Task invocation context rather than embedding `taskId` inside plugin JSON input, so that targeting remains consistent across Plugin Commands.
29. As a Browser plugin user, I want the command to reuse the Task's stable `main` Task Browser Surface, so that CLI navigation and the visible Browser tab represent the same page.
30. As a Browser plugin user, I want the command to work while the Browser tab is detached or not visible, so that the agent does not need to manipulate OpenForge UI state.
31. As a user, I want Browser command invocation not to select the Task, switch Projects, foreground the Browser tab, change the active view, focus OpenForge, or raise its window, so that my current activity is uninterrupted.
32. As an agent, I want the Browser command to succeed once valid navigation is accepted, so that I do not wait for network-idle conditions the Browser Surface does not promise.
33. As an agent, I want an immediate Browser Surface navigation error returned as a command failure, so that I do not falsely claim the page was opened.
34. As a Browser plugin user, I want the first successful settled final URL from the accepted navigation persisted, so that redirects and final routes restore correctly later.
35. As a Browser plugin user, I want background URL persistence to clean up its observer after success or terminal failure, so that repeated agent invocations do not leak listeners.
36. As a Browser plugin user, I want an older invocation's observer not to overwrite the URL from a newer navigation, so that the last accepted browser action remains authoritative.
37. As an agent, I want the Browser plugin's start-prompt guidance to tell me to start and verify the development server before invoking `open`, so that users receive a working page rather than a guessed URL.
38. As an agent, I want that guidance to apply only when the Browser plugin is enabled for the Project, so that prompts do not advertise unavailable commands.
39. As an agent, I want the guidance to say that Browser opening is explicit and relevant only to browser-based work, so that non-browser Tasks do not produce unnecessary browser actions.
40. As a user, I want the Browser plugin to reuse its existing Plugin Browser Session, so that a login performed manually once remains available across Tasks and projects.
41. As a user, I want agents told not to export credentials or automate login through this feature, so that authentication remains under the existing Browser security model.
42. As a user, I want an agent to navigate to a login page and report that manual login is needed when the session is unauthenticated, so that lack of authentication is clear without unsafe credential handling.
43. As a plugin author, I want the standard OpenForge skill to explain generic command discovery and invocation, so that every agent provider learns one stable workflow.
44. As a plugin author, I want my command's structured guidance to appear dynamically through `describe`, so that updating plugin behavior does not require editing the global OpenForge skill.
45. As a user, I want commands hidden from agent catalog discovery to remain invocable only by exact qualified identifier when explicitly agent-enabled, so that advanced workflows can stay out of routine agent discovery.
46. As an agent, I want CLI results printed as JSON, so that I can consume success and failure details without scraping UI text.
47. As a maintainer, I want the generic command broker to preserve plugin qualification and Project Plugin Enablement checks across both runtimes, so that frontend and backend execution follow one authorization model.
48. As a maintainer, I want command execution correlated with one request identifier, so that concurrent frontend invocations cannot receive each other's acknowledgements.
49. As a maintainer, I want late acknowledgements after timeout ignored, so that a timed-out CLI request cannot be resurrected or misreported.
50. As a plugin author, I want exact invocation errors for unknown commands, missing context, disabled plugins, unavailable runtimes, schema failures, handler failures, and timeouts, so that command behavior is diagnosable.

## Implementation Decisions

- Introduce the domain concept **Agent-facing Plugin Command**: a Plugin Command that a Trusted Plugin has explicitly opted into agent discovery and CLI invocation. Ordinary Plugin Commands remain unavailable through the CLI unless they carry this metadata.
- Extend the existing Plugin Command registration interface rather than creating a parallel plugin action registry. Agent-facing metadata is additive and includes a concise description, zero or more JSON input examples, and agent-catalog discoverability. The existing input and output schemas remain authoritative for type validation.
- Keep user-facing command-palette discoverability and agent-facing command discoverability independent. A command must first opt into agent access. Within that agent-facing set, a command hidden from agent catalog listing may still be described and invoked by its exact qualified identifier.
- Keep command identifiers plugin-qualified using the existing plugin identity plus local command identifier. CLI callers use the qualified identifier; they never select a handler by title.
- Extend command handlers with an invocation context supplied separately from plugin-owned JSON input. The context carries resolved Task and Project identity and the invocation source. Existing non-contextual handlers remain compatible by ignoring the additional context.
- Add three generic CLI operations: `plugin command list`, `plugin command describe`, and `plugin command invoke`.
- `list` returns only enabled, agent-facing, agent-discoverable Plugin Commands in the resolved scope. `describe` returns the complete agent-facing descriptor for one exact qualified identifier. `invoke` accepts optional JSON input and returns the validated command output as JSON.
- Task targeting is supplied with `--task-id`; when omitted, the CLI uses `OPENFORGE_TASK_ID` if present. Project targeting is supplied separately for commands that do not require a Task. Plugin-owned JSON input is never mutated to inject `taskId` or `projectId`.
- When Task context is present, the Rust Sidecar resolves the Task's Project and treats that result as authoritative. Conflicting explicit project context is rejected rather than silently overridden.
- Command discovery and invocation verify Plugin Installation and Project Plugin Enablement. A command belonging to a plugin that is not enabled for the resolved Project is unavailable.
- Add a host-owned Plugin Command broker at the Rust Sidecar seam. It resolves command descriptors, authorization context, owning runtime, schema metadata, and request correlation without exposing renderer or plugin-host transport details to the CLI.
- Backend Agent-facing Plugin Commands execute through the existing backend plugin host and retain its activation, schema-validation, error, and lifecycle behavior.
- Frontend Agent-facing Plugin Commands execute through a request/response bridge from the Rust Sidecar to Electron and the active trusted renderer. Each invocation has a unique correlation identifier and exactly one terminal acknowledgement.
- Frontend execution requires an active desktop app, renderer, enabled plugin frontend runtime, and registered command. It is never persisted or queued for a later app launch.
- Frontend invocation uses a bounded timeout. Timeout, renderer loss, plugin deactivation, and application shutdown complete the request with explicit failure; late acknowledgements are ignored.
- The renderer routes a frontend invocation through the existing runtime command registry so the same handler and schema-validation behavior is used by command-palette and CLI callers.
- Agent-facing descriptors must be serializable and contain no handler references. Both runtime implementations expose descriptor discovery through the broker without leaking executable functions across process seams.
- Update the canonical OpenForge skill and every generated/installed copy from that canonical source to explain Plugin Command listing, description, exact invocation, Task context defaults, JSON input, and error handling.
- Trusted Plugins do not install arbitrary `SKILL.md` files. Dynamic plugin-specific guidance comes from Agent-facing Plugin Command descriptors.
- The Task Browser plugin registers a frontend Agent-facing Plugin Command with local identifier `open`. Its qualified identifier is stable and its input schema requires exactly one HTTP(S) URL string.
- The Browser command reads Task identity from invocation context. Missing Task context is an error even if project context exists.
- The Browser command calls the frontend-only Browser Surface capability to get or create the Task's stable `main` Task Browser Surface, then navigates that surface to the supplied URL.
- The Browser command does not call OpenForge navigation, alter the Selected Project or selected Task, attach the Task Browser Surface, foreground a Task UI tab, focus a window, or otherwise change visible UI state.
- Navigation success follows the existing Task Browser Surface contract: accepted navigation may return while `loading` is true. A non-null immediate navigation error fails the command; loading alone does not.
- Before navigation, the Browser command installs a short-lived state observer associated with that invocation. The first later state that is not loading, has no navigation error, and has a valid HTTP(S) final URL is persisted as the Task's last Browser URL, then the observer disposes.
- Browser URL persistence must prevent an older invocation from overwriting state established by a newer Browser command or user navigation. Ownership/generation checks remain inside the Browser plugin implementation rather than becoming a public Browser Surface primitive.
- Background persistence has bounded cleanup for terminal errors, superseding navigation, surface destruction, plugin deactivation, or an implementation-defined expiry; it must not accumulate listeners indefinitely.
- The Browser command returns after navigation acceptance and does not wait for the persistence observer, network idle, page content, application readiness, or user authentication.
- The Browser plugin configures a stable project-scoped start-prompt contribution while it is enabled. The contribution tells agents to use the command only for browser-based work, start and verify the development server first, determine the complete URL themselves, invoke the command explicitly before finishing, and report when manual login is required.
- Browser prompt guidance must follow Project Plugin Enablement lifecycle. Disabling the Browser plugin stops future Implementation Runs from receiving its guidance; re-enabling restores it without duplicating contributions.
- Existing Plugin Browser Session behavior is unchanged. One manual login remains shared across all of the Browser plugin's Tasks and projects and survives Task Browser Surface destruction and application restart.
- No credential material, cookies, local storage, page DOM, script injection, or Electron objects are added to Plugin Command results or agent guidance.
- Record the new agent-facing Plugin Command and cross-runtime CLI broker as a documented extension of the Trusted Plugin runtime contract. Existing ADRs governing Task Browser Surface security and Plugin Browser Sessions remain authoritative.

## Testing Decisions

- The primary test surface is the installed OpenForge CLI. Tests invoke `plugin command list`, `describe`, and `invoke` and assert only JSON-visible outcomes: descriptors, schemas, examples, outputs, and stable error categories.
- CLI contract tests cover `OPENFORGE_TASK_ID` defaulting, explicit `--task-id`, explicit project scope, conflicting or missing context, JSON parsing, unsupported flags, unknown commands, hidden agent commands, and non-agent commands.
- A high-level host-broker integration test exercises CLI request through Rust Sidecar routing to fake backend and frontend runtime adapters. It verifies Project Plugin Enablement, runtime selection, request correlation, typed output, handler failure, timeout, renderer loss, and ignored late acknowledgement.
- The broker is the highest new shared seam. Transport-specific tests below it should be limited to serialization, authentication, correlation, and cleanup behavior rather than duplicating command business cases.
- Plugin SDK contract tests verify agent-facing metadata validation, serializable descriptor projection, independence from command-palette discoverability, example preservation, and backward compatibility for registrations without agent metadata.
- Runtime registry tests reuse existing Plugin Command prior art to verify that frontend and backend handlers receive separate invocation context and plugin-owned input, while existing input/output schema validation remains authoritative.
- Task Browser plugin tests use the existing Browser Surface testing fake. They verify valid navigation of the stable `main` surface, missing Task context, invalid URL rejection, immediate navigation errors, accepted loading states, and absence of OpenForge navigation calls.
- Task Browser persistence tests drive state changes through the testing fake and verify that the first successful settled final URL is saved, immediate command completion does not await settlement, failed states are not saved, observers dispose, and stale/superseded invocations cannot overwrite newer navigation.
- Start-prompt contribution tests verify stable contribution identity, exact project scope, enable/disable lifecycle, no duplication, concise browser-only instructions, dev-server verification responsibility, and manual-login wording.
- Skill generation/installation tests follow existing CLI installer prior art and verify that the canonical OpenForge skill documents generic Plugin Command discovery and invocation without embedding Browser-plugin-specific implementation details.
- Tests assert external behavior and stable contracts, not private maps, event ordering beyond the request/response guarantee, process-specific helper names, renderer layout, Tailwind classes, Electron view objects, or internal transport messages.
- Focused TypeScript, CLI, and Rust tests run during implementation. Full TypeScript checking, relevant Vitest suites, OpenForge CLI tests, and Backend Crate tests run before completion.
- A manual Electron smoke check enables the Browser plugin for a Project, starts an Implementation Run, invokes the Browser command from its Agent Session, confirms the visible OpenForge UI does not navigate or steal focus, later opens the Task's Browser tab, verifies the requested final URL, restarts OpenForge, and verifies the URL and authenticated Plugin Browser Session restore.

## Out of Scope

- Automatic command invocation when an Agent Session ends or an Implementation Run completes.
- Detecting whether a Task is browser-based.
- Starting, stopping, supervising, or discovering development servers.
- Inferring ports, routes, package scripts, framework conventions, or the correct URL.
- Waiting for network idle, inspecting page content, asserting application behavior, or determining whether a feature is correct.
- Navigating OpenForge UI, selecting or foregrounding a Project or Task, switching to the Browser tab, attaching a Task Browser Surface, focusing OpenForge, or raising its window.
- Browser automation through browser-use, Playwright, Puppeteer, Chrome DevTools MCP, or any other automation client.
- Chrome DevTools Protocol gateways, remote-debugging ports, DevTools target discovery, DOM inspection, script injection, console/network inspection, or packaged-build DevTools.
- Automatic login, credential storage, credential export, cookie export, session-token exposure, form filling, OAuth automation, or bypassing multi-factor authentication.
- New per-Task or per-Project browser authentication profiles; the existing plugin-scoped Plugin Browser Session remains authoritative.
- Arbitrary plugin-provided skill files, prompt-template packages, provider-specific skills, or a core skill-editing capability.
- Automatically exposing existing Plugin Commands to agents without explicit agent metadata.
- Queuing frontend commands while OpenForge is closed or replaying them after renderer restart.
- Adding plugin-specific top-level CLI syntax such as `openforge browser open`; plugins use the generic Plugin Command interface.
- Changing Task Link routing, external-browser fallback, Browser Surface security policy, permission handling, popup behavior, downloads, capture artifacts, or visual feedback selection.

## Further Notes

- The current Browser plugin already has the essential deep module for navigation: Task Browser Surfaces are host-owned, Task-scoped presentations, while the Plugin Browser Session supplies durable shared authentication. This feature adds an agent-facing command seam rather than weakening that browser interface.
- A global Electron remote-debugging port was considered during discovery and deliberately excluded. It could expose unrelated Electron targets and privileged OpenForge renderer state, conflicting with the accepted Task Browser Surface security model.
- The CLI broker should remain generic: Browser behavior belongs to the Browser plugin's Plugin-owned Domain, while OpenForge core owns command qualification, Task/Project context, enablement, runtime routing, acknowledgement, and errors.
- The Task Browser command is a handoff convenience, not proof of successful testing. Agents remain responsible for running appropriate verification before invoking it and accurately reporting remaining failures.
