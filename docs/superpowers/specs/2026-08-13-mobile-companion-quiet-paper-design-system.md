# Mobile Companion Quiet Paper Design System — Design

Status: selected for implementation.

## Problem Statement

OpenForge Companion has a complete, functional Flutter surface for secure pairing, the Mobile Project Board, prompt-only Task creation, Task detail, plugin Task sections, and the interactive Agent terminal, but its presentation still relies primarily on Flutter's default seeded Material theme and screen-local composition choices. The result communicates function without expressing a deliberate OpenForge mobile identity, and future screens can drift because there is no durable design-system contract for color, typography, spacing, shape, elevation, status treatment, or responsive composition.

Users need the Companion app to make dense developer workflows feel calm, legible, and trustworthy on a phone. They must be able to scan Project and Task state quickly, distinguish informational, attention, success, and destructive actions without relying on color alone, enter prompts without visual noise, read Handoff Notes comfortably, and interact with a terminal that still feels integrated with the rest of the app. The design must remain recognizably OpenForge while preserving the existing security, authority, lifecycle, accessibility, and platform-adaptive behavior established by the accepted Companion specifications and ADRs.

## Solution

Adopt **Quiet Paper** as the durable visual design system for OpenForge Companion and as the default guideline for all current and future mobile surfaces.

Quiet Paper is a light-first, calm editorial productivity system. It uses warm ivory app backgrounds, clean white content surfaces, dark ink typography, restrained cobalt primary actions, soft semantic status washes, generous whitespace, hairline borders, minimal elevation, humanist typography, and monospace only where developer information benefits from fixed-width alignment. It reduces the perceived complexity of remote developer workflows without hiding domain state or weakening action hierarchy.

The design system will be centralized at the Flutter application shell and expressed through semantic tokens and component themes rather than screen-local color or shape values. Existing screens will be brought into the system without changing their product behavior or backend contracts. System dark mode remains supported through a paired dark token set that preserves Quiet Paper's quiet, editorial character rather than switching to a separate visual concept. The Agent terminal retains an appropriately dark terminal canvas in both modes while its surrounding Task shell and controls follow the active Quiet Paper theme.

The selected concept board is the visual reference for intent, information hierarchy, density, and tone. It is not a pixel-exact implementation contract: platform rendering, dynamic text, compact widths, safe areas, and accessibility requirements take precedence over literal screenshot measurements.

## User Stories

