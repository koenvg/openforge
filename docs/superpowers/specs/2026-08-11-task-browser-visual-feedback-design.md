# Implement task-scoped visual feedback in Task Browser

## Problem Statement

While testing an application inside a Task's Browser tab, the tester cannot capture the exact visible state, identify a specific region, and send contextual visual feedback to the Task's Agent Session. The tester must currently describe the page and affected area manually, which loses visual context and makes feedback slower and less precise.

The Task Browser Surface is Electron-owned and intentionally isolated from Trusted Plugin renderer code. Its current SDK contract supports lifecycle and navigation but not viewport capture. Plugin task storage accepts JSON values but not binary artifacts, and the plugin-facing Tasks API cannot submit or queue follow-up feedback to an Agent Session. The feature therefore needs narrow host and SDK capabilities while keeping its product-specific workflow inside the Task Browser plugin.

## Solution

Add a Codex-style visual feedback workflow to the existing Task Browser tab. The tester explicitly captures the visible browser viewport, creating an immutable PNG backed by OpenForge-managed task artifact storage. The live page is replaced temporarily by a frozen screenshot editor. The tester can drag a rectangular region or click to place a point pin; either action opens a compact comment composer anchored to the selected area. Enter saves the annotation and Escape cancels it.

A Task may have one active visual feedback draft containing multiple screenshots and multiple numbered annotations per screenshot. Drafts are auto-saved and restored across tab changes, Task changes, and app restarts. The Browser toolbar exposes the draft count and actions to review, discard, or send the complete session.

Sending submits the review immediately without a prompt-preview or confirmation step. OpenForge generates a concise Markdown report containing every comment, screenshot artifact path, page URL, title, timestamp, and viewport dimensions, then submits it as one follow-up message to the Task's Agent Session. If the Agent is busy, the message is queued as its next follow-up. If no Agent Session exists or delivery fails, the unchanged draft remains available for retry. Successful submission clears the active editor while retaining the submitted artifacts until Task completion. Completion cleanup removes visual feedback artifacts as runtime state.

## User Stories