1. As a Companion user, I want the app to have one coherent visual identity, so that every screen feels like part of the same trusted product.
2. As a Companion user, I want the interface to feel calm and uncluttered, so that I can make decisions about Tasks away from my desktop without unnecessary cognitive load.
3. As a Companion user, I want primary actions to use a consistent cobalt treatment, so that I can identify the next action quickly.
4. As a Companion user, I want secondary and tertiary actions to be visually subordinate, so that action priority is unambiguous.
5. As a Companion user, I want destructive actions to be clearly separated and named, so that I do not mistake Delete or Complete for routine navigation.
6. As a Companion user, I want warm, low-noise backgrounds and crisp content surfaces, so that dense Project and Task information remains comfortable to scan.
7. As a Companion user, I want strong dark-ink text contrast, so that body copy and metadata remain readable in varied lighting.
8. As a Companion user, I want status colors paired with text or icons, so that meaning does not depend on color perception alone.
9. As a Companion user, I want consistent spacing and alignment, so that I can predict where identity, status, metadata, and actions appear.
10. As a Companion user, I want cards to use subtle boundaries rather than heavy shadows, so that hierarchy is clear without making the app feel visually busy.
11. As a Companion user, I want the app to respect my system light or dark appearance, so that it remains comfortable throughout the day.
12. As a Companion user, I want dark mode to preserve the same information hierarchy and brand character, so that changing system appearance does not feel like switching products.
13. As a Companion user with low vision, I want text and controls to meet accessible contrast targets, so that I can use the app reliably.
14. As a Companion user who enlarges text, I want layouts to reflow rather than truncate important domain information, so that Dynamic Type does not hide meaning or actions.
15. As a screen-reader user, I want the existing semantic labels, roles, states, and reading order preserved, so that the visual redesign does not reduce accessibility.
16. As a user with reduced motion enabled, I want nonessential motion removed and state changes to remain understandable, so that the app does not cause discomfort.
17. As a touch user, I want every interactive target to remain at least 48 logical pixels with adequate separation, so that actions are easy to activate accurately.
18. As an iOS or Android user, I want controls and navigation to retain familiar platform behavior, so that the branded design does not fight system conventions.
19. As a user on a small phone, I want content to fit without horizontal scrolling, so that every core action remains reachable.
20. As a user in landscape or on a tablet, I want readable content widths and adaptive gutters, so that the interface does not become stretched or sparse.
21. As an unpaired user, I want pairing to present one clear secure action and one manual alternative, so that onboarding is focused and understandable.
22. As an unpaired user, I want the pairing screen to explain the pinned encrypted connection visually and textually, so that I understand the trust boundary.
23. As a user waiting for desktop approval, I want progress and authority copy to remain prominent and readable, so that I understand why I cannot continue yet.
24. As a user facing revocation, certificate mismatch, incompatible versions, unavailable desktop, or denied local-network access, I want each recovery state to use the same clear visual system and a distinct recovery action, so that I know what to do next.
25. As a Mobile Project Board user, I want the Selected Project to remain visually prominent without competing with Task content, so that I always know the Board's scope.
26. As a Mobile Project Board user, I want Focus, In Flight, Out of Focus, and Backlog to use consistent tab treatment and visible counts, so that Board navigation is predictable.
27. As a Mobile Project Board user, I want the selected lane to use a clear cobalt indicator, so that location is visible without a heavy segmented control.
28. As a Mobile Project Board user, I want Task cards to prioritize title, Task ID, state/reason, dependencies, and recent activity in that order, so that I can scan the Board quickly.
29. As a Mobile Project Board user, I want Backlog labels and dependency metadata to wrap or collapse gracefully, so that variable Task data does not break card layout.
30. As a Mobile Project Board user, I want empty, loading, stale, and refresh-error states to feel native to the same design system, so that recovery does not look like an afterthought.
31. As a Mobile Project Board user, I want the New Task action to stay easy to find without obscuring the last Task card, so that creation remains available and content remains readable.
32. As a user creating a Task, I want the composer to use a focused bottom sheet with one visible prompt label, so that I understand exactly what information is required.
33. As a user creating a Task, I want the Selected Project and Backlog destination stated clearly, so that I understand where the Task will be created.
34. As a user creating a Task, I want pending, failure, uncertain-outcome, and success feedback to retain the same action hierarchy, so that I do not submit duplicate Tasks.
35. As a Task-detail user, I want the Task title, Task ID, Board Status, Project, Agent state, and update time to form a clear summary, so that I can understand current state at a glance.
36. As a Task-detail user, I want Handoff Notes to use editorial typography and comfortable line length, so that longer summaries remain readable on a phone.
37. As a Task-detail user, I want missing Handoff Notes and safe Agent errors to have purposeful contained states, so that absent or failed data does not look broken.
38. As a Task-detail user, I want dependencies and related Tasks to remain visibly interactive, so that I can navigate without confusing metadata for plain text.
39. As a Task-detail user, I want Details and Terminal tabs to preserve state when switching, so that the visual redesign does not disrupt my workflow.
40. As a Task-detail user, I want Start, Delete, and Complete to retain their existing availability, confirmation, and pending semantics, so that a visual change cannot alter lifecycle safety.
41. As a plugin user, I want inline plugin Task sections to inherit compatible Quiet Paper semantic tokens, so that embedded contributions feel integrated with native Task detail.
42. As a plugin user, I want a plugin loading, error, incompatible, or expanded state to remain contained, so that optional UI cannot overwhelm native Task content.
43. As a GitHub Sync user, I want Pull Request identity, checks, reviews, and readiness to use the same typography and semantic statuses, so that plugin information is as scannable as native information.
44. As a plugin author, I want semantic host tokens rather than mobile-specific hardcoded colors, so that my existing Task section can adapt to light and dark Companion themes.
45. As a terminal user, I want the terminal canvas to retain high-contrast monospace text, so that code and Agent output remain legible.
46. As a terminal user, I want the terminal to feel visually embedded in the Quiet Paper Task shell, so that switching tabs preserves product continuity.
47. As a terminal user, I want connection, Live, reconnecting, unavailable, and exited states to use consistent semantic treatments and labels, so that transport state is obvious.
48. As a terminal user, I want Esc, one-shot Ctrl, Tab, and arrow keys to remain distinct touch-safe controls, so that terminal interaction remains practical on mobile.
49. As a terminal user, I want the keyboard accessory row to remain visible above the safe area and software keyboard, so that controls are not obscured.
50. As a terminal user, I want the light and dark ANSI palettes to preserve standard terminal color distinctions, so that terminal applications remain understandable.
51. As an OpenForge designer, I want a documented semantic token system, so that I can extend the mobile app without inventing a new palette for each feature.
52. As an OpenForge developer, I want component defaults centralized in the application theme, so that new screens inherit Quiet Paper automatically.
53. As an OpenForge developer, I want exceptions to use named semantic extensions rather than raw color literals, so that intent remains reviewable.
54. As an OpenForge maintainer, I want business behavior and visual styling kept separate, so that future theme work does not destabilize Task, pairing, terminal, or networking logic.
55. As an OpenForge reviewer, I want the concept board and this specification to define the selected direction, so that implementation review has a shared visual reference.
56. As an OpenForge reviewer, I want physical-device screenshots in light and dark mode, so that I can judge real typography, safe areas, keyboard interaction, and platform rendering.
57. As a future mobile-feature author, I want Quiet Paper to be the default guideline for all new Companion screens, so that design consistency persists beyond the initial migration.

## Implementation Decisions

### Design-system ownership

- The Companion application shell owns the native design system and constructs both light and dark `ThemeData` from one semantic token source.
- The semantic source distinguishes background, surface, elevated surface, surface variant, primary, on-primary, text, secondary text, outline, focus, success, warning, destructive, and terminal roles. Screen code consumes theme roles and named extensions instead of raw color literals.
- Component themes define the default presentation for app bars, cards, dialogs, modal bottom sheets, filled/outlined/text buttons, floating actions, tabs, chips, input fields, dividers, snackbars, progress indicators, and icon buttons.
- Feature modules retain ownership of domain composition and interaction. The theme layer must not acquire Task, Project, Agent, pairing, plugin, terminal, or network state.
- Future Companion surfaces inherit the central design system by default. A feature-specific visual deviation requires a named semantic role or documented page-level exception; it must not introduce an unrelated local palette.

### Quiet Paper light palette

- The light appearance uses warm ivory as the app background, white for primary content surfaces, and a very pale cool gray-blue for secondary or inset surfaces.
- Primary text is deep ink/navy rather than pure black. Secondary text is muted slate with at least 4.5:1 contrast for normal body text; tertiary metadata may use the 3:1 large-text/non-text threshold only where WCAG permits.
- Cobalt is reserved for primary actions, selected navigation indicators, links, focus, and high-value informational emphasis. It is not used as a decorative page wash.
- Success uses sage/green, attention uses amber, destructive states use muted coral/red, and neutral In Flight/informational states use pale blue. Every semantic color is paired with text, an icon, a shape, or another non-color cue.
- Initial implementation targets are warm ivory near `#F7F6F2`, surface white, deep ink near `#172033`, slate near `#566176`, cobalt near `#1457D9`, outline near `#D7DCE5`, success near `#257A4B`, warning near `#9A5A00`, and destructive near `#B42332`. Implementers may make small adjustments to satisfy device rendering and contrast while preserving these roles and the selected visual character.