1. As a tester, I want to capture the page visible in the Task Browser, so that the Agent sees the exact application state I tested.
2. As a tester, I want capture to live inside the existing Browser tab, so that feedback is automatically associated with the correct Task.
3. As a tester, I want an explicit Capture feedback action, so that screenshots are never taken unexpectedly.
4. As a tester, I want the capture to contain only the visible viewport, so that it represents exactly what I was looking at.
5. As a tester, I want the screenshot to freeze after capture, so that navigation or application updates cannot move the content beneath my annotations.
6. As a tester, I want to drag over a region of the screenshot, so that I can identify an area rather than describing its location in prose.
7. As a tester, I want to click a point on the screenshot, so that I can comment on small targets without drawing an unnecessarily large box.
8. As a tester, I want an inline comment composer anchored to my selection, so that the relationship between the comment and selected area remains obvious.
9. As a tester, I want Enter to save an annotation, so that repeated feedback entry is fast.
10. As a tester, I want Escape to cancel an unfinished annotation, so that accidental selections are easy to abandon.
11. As a tester, I want every saved annotation to require non-empty comment text, so that the Agent never receives unexplained markers.
12. As a tester, I want annotations numbered automatically, so that screenshot markers and report comments can be matched unambiguously.
13. As a tester, I want several annotations on one screenshot, so that related issues in one application state do not require duplicate captures.
14. As a tester, I want several screenshots in one review session, so that I can test multiple states or pages before contacting the Agent.
15. As a tester, I want to return from the screenshot editor to the live Browser Surface, so that I can continue testing and capture another state.
16. As a tester, I want the Browser toolbar to show the current screenshot and annotation counts, so that I know feedback is waiting to be sent.
17. As a tester, I want to reopen the current draft, so that I can review accumulated feedback before submission.
18. As a tester, I want to edit saved comment text, so that I can correct or clarify feedback before sending it.
19. As a tester, I want to move or resize a selected region, so that an imprecise annotation can be corrected without recreating it.
20. As a tester, I want to delete an individual annotation, so that obsolete feedback is not sent.
21. As a tester, I want to delete an individual screenshot and its annotations, so that an invalid capture can be removed from the session.
22. As a tester, I want one-step undo for my latest annotation action, so that minor mistakes are inexpensive to recover from.
23. As a tester, I want to discard the entire draft deliberately, so that I can restart a review session when its context is no longer useful.
24. As a tester, I want unfinished feedback to auto-save, so that navigating away from the Browser tab does not lose my work.
25. As a tester, I want each Task to restore only its own draft, so that feedback from different Tasks is never mixed.
26. As a tester, I want drafts restored after restarting OpenForge, so that an application restart does not destroy an unfinished review.
27. As a tester, I want each capture to record its page URL and title, so that the Agent knows which application location produced the screenshot.
28. As a tester, I want each capture to record its timestamp and viewport dimensions, so that the Agent can interpret the tested state accurately.
29. As a tester, I want Send to agent to submit all accumulated screenshots and comments together, so that the Agent receives one coherent review request.
30. As a tester, I want submission to happen immediately after activating Send to agent, so that there is no redundant prompt-preview or confirmation step.
31. As a tester, I want visual feedback to be collectable while the Agent is running or paused, so that testing is not blocked by Agent state.
32. As a tester, I want feedback sent during active Agent work to become the next queued follow-up, so that it is delivered without interrupting capture.
33. As a tester, I want a clear explanation when no Agent Session exists, so that I understand why the draft cannot yet be sent.
34. As a tester, I want the draft retained when no Agent Session exists, so that I can start or resume an Agent and retry later.
35. As a tester, I want a specific retryable error when delivery fails, so that transient failures do not require recreating feedback.
36. As a tester, I want submission controls disabled while a send is in flight, so that accidental double delivery is prevented.
37. As a tester, I want a successful-delivery acknowledgement, so that I know the Agent received or queued the review.
38. As a tester, I want successful submission to clear the active review session, so that my next capture starts a fresh review.
39. As a tester, I want previously submitted image artifacts retained while the Task remains active, so that the Agent can read them throughout implementation.
40. As a tester, I want visual feedback artifacts removed when the Task is completed, so that transient screenshots do not accumulate indefinitely.
41. As a tester, I want deleting a draft screenshot to remove its backing artifact, so that abandoned captures do not consume storage.
42. As a tester, I want screenshot files stored outside the Git worktree, so that collecting feedback never dirties the repository.
43. As an Agent, I want an absolute readable path for every screenshot, so that I can inspect the captured pixels with local tools.
44. As an Agent, I want a Markdown manifest mapping numbered annotations to comments and screenshot paths, so that visual findings are straightforward to process.
45. As an Agent, I want all findings delivered in their original capture order, so that the tester's review sequence remains understandable.
46. As a plugin author, I want Browser Surface capture to enforce the same plugin, Task, window, and generation ownership as navigation, so that one plugin cannot capture another surface.
47. As a plugin author, I want capture failures represented through the SDK's named Browser Surface errors, so that the plugin can provide actionable feedback.
48. As a plugin author, I want task-scoped binary artifacts managed by the host, so that plugins do not need unrestricted filesystem access.
49. As a plugin author, I want a supported Agent follow-up API, so that plugins do not call raw Electron, preload, sidecar, PTY, or provider transports.
50. As an OpenForge user, I want Browser login state to remain plugin-scoped and unaffected by screenshot capture, so that the feedback feature does not change existing authentication behavior.
51. As a keyboard user, I want every toolbar and editor action to have an accessible name and visible focus state, so that the workflow remains operable without guessing.
52. As a keyboard user, I want predictable focus placement when entering and leaving annotation mode, so that capture does not strand focus behind the frozen editor.
53. As a screen-reader user, I want capture, save, failure, and delivery states announced, so that important state changes are not communicated visually alone.
54. As a user of either OpenForge theme, I want selection markers and text to remain legible, so that the workflow works in light and dark themes.

## Implementation Decisions