### Quiet Paper dark palette

- System dark mode remains supported. It uses ink-blue backgrounds, slightly lighter layered surfaces, soft-white text, cool slate secondary text, and a lighter cobalt/periwinkle action tone selected for accessible contrast.
- Dark mode is a tonal translation of Quiet Paper, not Aurora Signal or a glassmorphism theme. It avoids decorative glows, strong transparency, and colorful background gradients.
- Borders, disabled states, focus, semantic statuses, modal scrims, and terminal controls are independently tuned for dark contrast; they are not mechanically inverted from light values.
- Theme changes propagate to native screens, terminal palettes, and embedded plugin Task sections without re-pairing or resetting navigation/domain state.

### Typography

- Use a friendly, modern humanist sans for display, title, body, label, and action text. Prefer a bundled or platform-reliable family with predictable Android and iOS metrics; do not depend on a network font request.
- Use one clean monospace family for Task IDs, terminal content, numeric counters where alignment matters, and developer-specific identifiers. Body copy, button labels, tabs, status labels, and Handoff Notes remain sans-serif.
- The base mobile body size is 16 logical pixels with approximately 1.5 line height. Supporting labels use 12–14 logical pixels only when contrast and scaling remain sufficient. Major screen titles use a restrained 22–28 logical pixel range rather than oversized marketing typography.
- Type hierarchy is reinforced by size, weight, spacing, and placement rather than color alone. Headings use 600–700 weight, action and label text use medium weight, and body text uses regular weight.
- Dynamic text scaling must preserve full Task titles, recovery messages, button labels, and destructive confirmation copy through wrapping or reflow. Fixed-height text containers must not clip scaled text.

### Spacing, shape, and elevation

- Use a 4-point base and 8-point primary spacing rhythm. Standard phone gutters are 16 logical pixels, compact internal gaps are 8–12, card padding is 16, and section separation is 24–32.
- Primary content cards use 16–20 logical pixel radii, a visible hairline outline, and little or no shadow. Nested cards avoid stacking multiple shadows; hierarchy comes primarily from whitespace and surface tone.
- Inputs, buttons, status containers, and sheets use a consistent smaller-to-medium radius scale. Full pill shapes are limited to compact statuses and must not become the default shape for every control.
- App bars remain low elevation with a quiet divider or surface transition. Modal sheets use a visible drag handle, strong foreground/background separation, and a 40–60% accessible scrim.
- Hairline dividers group key-value metadata and sections but do not replace whitespace. Random per-screen padding, shadow, and radius values are not permitted.

### Icons and imagery

- Use one Material-compatible vector icon family with consistent outline/fill behavior and optical size. Do not use emojis as navigation, status, or action icons.
- Icon-only controls retain descriptive accessibility labels and at least 48-by-48 logical pixel hit areas even when the visible glyph is smaller.
- Pairing may use a restrained line illustration of the trusted desktop/phone relationship and a large scan frame. Decorative illustration does not appear on data-dense Board, Task, or terminal surfaces.
- Official external brand marks, such as GitHub, are used only from approved assets and remain visually subordinate to OpenForge Task information.

### Navigation and app bars

- Existing navigation and back-stack behavior remains unchanged. The selected Project remains the title-level scope on the Mobile Project Board; Task detail keeps predictable back behavior.
- Top bars use a clean surface, dark ink title, low elevation, consistent back/refresh/overflow icon placement, and visible safe-area spacing.
- Focus, In Flight, Out of Focus, and Backlog retain their canonical names and counts. The active Board lane uses a cobalt underline/indicator and text emphasis; inactive tabs remain readable without competing with content.
- Details and Terminal retain their current Task-detail tab relationship. Tabs are navigation, not status chips, and must use the same placement and selected-state treatment throughout the app.