- Product-specific capture, annotation, draft, and review-session behavior belongs to the built-in Task Browser Trusted Plugin. Core Task detail and review UI will not own parallel visual-feedback state.
- The plugin cannot implement capture by reading the embedded page. The Task Browser Surface is a native Electron-owned surface, not renderer DOM. Extend the Browser Surfaces SDK capability and its host contract with an authorized visible-viewport capture operation.
- Browser capture will use the native surface's page-capture facility and capture only the currently visible viewport. It will not capture a full scrollable page.
- A capture operation will create an immutable PNG in host-managed, task-scoped artifact storage and return a serializable artifact reference with the image dimensions and capture context needed by the plugin. Large image bytes will not be stored in JSON plugin storage.
- Add a narrow SDK artifact capability sufficient to load a task-owned capture for renderer display, resolve an Agent-readable absolute local path, and delete an artifact. The host will validate plugin and Task ownership on every operation and prevent path traversal or arbitrary filesystem access.
- OpenForge-managed artifact storage will live outside the project Git worktree. Artifact identifiers and metadata may be saved in plugin Task storage; image bytes may not.
- Task artifact cleanup is part of Task runtime lifecycle ownership. Completion and permanent Task deletion remove all visual-feedback captures. Removing an unsent screenshot or discarding a draft also deletes the corresponding unreferenced artifacts.
- Extend the plugin-facing task or Agent Session SDK with a supported follow-up submission operation. It will accept a Task identity and text message, route through OpenForge's existing provider/session lifecycle, queue behind an active Agent turn, acknowledge accepted delivery, and report the absence of an Agent Session as a typed failure.
- The Task Browser plugin will use only typed SDK wrappers. It will not call raw Electron, preload IPC, sidecar commands, HTTP bridge endpoints, PTY input, or provider-specific transports.
- The Browser Surfaces and Agent follow-up capability declarations, public types, runtime validation, testing fakes, and package metadata will evolve together so external Trusted Plugins receive one coherent contract.
- Existing Browser Surface authorization remains authoritative. Capture must reject stale, destroyed, cross-window, cross-plugin, cross-Task, and superseded-generation references in the same way as existing lifecycle operations.
- ADR 0012 remains unchanged: Browser Surfaces stay Task-scoped while cookies and identity remain shared through one Plugin Browser Session. Capturing, deleting captures, completing a Task, or discarding feedback must not reset or purge the Plugin Browser Session.
- The active visual feedback draft is Task-scoped. It contains ordered captures, ordered annotations, artifact references, and current editing metadata. Replacing a Svelte Task object with the same logical Task identity must not tear down or discard the draft.
- Annotation geometry will be stored as normalized coordinates relative to the immutable screenshot dimensions. Resizing the OpenForge window or reopening a draft therefore preserves marker alignment.
- Each annotation has one shape: rectangular region or point pin. It has an automatically assigned display number and non-empty comment. Freehand strokes and DOM element selectors are not represented in the model.
- Capturing transitions the Browser tab from the live native surface to a frozen screenshot editor. The native surface is detached or visually hidden through its existing lifecycle rather than destroyed, preserving navigation and authenticated page state when the tester returns.
- Dragging beyond a small movement threshold creates a rectangular selection. A click without a drag creates a point pin. Completing either gesture opens an anchored comment composer immediately.
- Enter saves a non-empty comment. Escape cancels the pending annotation. Multiline entry must retain an explicit keyboard affordance that does not conflict with the save shortcut.
- Saved annotations can be selected, edited, moved, resized, or deleted. The editor supports one-step undo for the most recent annotation mutation, not an unbounded history stack.
- The Browser toolbar gains Capture feedback while a live surface is available. When a draft exists it also shows screenshot and annotation counts and exposes Review, Send to agent, and discard entry points without overloading the primary navigation.
- Draft changes are auto-saved after meaningful mutations. Persistence failures are surfaced without discarding the in-memory draft. Restoring a draft validates every referenced artifact and handles missing files as recoverable capture-level errors rather than crashing the Browser tab.
- Each capture records the settled Browser Surface URL and title at capture time, capture timestamp, viewport dimensions, PNG artifact identity, and annotations. Capture is permitted regardless of whether the page is loading because the screenshot represents the actual pixels visible at the tester's chosen moment.
- Sending generates one deterministic Markdown report in capture order. It contains the Task context, absolute PNG paths, URL, title, timestamp, viewport dimensions, and a numbered list mapping every marker to its comment. No DOM selector is generated.
- Send to agent has no prompt-preview modal and no additional confirmation. It immediately submits the generated report for the entire active draft.
- While submission is pending, duplicate submission is disabled and progress is visible. An acknowledged submission moves the draft to submitted runtime artifacts and starts a fresh active draft. A rejected or failed submission leaves the original draft and artifacts unchanged for retry.
- If no Agent Session exists, the plugin explains that feedback cannot yet be sent and keeps the complete draft. The feature does not implicitly start an Agent.
- Sent image artifacts remain available while the Task is active because the Agent may inspect them later in the same implementation session. They are transient runtime state, not Completed Task reference data, and are removed by completion cleanup.
- The annotation editor follows existing Svelte 5 rune conventions and keeps browser-session lifecycle truth in the existing session owner. Component-local state mirrors the workflow model rather than creating competing surface lifecycle state.
- The UI uses daisyUI semantic classes, Tailwind utilities, and the existing Lucide icon language. It supports both existing themes and introduces no hardcoded component colors or new font system.
- Selection regions must remain distinguishable through outline, marker number, and accessible text rather than color alone. Interactive controls have visible semantic focus rings, accessible names, disabled/loading semantics, and screen-reader announcements for errors and successful delivery.
- Pointer capture and annotation motion must not block Escape/cancel behavior. Animation, if any, is limited to short opacity/transform transitions and respects reduced-motion preferences.
- Capture, persistence, and submission errors are separate user-visible states with recovery actions. A failure in one area must not silently destroy browser navigation state or unrelated captures.

## Testing Decisions