### Pairing and connection states

- The unpaired surface uses one dominant heading, one concise authority/trust explanation, a large QR-scanning affordance, a filled Scan pairing code action, and an outlined Enter code manually alternative.
- Restoring, Pairing, Awaiting Approval, Pairing Rejected, Pairing Unavailable, Connected, Reconnecting, Desktop Unavailable, Local Network Permission Denied, Revoked, Certificate Mismatch, and Incompatible Protocol remain distinct product states with their existing safe copy and recovery actions.
- State layouts use a shared contained-message pattern with an icon, title, body, and up to one primary plus one secondary recovery action. Error color does not replace explanatory text.
- Security-critical Certificate Mismatch and Revoked states receive stronger destructive emphasis than ordinary connectivity failures while retaining calm, non-alarmist wording.

### Mobile Project Board

- The Board prioritizes the Selected Project and lane navigation before Task content. Refresh and overflow remain top-bar actions; New Task remains an extended floating action that does not cover list content.
- Task cards prioritize Task ID and state/reason metadata, then the full display title, then dependencies, labels where applicable, and recent activity. Important state is visible without opening Task detail.
- Cards use white surfaces, hairline borders, restrained status washes, and sufficient vertical separation. Dense metadata wraps within the card; the Board never adds horizontal scrolling.
- Focus, In Flight, Out of Focus, and Backlog can vary the metadata shown according to existing product behavior, but not their overall component language.
- Pull-to-refresh, loading, no-Project, empty-lane, stale snapshot, and refresh-error states use shared Quiet Paper feedback primitives and preserve the existing recovery behavior.

### Task creation

- Task creation remains a safe-area-aware modal bottom sheet with a drag handle, clear title, visible Project context, visible prompt label, multiline prompt field, supporting Backlog copy, character count, Cancel, and one filled Create Task action.
- The prompt field remains at least 16 logical pixels to avoid mobile input zoom and supports multiline Dynamic Type reflow.
- Pending creation disables duplicate submission and shows progress within the primary action without changing its bounds. Error and uncertain-outcome feedback appears near the action/form and includes the existing recovery guidance.
- The software keyboard may reduce available space, but the field label and primary action remain reachable through scrolling rather than being obscured.

### Task detail and actions

- Task detail starts with the full Task title, monospace Task ID, and Board Status. Project, Agent state, and updated time form a compact key-value overview with icons or labels.
- Handoff Notes use editorial reading treatment: strong section title, comfortable line height, clear Markdown hierarchy, visible safe links, and readable line length. Missing notes use an intentional empty state.
- Dependencies and related Tasks remain clearly interactive rows with visible navigation affordance. Agent errors use a contained semantic error treatment with safe copy.
- Plugin Task sections are visually separated but not elevated above native Task identity or lifecycle actions.
- Start is the primary Backlog action. Delete remains a destructive secondary Backlog action. Complete remains the single terminal lifecycle action for active Tasks and retains explicit confirmation. Pending actions preserve labels, announce progress, and prevent duplicate taps.
- Confirmation dialogs name the Task and action, preserve existing cleanup/Agent-shell disclosures, separate Cancel from the destructive or terminal action, and do not send requests on cancellation.

### Plugin Task sections

- The mobile plugin host receives version-matched semantic light/dark tokens, typography, common component primitives, viewport defaults, focus styling, reduced-motion state, and text scaling consistent with Quiet Paper.
- Plugin-declared styles load after the host base layer but should consume semantic roles. The host must not expose Companion credentials or relax the existing isolated bridge and authorization boundary to implement theming.
- Flutter continues to own outer Task-detail spacing and safe areas. Embedded sections do not add a second safe area or a nested primary scroll region.
- Plugin loading, empty, error, incompatible, pending, and expanded states remain contained within the contribution slot and cannot obscure native Task detail or lifecycle controls.

### Agent terminal

- The terminal remains a purpose-built dark inset surface in both light and dark app themes. The surrounding app bar, tabs, state treatment, accessory row, and safe-area surfaces use the active Quiet Paper theme.
- Light and dark ANSI palettes retain conventional terminal distinctions, high text contrast, and readable selection/cursor colors. Quiet Paper brand colors must not remap ANSI semantics into an indistinguishable monochrome palette.
- Use one fixed readable mobile monospace size as already specified. No new zoom, terminal settings, mouse reporting, link activation, or clipboard behavior is introduced.
- Live, connecting, ready, reconnecting, unavailable, and exited states use text plus a semantic icon/indicator and retain VoiceOver/TalkBack labels.
- Esc, one-shot Ctrl, Tab, and four arrow keys remain separate touch-safe controls above the bottom safe area and software keyboard. Pressed, selected Ctrl, and disabled states are visually distinct without layout movement.

### Motion and feedback

- Use 150–250 millisecond transitions for press, selection, sheet, dialog, and contained state changes. Motion communicates hierarchy or state; it is not decorative.
- Prefer opacity and transform animations that do not reflow surrounding content. Exit transitions are shorter than entry transitions.
- Respect reduced-motion settings by removing nonessential movement and preserving immediate semantic feedback.
- Async actions provide visible feedback within 100 milliseconds, disable duplicate activation, and announce success or error through existing accessible channels. Snackbars use concise recovery-oriented copy and do not steal focus.

### Responsive and platform behavior

- Layout is phone-first and supports small phones, large phones, portrait, landscape, and tablet widths. There is no horizontal page scrolling.
- Fixed app bars, tab bars, floating actions, terminal controls, and bottom actions reserve content insets so they never cover scrollable content.
- Flutter owns top, bottom, keyboard, notch, and gesture safe areas. Primary controls are not placed against device edges.
- Wider layouts increase gutters and constrain long-form text instead of stretching paragraphs edge to edge. Landscape terminal dimensions continue to recompute from the usable grid.
- Platform conventions for back navigation, modal dismissal, text selection, keyboard behavior, haptics, and system settings remain authoritative when they conflict with purely visual mockup details.

### Compatibility and migration

- This work changes presentation and design-system infrastructure only. Companion Gateway routes, generated API models, pairing credentials, stored trust, Project selection, Task lifecycle services, live events, terminal transport, plugin bridge, and persistence boundaries do not change.
- Existing screens migrate to the shared theme incrementally but must not ship in a visibly mixed default-Material/Quiet-Paper state. The implementation should establish the central theme and reusable primitives before converting feature surfaces.
- Existing product copy and canonical domain terms remain authoritative. The concept board's sample content is illustrative and does not replace runtime copy or domain logic.
- No runtime network access is added for fonts, icons, or theme assets.

## Testing Decisions