- Use test-driven development. Add focused failing tests for capture, annotation, persistence, and submission behavior before implementation where practical.
- The primary seam is the Task Browser feedback workflow rendered with a mocked Frontend OpenForge API and Browser Surface host. These tests exercise user-visible behavior at the highest existing seam without launching Electron.
- Primary workflow tests cover entering capture mode, rendering a frozen viewport, rectangle and point annotations, the anchored composer, Enter/save, Escape/cancel, required comment text, automatic numbering, multiple annotations, multiple screenshots, edit/move/resize/delete, one-step undo, and draft discard.
- Primary workflow tests cover Task switching, tab detach/remount, app-style remount, draft restoration, missing-artifact recovery, and isolation between two Task identities.
- Primary workflow tests cover immediate whole-session submission, deterministic report ordering, inclusion of artifact paths and capture metadata, busy-Agent queue acknowledgement, no-session behavior, delivery failure, retry, double-submit prevention, successful draft clearing, and post-send artifact retention.
- Tests assert semantic controls, accessible names, focus transitions, and announced status/errors. They do not assert Tailwind utilities, daisyUI classes, exact marker colors, pixel spacing, or other visual styling.
- The existing Task Browser tab lifecycle tests are prior art for stale asynchronous results, switching logical Tasks, cleanup failure containment, and retry states. Extend that style rather than bypassing the session owner.
- The existing Browser Surface renderer-host contract tests are prior art for serialization, authorization failures, stale generations, attachment lifecycle, and unavailable Electron handling. Extend this seam with viewport capture and artifact references.
- A thin Electron adapter contract test verifies that capture targets the authorized live page, returns PNG content with correct viewport dimensions, captures only the visible area, and reports native failures without weakening browser security preferences.
- Host artifact service tests verify plugin/Task ownership, immutable capture identifiers, safe path resolution, binary loading, explicit deletion, idempotent cleanup, path traversal rejection, cleanup on completion/deletion, and isolation from Plugin Browser Session data.
- Agent follow-up SDK contract tests verify idle delivery, queueing behind a running or paused turn, acknowledgement semantics, no-session typed failure, provider failure propagation, and prevention of cross-Task submission.
- Public SDK contract and testing-fake tests verify that capability declarations, frontend types, mock call recording, serialization, and runtime exposure evolve together.
- Persistence tests use real serialized JSON draft values and temporary artifact directories where useful, but do not depend on production filesystem locations.
- Add a focused Electron smoke check after automated tests: open a real Task Browser Surface, capture a visible viewport, create rectangle and point comments, navigate and capture again, send to an available Agent Session, verify the Agent can read every reported PNG path, and verify runtime cleanup removes captures without clearing Browser login state.
- Run the relevant plugin tests, plugin SDK tests, Electron Browser Surface tests, TypeScript type checking, and the repository's focused frontend test commands. Broader suites are warranted if shared task/session or completion lifecycle contracts change.

## Out of Scope

- Capturing pages from external Chrome, Safari, Firefox, or other non-OpenForge browsers.
- Full-page or scrolling screenshots.
- Video, animated capture, DOM snapshots, network traces, or console-log capture.
- Freehand drawing, arrows, text drawn directly onto the image, or advanced image editing.
- Screenshot redaction, blurring, masking, or automatic sensitive-data detection.
- DOM element selectors, CSS selectors, accessibility-tree references, or element replay.
- Human discussion threads, reviewer assignment, resolution states, or collaborative annotation.
- Sending each annotation immediately; submission sends the complete active review session.
- Prompt preview, prompt editing, or an additional confirmation step before sending.
- First-class image inputs in provider-specific messaging protocols. The Agent receives local artifact paths in a text follow-up.
- Automatically starting an Agent when no Agent Session exists.
- Persisting visual-feedback images as long-term Completed Task reference data.
- Writing screenshots or reports into the project Git worktree.
- Changing Plugin Browser Session cookie, authentication, permission, popup, or download policies.
- A general-purpose image editor or generic issue-tracking attachment system.

## Further Notes

- The UI reference is the Codex screenshot-comment interaction supplied during requirements discovery: a blue selected region with a compact comment field visually anchored near the selection. OpenForge should reproduce the interaction model, not copy unrelated Codex styling.
- The generated design-system search suggested a developer-tool treatment, but OpenForge's established semantic theme, typography, and component language remain authoritative. Do not introduce dark-only behavior, hardcoded palette values, glows, or new web fonts.
- Captures may contain credentials, customer data, or private development content. Redaction is explicitly out of scope, so capture remains an intentional user action and artifacts remain local, Task-scoped, access-controlled, and short-lived.
- The implementation should keep SDK additions deep and narrow: host security, binary lifecycle, and Agent routing belong behind SDK contracts; screenshot-editor concepts do not.
- The approved testing seams are one high-level Task Browser workflow seam plus thin native and host boundary contracts where pixel capture, artifact ownership, and Agent routing cannot be proven in renderer tests.