- Tests assert externally observable product, accessibility, and theme-mode behavior. They do not assert raw color values, exact pixel offsets, private widget structure, individual radius values, shadows, generated formatting, or implementation-specific theme class names.
- The preferred automated seam is the existing top-level Companion application shell with representative screens mounted beneath it. This seam proves that light and dark system appearance propagate without resetting navigation or domain state, that core screens still render, and that inherited semantic styling does not break behavior.
- Existing connection-shell, pairing-capture/scanner, Mobile Project Board, Task creation, Task detail, action palette, terminal adapter, lifecycle, and plugin Task-section widget tests remain the product-behavior regression suite. They continue to cover visible labels, actions, pending suppression, confirmations, recovery states, tab behavior, semantic labels, and terminal accessory controls.
- Add focused application-shell tests for system light/dark selection and theme propagation only where behavior is not already covered. Do not duplicate each feature test in both themes unless a feature has theme-dependent behavior.
- Add or extend accessibility-oriented widget tests for semantic action labels, selected tab/state announcements, logical traversal, scaled text survival for critical labels, and presence of distinct recovery actions. Assertions should describe user-visible outcomes rather than widget composition.
- Terminal adapter/controller tests continue to prove that light and dark ANSI themes are selected and that changing app appearance does not alter terminal protocol, input gating, resize, clipboard, or lifecycle behavior.
- Plugin host tests continue to prove theme propagation, text scaling, reduced-motion propagation, native Task-detail survival, and contained failure states without asserting plugin CSS utility names or private WebView structure.
- Automated screenshot/golden tests are not the primary acceptance seam because platform font rasterization and device dimensions make them brittle, and project standards keep visual styling out of unit tests. A small stable golden may be added only if the implementation team can make it deterministic across CI, but it is not required by this specification.
- Manual visual acceptance is required on at least one physical iOS device and one physical Android device. Capture Pairing, Board, Task creation, Task Details, and Terminal in system light mode and compare hierarchy, tone, density, and component language against the selected Quiet Paper concept.
- Manual acceptance also covers system dark mode, small and large phone sizes, portrait and landscape, software keyboard open/closed, maximum supported text scaling, screen-reader traversal, reduced motion, long Task titles, long Handoff Notes, empty/error/reconnecting states, confirmation dialogs, and terminal accessory controls.
- Contrast must be checked for every semantic foreground/background pair in both themes. Normal text targets at least 4.5:1, large text and non-text UI targets at least 3:1, and focus/error/success states must remain distinguishable without color alone.
- The full mobile Companion check remains the release regression command after implementation; physical-device LAN and Tailscale acceptance remains governed by the existing Companion acceptance matrix because this design system does not alter networking or authority.

## Out of Scope

- Changing Companion Gateway APIs, OpenAPI schemas, pairing grants, authorization, certificate pinning, discovery, Tailscale behavior, live invalidations, or secure-storage boundaries.
- Changing Mobile Project Board lane names, membership, ordering, Selected Project behavior, or Task lifecycle semantics.
- Adding new Task actions, Board mutations, notification delivery, offline snapshots, background execution, or desktop-independent operation.
- Redesigning the OpenForge desktop renderer, website, plugins outside the mobile Task-section host, or external plugin-owned full views.
- Replacing Material 3 with a custom rendering framework or building bespoke controls where accessible platform components suffice.
- Introducing a network-downloaded font, a second mobile component library, raster navigation icons, emoji icons, or screen-local theme systems.
- Making the app light-only. Quiet Paper is light-first, but existing system dark-mode support remains required.
- Changing terminal protocol, emulator behavior, fixed font-size policy, input controls, copy/paste security, link behavior, or attachment lifecycle.
- Pixel-identical reproduction of the concept board across Android and iOS. Platform adaptation, accessibility, runtime content, and device constraints take precedence.
- Adding a user-facing theme picker, custom accent picker, density setting, or terminal theme settings.
- Treating sample Tasks, Projects, Pull Requests, statuses, or terminal output from the concept board as seeded application data.

## Further Notes

- The selected visual reference is `docs/images/mobile-companion-designs/02-quiet-paper.png`.
- The Blueprint Modernist, Field Notes, Foundry Night, and Aurora Signal boards remain exploration artifacts only; they are not alternate supported themes.
- This specification builds on the accepted Mobile Companion, Companion Agent Terminal, Mobile Project Board and Task Actions, Mobile Task Creation, and Mobile Plugin Task Sections designs. Their product, authority, security, privacy, and lifecycle decisions remain authoritative.
- ADRs establishing paired-device terminal and Task authority, the dedicated terminal WebSocket, and PTY-manager ownership remain unchanged.
- Quiet Paper should be treated as the default mobile design guideline from this point forward. New Companion specifications should describe only intentional deviations rather than restating the entire system.
- Exact theme constants may be tuned during implementation and physical-device review, but changes must preserve the semantic roles, contrast requirements, editorial hierarchy, restrained elevation, cobalt action language, warm paper surfaces, and overall calm character selected here.
